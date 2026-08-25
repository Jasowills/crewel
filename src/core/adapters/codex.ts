import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  ContextBundle,
  RunTurnInput,
  TurnResult,
} from "./types.js";

const run = promisify(execFile);

export interface CodexAdapterOptions {
  /** Absolute path or name on PATH (default "codex"). */
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

export function renderCodexPrompt(bundle: ContextBundle): string {
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
  sections.push(
    `# Working directory\n${bundle.worktreePath}\n\nSandbox: Codex runs read-only-by-default — workspace writes inside ${bundle.worktreePath} must be allowed. AGENTS.md persona applies.`
  );
  sections.push(REPORT_CONTRACT);
  return sections.join("\n\n");
}

/**
 * Best-effort extraction of the final assistant text from `codex exec --json`
 * JSONL event streams. Looks for `item.completed` with `agent_message` or
 * `role: assistant`, generic `type: text` fields, and falls back to a
 * depth-first search over each parsed line. Takes the last non-empty text seen.
 */
export function extractCodexFinalText(stdout: string): string | null {
  let final: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const text = extractCodexText(parsed);
      if (text && text.trim() !== "") final = text;
    } catch {
      // Non-JSON lines are noise.
    }
  }
  return final;
}

function extractCodexText(node: unknown): string | null {
  if (typeof node === "string") {
    const trimmed = node.trim();
    return trimmed === "" ? null : node;
  }
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const found = extractCodexText(node[i]);
      if (found) return found;
    }
    return null;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // Codex-specific: item.completed with agent_message
    if (obj["type"] === "item.completed" && obj["item"] !== null) {
      const item = obj["item"] as Record<string, unknown>;
      if (
        (item["type"] === "agent_message" || item["role"] === "assistant") &&
        typeof item["text"] === "string" &&
        (item["text"] as string).trim() !== ""
      ) {
        return item["text"] as string;
      }
      // Some shapes use content array inside item
      const fromItem = extractCodexText(item);
      if (fromItem) return fromItem;
    }
    if (obj["type"] === "text" && typeof obj["text"] === "string") {
      const t = (obj["text"] as string).trim();
      if (t !== "") return obj["text"] as string;
    }
    if (
      typeof obj["result"] === "string" &&
      (obj["result"] as string).trim() !== ""
    ) {
      return obj["result"] as string;
    }
    // Generic depth-first over all values
    for (const value of Object.values(obj)) {
      const found = extractCodexText(value);
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

function isRateLimitedSignal(text: string): boolean {
  return /rate.?limit|429|quota|usage.?limit|overloaded|rate_limit/.test(
    text.toLowerCase()
  );
}

function isAuthSignal(text: string): boolean {
  return /unauthorized|authentication|api.?key|401|not logged in|login required|authentication_failed|billing_error/.test(
    text.toLowerCase()
  );
}

function scanJsonlForFailure(stdout: string): TurnResult | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const raw = JSON.stringify(parsed).toLowerCase();
      const type = typeof parsed["type"] === "string" ? parsed["type"] : "";
      // turn.failed is the primary Codex failure signal
      if (type === "turn.failed") {
        if (isRateLimitedSignal(raw)) {
          return { outcome: "rate-limited", error: trimmed.slice(0, 500) };
        }
        if (isAuthSignal(raw)) {
          return {
            outcome: "failed-terminal",
            error: `auth failure: ${trimmed.slice(0, 500)}`,
          };
        }
        return {
          outcome: "failed-retryable",
          error: trimmed.slice(0, 500),
        };
      }
      // Generic error events with rate-limit signature
      if (type === "error" || parsed["error"] !== undefined) {
        if (isRateLimitedSignal(raw)) {
          return { outcome: "rate-limited", error: trimmed.slice(0, 500) };
        }
        if (isAuthSignal(raw)) {
          return {
            outcome: "failed-terminal",
            error: `auth failure: ${trimmed.slice(0, 500)}`,
          };
        }
      }
      // Heuristic: any line containing rate_limit + error-ish
      if (raw.includes("rate_limit") || raw.includes("rate-limited")) {
        if (raw.includes("error") || raw.includes("failed")) {
          return { outcome: "rate-limited", error: trimmed.slice(0, 500) };
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function classifyFailure(
  stdout: string,
  stderr: string,
  exitCode: number
): TurnResult {
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (isRateLimitedSignal(combined)) {
    return {
      outcome: "rate-limited",
      error: stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500),
    };
  }
  if (isAuthSignal(combined)) {
    return {
      outcome: "failed-terminal",
      error: `auth failure: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`,
    };
  }
  return {
    outcome: "failed-retryable",
    error: `codex exited ${exitCode}: ${(stderr || stdout).trim().slice(0, 300)}`,
  };
}

export function createCodexAdapter(
  options: CodexAdapterOptions = {}
): AgentAdapter {
  const bin = options.bin ?? "codex";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "codex",
    async checkAvailable() {
      try {
        await run(bin, ["--version"], { timeout: 10_000 });
        return true;
      } catch {
        // Fallback: some installs only respond to --help or no-arg invocation
        try {
          await run(bin, ["--help"], { timeout: 10_000 });
          return true;
        } catch {
          return false;
        }
      }
    },
    renderBundle(bundle: ContextBundle): string {
      return renderCodexPrompt(bundle);
    },
    async runTurn(input: RunTurnInput): Promise<TurnResult> {
      const prompt = renderCodexPrompt(input.bundle);
      try {
        const { stdout, stderr } = await run(bin, ["exec", "--json", prompt], {
          cwd: input.bundle.worktreePath,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          signal: input.signal as never,
        });
        void stderr;
        const jsonlFailure = scanJsonlForFailure(stdout);
        if (jsonlFailure) return jsonlFailure;
        // Also check stderr on success path for rate-limit/auth signals
        if (stderr && isRateLimitedSignal(stderr)) {
          return {
            outcome: "rate-limited",
            error: stderr.trim().slice(0, 500),
          };
        }
        if (stderr && isAuthSignal(stderr)) {
          return {
            outcome: "failed-terminal",
            error: `auth failure: ${stderr.trim().slice(0, 500)}`,
          };
        }
        const finalText = extractCodexFinalText(stdout);
        if (finalText === null) {
          return {
            outcome: "failed-retryable",
            error: "no parsable final message in codex output",
          };
        }
        return { outcome: "completed", raw: parseReportCandidate(finalText) };
      } catch (error) {
        const err = error as NodeJS.ErrnoException & {
          code?: string | number;
          stderr?: string;
          stdout?: string;
          killed?: boolean;
        };
        if (err.killed || err.code === "ABORT_ERR") {
          return { outcome: "aborted", error: "turn aborted" };
        }
        const stderr = err.stderr ?? String(err.message);
        const stdout = (err as { stdout?: string }).stdout ?? "";
        const jsonlFailure = scanJsonlForFailure(stdout);
        if (jsonlFailure) return jsonlFailure;
        return classifyFailure(stdout, stderr, Number(err.code ?? 1));
      }
    },
  };
}
