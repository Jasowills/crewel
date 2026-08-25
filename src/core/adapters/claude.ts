import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  ContextBundle,
  RunTurnInput,
  TurnResult,
} from "./types.js";

const run = promisify(execFile);

export interface ClaudeAdapterOptions {
  bin?: string;
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

export function renderClaudePrompt(bundle: ContextBundle): string {
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

interface ClaudeEventPart {
  type?: string;
  text?: string;
  result?: string;
}

export function extractClaudeFinalText(stdout: string): string | null {
  let final: string | null = null;
  const trimmedAll = stdout.trim();
  // Handle single JSON object with "result" field (Claude --output-format json)
  if (trimmedAll.startsWith("{") && trimmedAll.endsWith("}")) {
    try {
      const single = JSON.parse(trimmedAll) as Record<string, unknown>;
      if (typeof single.result === "string" && single.result.trim() !== "") {
        return single.result as string;
      }
      if (typeof single.text === "string" && single.text.trim() !== "") {
        return single.text as string;
      }
      const nested = extractText(single);
      if (nested) return nested;
    } catch {
      // fall through to NDJSON handling
    }
  }
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as ClaudeEventPart;
      const text = extractText(parsed);
      if (text && text.trim() !== "") final = text;
    } catch {
      // Non-JSON lines are noise
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
    if (
      typeof obj["result"] === "string" &&
      (obj["result"] as string).trim() !== ""
    ) {
      return obj["result"] as string;
    }
    for (const value of Object.values(obj)) {
      const found = extractText(value);
      if (found) return found;
    }
  }
  return null;
}

export function parseClaudeReportCandidate(text: string): unknown {
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

function classifyClaudeFailure(
  stdout: string,
  stderr: string,
  exitCode: number
): TurnResult {
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  // Typed retry telemetry: api_retry events with rate_limit/billing/auth
  if (
    /api_retry/.test(combined) ||
    /rate.?limit|429|quota|usage.?limit|overloaded/.test(combined)
  ) {
    // Distinguish rate-limit-like retry from terminal billing/auth
    if (/rate.?limit|429|overloaded/.test(combined)) {
      return {
        outcome: "rate-limited",
        error: `${stderr || stdout}`.trim().slice(0, 500),
      };
    }
  }
  if (/rate.?limit|429|quota|usage.?limit/.test(combined)) {
    return {
      outcome: "rate-limited",
      error: stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500),
    };
  }
  if (
    /unauthorized|authentication|api.?key|401|not logged in|login required|billing_error|authentication_failed/.test(
      combined
    )
  ) {
    return {
      outcome: "failed-terminal",
      error: `auth failure: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`,
    };
  }
  return {
    outcome: "failed-retryable",
    error: `claude exited ${exitCode}: ${(stderr || stdout).trim().slice(0, 300)}`,
  };
}

export function createClaudeAdapter(
  options: ClaudeAdapterOptions = {}
): AgentAdapter {
  const bin = options.bin ?? "claude";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "claude-code",
    async checkAvailable() {
      try {
        await run(bin, ["--version"], { timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },
    renderBundle(bundle: ContextBundle): string {
      return renderClaudePrompt(bundle);
    },
    async runTurn(input: RunTurnInput): Promise<TurnResult> {
      const prompt = renderClaudePrompt(input.bundle);
      try {
        const { stdout, stderr } = await run(
          bin,
          [
            "-p",
            prompt,
            "--output-format",
            "json",
            "--dangerously-skip-permissions",
          ],
          {
            cwd: input.bundle.worktreePath,
            timeout: timeoutMs,
            maxBuffer: 64 * 1024 * 1024,
            signal: input.signal as never,
          }
        );
        // Check for typed retry telemetry in stdout before final text extraction
        if (
          stdout.toLowerCase().includes("api_retry") &&
          stdout.toLowerCase().includes("rate_limit")
        ) {
          return {
            outcome: "rate-limited",
            error: stdout.trim().slice(0, 500),
          };
        }
        void stderr;
        const finalText = extractClaudeFinalText(stdout);
        if (finalText === null) {
          return {
            outcome: "failed-retryable",
            error: "no parsable final message in claude output",
          };
        }
        return {
          outcome: "completed",
          raw: parseClaudeReportCandidate(finalText),
        };
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
        // Also check stdout for api_retry on failure path
        const combined = `${stdout}\n${stderr}`.toLowerCase();
        if (combined.includes("api_retry") && combined.includes("rate_limit")) {
          return {
            outcome: "rate-limited",
            error: stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500),
          };
        }
        return classifyClaudeFailure(stdout, stderr, Number(err.code ?? 1));
      }
    },
  };
}
