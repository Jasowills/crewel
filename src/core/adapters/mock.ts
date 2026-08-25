import type { AgentAdapter, ContextBundle, TurnReport } from "./types.js";

export type MockStep =
  | { kind: "complete"; report: Partial<TurnReport> }
  | { kind: "invalid"; junk: unknown }
  | {
      kind: "fail";
      outcome: "failed-retryable" | "failed-terminal" | "rate-limited";
      error: string;
    };

export interface MockOptions {
  id?: string;
  steps?: MockStep[];
  onTurn?: (
    bundle: ContextBundle,
    heartbeatPath: string
  ) => void | Promise<void>;
}

const DEFAULT_REPORT: Partial<TurnReport> = {
  status: "done",
  summary: "mock turn complete",
  changedFiles: ["src/mock.ts"],
  testEvidence: ["npm test passes (mock)"],
};

export function createMockAdapter(options: MockOptions = {}): AgentAdapter {
  const steps = [...(options.steps ?? [])];
  return {
    id: options.id ?? "mock",
    async checkAvailable() {
      return true;
    },
    renderBundle() {
      return "";
    },
    async runTurn(input) {
      await input.touchHeartbeat();
      if (options.onTurn) {
        await options.onTurn(input.bundle, input.heartbeatPath);
      }
      const step = steps.shift() ?? { kind: "complete" as const, report: {} };
      if (step.kind === "fail") {
        return { outcome: step.outcome, error: step.error };
      }
      if (step.kind === "invalid") {
        return { outcome: "completed", raw: step.junk };
      }
      const report = { ...DEFAULT_REPORT, ...step.report };
      return {
        outcome: "completed",
        report: {
          status: report.status ?? "done",
          summary: report.summary ?? "mock turn complete",
          changedFiles: report.changedFiles ?? [],
          testEvidence: report.testEvidence ?? [],
          message: report.message,
          progressNotes: report.progressNotes,
        },
      };
    },
  };
}
