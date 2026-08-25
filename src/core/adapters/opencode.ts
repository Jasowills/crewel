import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  ContextBundle,
  RunTurnInput,
  TurnResult,
} from "./types.js";

const run = promisify(execFile);

export interface OpenCodeAdapterOptions {
  /** Absolute path or name on PATH (default "opencode"). */
  bin?: string;
  /** Hard ceiling per turn; agents are slow but turns must not hang forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const REPORT_CONTRACT = [
  "FINAL MESSAGE CONTRACT — the last thing you output must be ONLY a JSON",
  "object (no prose, no markdown fences) matching this TurnReport schema:",
  '{"status": "done" | "blocked" | "in-progress" | "needs-clarification",',
  ' "summary": string (non-empty),',
  ' "changedFiles": string[],',
  ' "testEvidence": string[],',
  ' "message"?: {"to": string, "body": string},',
  ' "progressNotes"?: string}',
  "Use needs-clarification (with message.to = the lead) instead of guessing.",
  "Never claim done without test evidence.",
].join("\n");

export function renderOpencodePrompt(bundle: ContextBundle): string {
  const sections: string[] = [];
  sections.push(`# Role\n${bundle.instructions}`);
  if (bundle.tickets.length > 0) {
    for (const ticket of bundle.tickets) {
      sections.push(
        [
          `# Ticket ${ticket.id}: ${ticket.title}`,
          ticket.scope ? `Scope:\n${ticket.scope}` : null,
          `Acceptance criteria:\n${ticket.acceptanceCriteria
            .map((c) => `- ${c}`)
            .join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }
  if (bundle.messages.length > 0) {
    sections.push(
      `# Mail\n${bundle.messages
        .map((m) => `[${m.kind}] from ${m.from}: ${m.body}`)
        .join("\n")}`
    );
  }
  if (bundle.progressNotes) {
    sections.push(
      `# Progress notes from earlier turns\n${bundle.progressNotes}`
    );
  }
  sections.push(`# Working directory\n${bundle.worktreePath}`);
  sections.push(REPORT_CONTRACT);
  return sections.join("\n\n");
}

interface OpencodeEventPart {
  type?: string;
  text?: string;
}

/**
 * Best-effort extraction of the final assistant text from `opencode run
 * --format json` event streams: take the last non-empty text field seen.
 * The stream shape is not contractually documented, so stay tolerant.
 */
export function extractFinalText(stdout: string): string | null {
  let final: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as OpencodeEventPart;
      const text = extractText(parsed);
      if (text && text.trim() !== "") final = text;
    } catch {
      // Non-JSON lines are part of the stream noise.
    }
  }
  return final;
}

function extractText(node: unknown): string | null {
  if (typeof node === "string") {
    const trimmed = node.trim();
    return trimmed === "" ? null : node;
  }
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const found = extractText(node[i]);
      if (found) return found;
    }
    return null;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["type"] === "text" && typeof obj["text"] === "string") {
      const t = (obj["text"] as string).trim();
      if (t !== "") return obj["text"] as string;
    }
    // Generic depth-first search over all object values for robustness
    for (const value of Object.values(obj)) {
      const found = extractText(value);
      if (found) return found;
    }
  }
  return null;
}

/** Strip markdown fences / surrounding prose, then locate the JSON object. */
export function parseReportCandidate(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return unfenced.trim();
  const slice = unfenced.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return slice;
  }
}

function classifyFailure(stderr: string, exitCode: number): TurnResult {
  const combined = stderr.toLowerCase();
  if (/rate.?limit|429|quota|usage.?limit/.test(combined)) {
    return { outcome: "rate-limited", error: stderr.trim().slice(0, 500) };
  }
  if (
    /unauthorized|authentication|api.?key|401|not logged in|login required/.test(
      combined
    )
  ) {
    return {
      outcome: "failed-terminal",
      error: `auth failure: ${stderr.trim().slice(0, 500)}`,
    };
  }
  return {
    outcome: "failed-retryable",
    error: `opencode exited ${exitCode}: ${stderr.trim().slice(0, 300)}`,
  };
}

export function createOpencodeAdapter(
  options: OpenCodeAdapterOptions = {}
): AgentAdapter {
  const bin = options.bin ?? "opencode";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "opencode",
    async checkAvailable() {
      try {
        await run(bin, ["--version"], { timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },
    renderBundle(bundle: ContextBundle): string {
      return renderOpencodePrompt(bundle);
    },
    async runTurn(input: RunTurnInput): Promise<TurnResult> {
      const prompt = renderOpencodePrompt(input.bundle);
      try {
        const { stdout, stderr } = await run(
          bin,
          ["run", "--format", "json", prompt],
          {
            cwd: input.bundle.worktreePath,
            timeout: timeoutMs,
            maxBuffer: 64 * 1024 * 1024,
            signal: input.signal as never,
          }
        );
        void stderr;
        const finalText = extractFinalText(stdout);
        if (finalText === null) {
          return {
            outcome: "failed-retryable",
            error: "no parsable final message in opencode output",
          };
        }
        // Completed with a candidate report; schema validation happens in
        // the engine so invalid reports are NEVER trusted as done.
        return { outcome: "completed", raw: parseReportCandidate(finalText) };
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          code?: string | number;
          stderr?: string;
          killed?: boolean;
        };
        if (err.killed || err.code === "ABORT_ERR") {
          return { outcome: "aborted", error: "turn aborted" };
        }
        return classifyFailure(
          err.stderr ?? String(err.message),
          Number(err.code ?? 1)
        );
      }
    },
  };
}
