import type { MailMessage } from "../mail/index.js";
import type { Ticket } from "../tickets/model.js";

export interface ContextBundle {
  team: string;
  participantId: string;
  role: "lead" | "teammate";
  worktreePath: string;
  tickets: Ticket[];
  messages: MailMessage[];
  progressNotes: string | null;
  instructions: string;
}

export interface TurnReportMessage {
  to: string;
  body: string;
}

export type TurnReportStatus =
  "done" | "blocked" | "in-progress" | "needs-clarification";

export interface TurnReport {
  status: TurnReportStatus;
  summary: string;
  changedFiles: string[];
  testEvidence: string[];
  message?: TurnReportMessage;
  progressNotes?: string;
}

export type TurnOutcome =
  | "completed"
  | "aborted"
  | "failed-retryable"
  | "failed-terminal"
  | "rate-limited";

export interface RunTurnInput {
  bundle: ContextBundle;
  heartbeatPath: string;
  touchHeartbeat(): Promise<void> | void;
  signal?: AbortSignal;
}

export interface TurnResult {
  outcome: TurnOutcome;
  report?: TurnReport;
  raw?: unknown;
  error?: string;
}

export interface AgentAdapter {
  readonly id: string;
  checkAvailable(): Promise<boolean>;
  renderBundle(bundle: ContextBundle): string;
  runTurn(input: RunTurnInput): Promise<TurnResult>;
}

export type ReportValidation =
  { ok: true; report: TurnReport } | { ok: false; errors: string[] };

export function validateTurnReport(value: unknown): ReportValidation {
  const errors: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["report must be a JSON object"] };
  }
  const report = value as Record<string, unknown>;
  const allowedStatuses: readonly string[] = [
    "done",
    "blocked",
    "in-progress",
    "needs-clarification",
  ];
  if (!allowedStatuses.includes(report["status"] as string)) {
    errors.push(`"status" must be one of: ${allowedStatuses.join(", ")}`);
  }
  if (
    typeof report["summary"] !== "string" ||
    report["summary"].trim() === ""
  ) {
    errors.push('"summary" must be a non-empty string');
  }
  for (const key of ["changedFiles", "testEvidence"]) {
    const v = report[key];
    if (
      v !== undefined &&
      (!Array.isArray(v) || !v.every((item) => typeof item === "string"))
    ) {
      errors.push(`"${key}" must be an array of strings`);
    }
  }
  const message = report["message"];
  if (message !== undefined && message !== null) {
    const m = message as Record<string, unknown>;
    if (
      typeof m !== "object" ||
      typeof m["to"] !== "string" ||
      typeof m["body"] !== "string"
    ) {
      errors.push('"message" must be { to, body } of strings');
    }
  }
  if (
    report["progressNotes"] !== undefined &&
    typeof report["progressNotes"] !== "string"
  ) {
    errors.push('"progressNotes" must be a string');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    report: {
      status: report["status"] as TurnReportStatus,
      summary: report["summary"] as string,
      changedFiles: (report["changedFiles"] as string[]) ?? [],
      testEvidence: (report["testEvidence"] as string[]) ?? [],
      message: message as TurnReportMessage | undefined,
      progressNotes: report["progressNotes"] as string | undefined,
    },
  };
}
