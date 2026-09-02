import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { getAdapter, knownAdapterIds } from "../adapters/index.js";
import type { AgentAdapter, ContextBundle } from "../adapters/types.js";
import { CrewelError } from "../errors.js";
import { sendMessage } from "../mail/index.js";
import { notifyJason } from "../notifications/index.js";
import { loadAllTeams, findActiveTeams } from "../team/store.js";
import { ticketsDir, updateTicket } from "../team/store.js";
import { validateTickets } from "../tickets/index.js";
import { TICKET_ID_PATTERN } from "../tickets/model.js";

export interface DecompositionSpec {
  id: string;
  title: string;
  scope: string;
  depends?: string[];
  accepts: string[];
}

export const DECOMPOSITION_CONTRACT = [
  "DECOMPOSITION CONTRACT — the last thing you output must be ONLY a JSON array",
  "(no prose, no markdown fences) of ticket specs,",
  'where each spec is {"id": string (lowercase slug matching /^[a-z0-9][a-z0-9-]*$/), "title": string (non-empty), "scope": string (non-empty), "depends"?: string[], "accepts": string[] (non-empty)}.',
  "Id must match /^[a-z0-9][a-z0-9-]*$/ and match its file name.",
  "depends must reference only ids in this same array, no cycles, no self-depends.",
  "accepts must be at least one clear acceptance criterion per ticket.",
  "scope is the ticket body (what to build).",
  "Output NOTHING else.",
].join("\n");

export const LEAD_INSTRUCTIONS = [
  "You are the lead — a dedicated, non-coding orchestrator.",
  "Never write code. Your only output is the decomposition JSON array described below.",
  "Decompose the incoming request into independently workable tickets with clear scope and acceptance criteria.",
  "Keep dependency edges minimal and acyclic.",
].join(" ");

export function parseDecompositionCandidate(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end <= start) {
    const trimmed = unfenced.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  const slice = unfenced.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return slice;
  }
}

function coerceRawToArray(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = parseDecompositionCandidate(raw);
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["tickets", "specs", "decomposition", "data"]) {
        if (Array.isArray(obj[key])) return obj[key];
      }
    }
    return parsed;
  }
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["tickets", "specs", "decomposition", "data"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    // Already an array-like object with numeric keys is not expected.
    return raw;
  }
  return raw;
}

export function validateDecompositionSpecs(raw: unknown): DecompositionSpec[] {
  const coerced = coerceRawToArray(raw);
  if (!Array.isArray(coerced)) {
    throw new CrewelError(
      `lead decomposition must be a JSON array of ticket specs — got ${typeof coerced === "string" ? coerced.slice(0, 200) : typeof coerced}`
    );
  }
  if (coerced.length === 0) {
    throw new CrewelError(
      "lead decomposition must contain at least one ticket"
    );
  }
  const specs: DecompositionSpec[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (let index = 0; index < coerced.length; index++) {
    const entry = coerced[index] as Record<string, unknown>;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`spec [${index}]: must be an object`);
      continue;
    }
    const id = entry["id"];
    const title = entry["title"];
    const scope = entry["scope"];
    const accepts = entry["accepts"];
    const depends = entry["depends"];

    if (typeof id !== "string" || !TICKET_ID_PATTERN.test(id)) {
      errors.push(
        `spec [${index}]: "id" must be a lowercase slug of letters, digits, and hyphens`
      );
    } else if (seen.has(id)) {
      errors.push(`spec [${index}]: duplicate ticket id "${id}"`);
    } else {
      seen.add(id);
    }

    if (typeof title !== "string" || title.trim() === "") {
      errors.push(`spec [${index}]: "title" must be a non-empty string`);
    }
    if (typeof scope !== "string" || scope.trim() === "") {
      errors.push(`spec [${index}]: "scope" must be a non-empty string`);
    }
    if (
      !Array.isArray(accepts) ||
      accepts.length === 0 ||
      !accepts.every((v) => typeof v === "string" && v.trim() !== "")
    ) {
      errors.push(
        `spec [${index}]: "accepts" must be a non-empty array of non-empty strings`
      );
    }
    if (depends !== undefined) {
      if (
        !Array.isArray(depends) ||
        !depends.every((v) => typeof v === "string")
      ) {
        errors.push(
          `spec [${index}]: "depends" must be an array of ticket ids`
        );
      }
    }

    // Collect if basic shape valid
    if (
      typeof id === "string" &&
      TICKET_ID_PATTERN.test(id) &&
      typeof title === "string" &&
      title.trim() !== "" &&
      typeof scope === "string" &&
      scope.trim() !== "" &&
      Array.isArray(accepts) &&
      accepts.length > 0
    ) {
      const spec: DecompositionSpec = {
        id,
        title: title.trim(),
        scope: scope.trim(),
        accepts: (accepts as string[]).map((c) => c.trim()).filter(Boolean),
      };
      if (Array.isArray(depends)) {
        spec.depends = (depends as string[])
          .map((d) => String(d).trim())
          .filter(Boolean);
      }
      specs.push(spec);
    }
  }

  if (errors.length > 0) {
    throw new CrewelError(errors.join("\n"));
  }

  // Cross-spec validation: depends references existing ids, no self-depends, no cycles
  const ids = new Set(specs.map((s) => s.id));
  for (const spec of specs) {
    if (spec.depends) {
      for (const dep of spec.depends) {
        if (dep === spec.id) {
          throw new CrewelError(`ticket "${spec.id}" cannot depend on itself`);
        }
        if (!ids.has(dep)) {
          throw new CrewelError(
            `ticket "${spec.id}" depends on unknown ticket "${dep}" — known ids: ${[...ids].join(", ")}`
          );
        }
      }
    }
  }

  // Cycle detection via DFS
  const graph = new Map<string, string[]>(
    specs.map((s) => [s.id, s.depends ?? []])
  );
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const id of ids) {
    if (dfs(id)) {
      throw new CrewelError(
        `dependency cycle detected involving "${id}" — decomposition must be acyclic`
      );
    }
  }

  return specs;
}

export function renderLeadDecompositionPrompt(request: string): string {
  return [
    `# Role\n${LEAD_INSTRUCTIONS}`,
    `# Incoming request\n${request}`,
    DECOMPOSITION_CONTRACT,
  ].join("\n\n");
}

export function createMockLeadAdapter(
  id: string,
  decomposition: unknown
): AgentAdapter {
  return {
    id,
    async checkAvailable() {
      return true;
    },
    renderBundle(bundle: ContextBundle): string {
      return renderLeadDecompositionPrompt(bundle.tickets[0]?.scope ?? "");
    },
    async runTurn(input) {
      await input.touchHeartbeat();
      const raw =
        typeof decomposition === "string"
          ? decomposition
          : JSON.parse(JSON.stringify(decomposition));
      // Support array or stringified JSON
      if (Array.isArray(raw)) {
        return { outcome: "completed", raw };
      }
      return { outcome: "completed", raw };
    },
  };
}

export async function decomposeRequest(input: {
  repoRoot: string;
  team?: string;
  request: string;
}): Promise<{ team: string; ticketIds: string[]; count: number }> {
  const repoRoot = input.repoRoot;
  const request = input.request;
  if (typeof request !== "string" || request.trim() === "") {
    throw new CrewelError("request must be a non-empty string");
  }

  let teamName = input.team;
  if (!teamName) {
    const active = await findActiveTeams(repoRoot);
    if (active.length === 0) {
      throw new CrewelError(
        "no active team found — create one with `crewel team create` or pass --team <name>"
      );
    }
    teamName = active[0]!.name;
  } else {
    const found = (await loadAllTeams(repoRoot)).find(
      (team) => team.name === teamName
    );
    if (!found) {
      throw new CrewelError(`no team named "${teamName}"`);
    }
  }

  const teams = await loadAllTeams(repoRoot);
  const entry = teams.find((team) => team.name === teamName);
  if (!entry) {
    throw new CrewelError(`no team named "${teamName}"`);
  }
  const leadType = entry.config.lead.type;
  const leadModel = entry.config.lead.model;
  const adapter = getAdapter(leadType);
  if (!adapter) {
    throw new CrewelError(
      `unknown adapter type "${leadType}" — known types: ${knownAdapterIds().join(", ")}`
    );
  }

  const pseudoTicket = {
    id: "request",
    title: "Incoming request to decompose",
    status: "open" as const,
    dependsOn: [] as string[],
    acceptanceCriteria: ["decompose faithfully"],
    scope: request,
  };

  const bundle: ContextBundle = {
    team: teamName,
    participantId: "lead",
    role: "lead",
    worktreePath: repoRoot,
    tickets: [pseudoTicket as unknown as import("../tickets/model.js").Ticket],
    messages: [],
    progressNotes: null,
    instructions: `${LEAD_INSTRUCTIONS}\n\n${DECOMPOSITION_CONTRACT}`,
    model: leadModel,
  };

  const heartbeatPath = path.join(
    repoRoot,
    ".crewel",
    "teams",
    teamName,
    "participants",
    "lead",
    "heartbeat"
  );

  let result: import("../adapters/types.js").TurnResult;
  try {
    result = await adapter.runTurn({
      bundle,
      heartbeatPath,
      touchHeartbeat: async () => {},
    });
  } catch (error) {
    throw new CrewelError(
      `lead turn failed — ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (result.outcome !== "completed") {
    throw new CrewelError(
      `lead decomposition failed — ${result.outcome}${result.error ? `: ${result.error}` : ""}`
    );
  }

  const rawOutput = (result.raw ?? result.report) as unknown;
  let specs: DecompositionSpec[];
  try {
    specs = validateDecompositionSpecs(rawOutput);
  } catch (error) {
    if (error instanceof CrewelError) throw error;
    throw new CrewelError(
      `invalid lead decomposition — ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Write Markdown tickets — validate before writing? Already validated. Now write atomically.
  const dir = ticketsDir(repoRoot, teamName);
  await mkdir(dir, { recursive: true });

  for (const spec of specs) {
    const frontmatter: Record<string, unknown> = {
      id: spec.id,
      title: spec.title,
      status: "open",
      accepts: spec.accepts,
    };
    if (spec.depends && spec.depends.length > 0) {
      frontmatter["depends"] = spec.depends;
    }
    const yaml = yamlStringify(frontmatter).trimEnd();
    const content = `---\n${yaml}\n---\n${spec.scope}\n`;
    await writeFile(path.join(dir, `${spec.id}.md`), content, "utf8");
  }

  const { written } = await validateTickets({
    repoRoot,
    team: teamName,
  });

  if (written !== specs.length) {
    throw new CrewelError(
      `ticket write mismatch — expected ${specs.length}, validated ${written}`
    );
  }

  // Round-robin assignment to teammates, leaving lead out.
  const teammates = entry.config.teammates;
  if (teammates.length > 0) {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (!spec) continue;
      const assignee = teammates[i % teammates.length];
      if (!assignee) continue;
      await updateTicket(repoRoot, teamName, spec.id, {
        status: "assigned",
        assignee: assignee.id,
      });
      await sendMessage({
        repoRoot,
        team: teamName,
        from: "lead",
        to: assignee.id,
        kind: "assignment",
        body: `Ticket "${spec.id} — ${spec.title}" assigned to you.`,
      });
      await notifyJason({
        repoRoot,
        team: teamName,
        kind: "assignment",
        body: `"${spec.id} — ${spec.title}" assigned to ${assignee.id}.`,
      }).catch(() => {});
    }
  }

  const ticketIds = specs.map((s) => s.id);
  return { team: teamName, ticketIds, count: ticketIds.length };
}
