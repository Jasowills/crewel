import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCodexAdapter,
  extractCodexFinalText,
  parseReportCandidate,
  renderCodexPrompt,
} from "../src/core/adapters/codex.js";
import type { ContextBundle } from "../src/core/adapters/types.js";
import { validateTurnReport } from "../src/core/adapters/types.js";
import { knownAdapterIds } from "../src/core/adapters/index.js";

let dir: string;
let shimLog: string;
let binPath: string;

const shimJs = `
const fs = require("fs");
const args = process.argv.slice(2);
try { fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + "\\n"); } catch {}
const mode = process.env.SHIM_MODE ?? "ok";
if (args.includes("--version")) { console.log("codex 0.0.0-shim"); process.exit(0); }
if (args.includes("--help")) { console.log("codex help shim"); process.exit(0); }
if (mode === "exit1") { console.error("something broke badly"); process.exit(3); }
if (mode === "rate") { console.error("Error: 429 rate limit exceeded for provider"); process.exit(1); }
if (mode === "rate-retry") {
  console.log(JSON.stringify({ type: "turn.failed", error: "rate_limit exceeded", message: "rate limited" }));
  process.exit(0);
}
if (mode === "auth") { console.error("authentication failed: not logged in"); process.exit(1); }
const report = mode === "garbage"
  ? "I wandered the codebase but produced nothing machine-readable"
  : JSON.stringify({ status: "done", summary: "did the thing", changedFiles: ["src/a.ts"], testEvidence: ["npm test"] });
if (mode === "fenced") {
  const text = "intro prose\\n\\\`\\\`\\\`json\\n" + report + "\\n\\\`\\\`\\\`";
  const event = { type: "item.completed", item: { type: "agent_message", text } };
  console.log('{"type":"noise","text":"preamble"}');
  console.log(JSON.stringify(event));
} else if (mode === "garbage") {
  const event = { type: "item.completed", item: { type: "agent_message", text: report } };
  console.log(JSON.stringify(event));
} else {
  // ok: emit JSONL with item.completed agent_message
  console.log('{"type":"noise","text":"preamble"}');
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: report } }));
}
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "crewel-codex-"));
  shimLog = path.join(dir, "shim.log");
  const jsPath = path.join(dir, "fake-codex.js");
  binPath = path.join(dir, "fake-codex");
  await writeFile(jsPath, shimJs);
  await writeFile(binPath, `#!/bin/sh\nexec node "${jsPath}" "$@"\n`);
  await chmod(binPath, 0o755);
  process.env.SHIM_LOG = shimLog;
});

afterEach(async () => {
  delete process.env.SHIM_LOG;
  delete process.env.SHIM_MODE;
  await rm(dir, { recursive: true, force: true });
});

function makeBundle(worktreePath: string): ContextBundle {
  return {
    team: "demo",
    participantId: "codex-1",
    role: "teammate",
    worktreePath,
    tickets: [
      {
        id: "t1",
        title: "Add the widget",
        status: "in-progress",
        dependsOn: [],
        acceptanceCriteria: ["widget renders", "tests pass"],
        scope: "Build the widget module.",
      },
    ],
    messages: [],
    progressNotes: null,
    instructions: "senior bar",
  };
}

async function readShimCalls(): Promise<
  Array<{ argv: string[]; cwd: string }>
> {
  const raw = await readFile(shimLog, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("codex adapter", () => {
  it("probes availability through --version", { timeout: 10000 }, async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    expect(await adapter.checkAvailable()).toBe(true);
    const missing = createCodexAdapter({
      bin: path.join(dir, "nope-binary"),
    });
    expect(await missing.checkAvailable()).toBe(false);
  });

  it("runs headless in the worktree with correct cwd and parses clean report via JSONL", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    const wt = path.join(dir, "wt");
    await mkdir(wt, { recursive: true });
    const result = await adapter.runTurn({
      bundle: makeBundle(wt),
      heartbeatPath: path.join(dir, "hb"),
      touchHeartbeat: () => {},
    });
    expect(result.outcome).toBe("completed");
    const validation = validateTurnReport(result.raw);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.report.status).toBe("done");
      expect(validation.report.summary).toBe("did the thing");
    }
    const calls = await readShimCalls();
    const turnCall = calls.find((c) => c.argv.includes("exec"));
    expect(turnCall).toBeDefined();
    const { realpath: rp } = await import("node:fs/promises");
    expect(await rp(turnCall!.cwd)).toBe(await rp(wt));
    expect(turnCall!.argv).toContain("exec");
    expect(turnCall!.argv).toContain("--json");
    const prompt = turnCall!.argv[turnCall!.argv.length - 1] ?? "";
    expect(prompt).toContain("Ticket t1: Add the widget");
    expect(prompt).toContain("widget renders");
    expect(prompt).toContain("senior bar");
    expect(prompt).toMatch(/TurnReport schema/);
    expect(prompt).toMatch(/read-only-by-default/);
  });

  it("extracts fenced JSON from noisy event streams", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    const wt = path.join(dir, "wt");
    await mkdir(wt, { recursive: true });
    process.env.SHIM_MODE = "fenced";
    try {
      const result = await adapter.runTurn({
        bundle: makeBundle(wt),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(result.outcome).toBe("completed");
      const validation = validateTurnReport(result.raw);
      expect(validation.ok).toBe(true);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maps rate-limit via stderr", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    process.env.SHIM_MODE = "rate";
    try {
      const limited = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(limited.outcome).toBe("rate-limited");
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maps rate-limit via JSONL turn.failed with rate_limit", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    process.env.SHIM_MODE = "rate-retry";
    try {
      const retry = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(retry.outcome).toBe("rate-limited");
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maps auth failures to failed-terminal", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    process.env.SHIM_MODE = "auth";
    try {
      const auth = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(auth.outcome).toBe("failed-terminal");
      expect(auth.error).toMatch(/auth failure/);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("treats hard crashes as failed-retryable", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    process.env.SHIM_MODE = "exit1";
    try {
      const crashed = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(crashed.outcome).toBe("failed-retryable");
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("hands unparsable final messages to the engine for retry classification", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    process.env.SHIM_MODE = "garbage";
    try {
      const result = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb"),
        touchHeartbeat: () => {},
      });
      expect(result.outcome).toBe("completed");
      const validation = validateTurnReport(result.raw);
      expect(validation.ok).toBe(false);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("core needed zero special cases", async () => {
    const adapter = createCodexAdapter({ bin: binPath });
    expect(adapter.id).toBe("codex");
    expect(knownAdapterIds()).toContain("codex");
    // Adapter conforms to AgentAdapter without engine changes: runTurn works
    const wt = path.join(dir, "wt-core");
    await mkdir(wt, { recursive: true });
    const result = await adapter.runTurn({
      bundle: makeBundle(wt),
      heartbeatPath: path.join(dir, "hb-core"),
      touchHeartbeat: () => {},
    });
    expect(result.outcome).toBe("completed");
    // renderBundle is the required contract
    const prompt = adapter.renderBundle(makeBundle(wt));
    expect(prompt).toContain("Ticket t1");
    expect(prompt).toContain(workTreePathCheck(wt));
  });

  describe("stream parsing helpers", () => {
    it("extracts the last non-empty text field from Codex JSONL", () => {
      const report = JSON.stringify({
        status: "done",
        summary: "second",
        changedFiles: [],
        testEvidence: [],
      });
      const stdout = [
        '{"type":"noise","text":"preamble"}',
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "first" },
        }),
        "not json at all",
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: report },
        }),
      ].join("\n");
      const extracted = extractCodexFinalText(stdout);
      expect(extracted).toBe(report);
    });

    it("pulls JSON objects out of fences and surrounding prose", () => {
      const candidate = parseReportCandidate(
        'here you go:\n```json\n{"status":"done","summary":"s","changedFiles":[],"testEvidence":[]}\n```\nenjoy'
      );
      const validation = validateTurnReport(candidate);
      expect(validation.ok).toBe(true);
    });

    it("handles generic text type fallback", () => {
      const stdout = JSON.stringify({ type: "text", text: "hello world" });
      expect(extractCodexFinalText(stdout)).toBe("hello world");
    });

    it("renderCodexPrompt includes required bundle fields", () => {
      const bundle = makeBundle("/tmp/wt");
      bundle.messages = [
        {
          id: "m1",
          from: "lead",
          to: "codex-1",
          kind: "clarification",
          body: "please clarify",
          createdAt: new Date().toISOString(),
        },
      ];
      bundle.progressNotes = "previous progress";
      const prompt = renderCodexPrompt(bundle);
      expect(prompt).toContain("senior bar");
      expect(prompt).toContain("Ticket t1: Add the widget");
      expect(prompt).toContain("Build the widget module");
      expect(prompt).toContain("widget renders");
      expect(prompt).toContain("from lead: please clarify");
      expect(prompt).toContain("previous progress");
      expect(prompt).toContain("/tmp/wt");
      expect(prompt).toContain("read-only-by-default");
      expect(prompt).toContain("TurnReport schema");
    });
  });
});

function workTreePathCheck(p: string): string {
  return p;
}
