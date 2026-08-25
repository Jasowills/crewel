import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CrewelError } from "../errors.js";
import { loadTickets, ticketsDir } from "../team/store.js";
import { parseTicketDoc } from "./frontmatter.js";
import {
  isTicketStatus,
  TICKET_ID_PATTERN,
  TICKET_LIFECYCLE,
} from "./model.js";
import type { Ticket, TicketStatus } from "./model.js";

const KNOWN_FIELDS: readonly string[] = [
  "id",
  "title",
  "status",
  "assignee",
  "depends",
  "accepts",
];

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  return undefined;
}

interface DocEntry {
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function normalize(
  entry: DocEntry,
  id: string,
  knownIds: Set<string>,
  errors: string[]
): Ticket | null {
  const { frontmatter: fm, body, file } = entry;
  let ok = true;
  const fail = (message: string) => {
    errors.push(`${file}: ${message}`);
    ok = false;
  };

  const title = fm.title;
  if (title === undefined || typeof title !== "string" || title.trim() === "") {
    fail('missing required field "title"');
  }

  let status: TicketStatus = "open";
  if (fm.status !== undefined && fm.status !== null) {
    if (!isTicketStatus(fm.status)) {
      fail(`"status" must be one of: ${TICKET_LIFECYCLE.join(", ")}`);
    } else {
      status = fm.status;
    }
  }

  const assignee =
    fm.assignee === undefined || fm.assignee === null
      ? undefined
      : String(fm.assignee);

  let dependsOn: string[] = [];
  const deps = asStringArray(fm.depends);
  if (fm.depends !== undefined && deps === undefined) {
    fail('"depends" must be a list of ticket ids');
  } else if (deps) {
    dependsOn = deps.filter((dep) => {
      if (dep === id) {
        fail(`ticket "${id}" cannot depend on itself`);
        return false;
      }
      if (!knownIds.has(dep)) {
        fail(`depends on unknown ticket "${dep}"`);
        return false;
      }
      return true;
    });
  }

  const accepts = asStringArray(fm.accepts);
  const criteria = accepts?.map((c) => c.trim()).filter(Boolean) ?? [];
  if (criteria.length === 0) {
    fail('missing "accepts" — tickets need at least one acceptance criterion');
  }

  for (const key of Object.keys(fm)) {
    if (!KNOWN_FIELDS.includes(key)) {
      fail(`unknown field "${key}" — known fields: ${KNOWN_FIELDS.join(", ")}`);
    }
  }

  if (!ok) return null;
  return {
    id,
    title: String(title).trim(),
    status,
    assignee,
    dependsOn,
    acceptanceCriteria: criteria,
    scope: body === "" ? undefined : body,
  };
}

export async function validateTickets(input: {
  repoRoot: string;
  team: string;
}): Promise<{ written: number }> {
  const dir = ticketsDir(input.repoRoot, input.team);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new CrewelError(
      `no tickets directory found for team "${input.team}" — author Markdown tickets under .crewel/teams/${input.team}/tickets/`
    );
  }
  const mdFiles = entries.filter((file) => file.endsWith(".md")).sort();
  if (mdFiles.length === 0) {
    throw new CrewelError(
      "no ticket files found — author .md tickets with YAML frontmatter first"
    );
  }

  const errors: string[] = [];
  const docs: DocEntry[] = [];
  for (const file of mdFiles) {
    try {
      const source = await readFile(path.join(dir, file), "utf8");
      const parsed = parseTicketDoc(source, file);
      docs.push({ file, ...parsed });
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const seenIds = new Map<string, string>();
  const idsByFile = new Map<string, string>();
  for (const doc of docs) {
    const id = doc.frontmatter.id;
    if (id === undefined) {
      errors.push(`${doc.file}: missing required field "id"`);
      continue;
    }
    if (typeof id !== "string" || !TICKET_ID_PATTERN.test(id)) {
      errors.push(
        `${doc.file}: "id" must be a lowercase slug of letters, digits, and hyphens`
      );
      continue;
    }
    const expected = doc.file.replace(/\.md$/, "");
    if (id !== expected) {
      errors.push(
        `${doc.file}: "id" (${id}) must match its file name (${expected}.md)`
      );
    }
    const duplicate = seenIds.get(id);
    if (duplicate) {
      errors.push(
        `${doc.file}: duplicate ticket id "${id}" (also defined in ${duplicate})`
      );
    } else {
      seenIds.set(id, doc.file);
    }
    idsByFile.set(doc.file, id);
  }
  const knownIds = new Set(seenIds.keys());

  const tickets: Ticket[] = [];
  for (const doc of docs) {
    const id = idsByFile.get(doc.file);
    if (id === undefined) continue;
    const ticket = normalize(doc, id, knownIds, errors);
    if (ticket) tickets.push(ticket);
  }

  if (errors.length > 0) {
    throw new CrewelError(errors.join("\n"));
  }

  for (const ticket of tickets) {
    const twinPath = path.join(dir, `${ticket.id}.json`);
    await writeFile(twinPath, `${JSON.stringify(ticket, null, 2)}\n`, "utf8");
  }
  return { written: tickets.length };
}

export interface BoardColumn {
  status: TicketStatus;
  tickets: Ticket[];
}

export async function board(input: {
  repoRoot: string;
  team: string;
}): Promise<{ columns: BoardColumn[]; total: number }> {
  const tickets = await loadTickets(input.repoRoot, input.team);
  const columns = TICKET_LIFECYCLE.map((status) => ({
    status,
    tickets: tickets.filter((ticket) => {
      // Frozen tickets surface under blocked; clarified under
      // needs-clarification; both leave their underlying columns.
      if (status === "needs-clarification") return !!ticket.clarification;
      if (status === "blocked") {
        return ticket.status === "blocked" || ticket.frozen === true;
      }
      if (ticket.frozen) return false;
      if (status === "assigned") {
        return ticket.status === "assigned" && !ticket.clarification;
      }
      return ticket.status === status && !ticket.clarification;
    }),
  }));
  return { columns, total: tickets.length };
}
