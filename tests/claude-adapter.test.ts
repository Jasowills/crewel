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
  createClaudeAdapter,
  extractClaudeFinalText,
  parseClaudeReportCandidate,
} from "../src/core/adapters/claude.js";
import { createOpencodeAdapter } from "../src/core/adapters/opencode.js";
import type { ContextBundle } from "../src/core/adapters/types.js";
import { validateTurnReport } from "../src/core/adapters/types.js";

let dir: string;
let shimLog: string;
let binPath: string;

const shimJs = `
const fs = require("fs");
const args = process.argv.slice(2);
try { fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + "\\n"); } catch {}
const mode = process.env.SHIM_MODE ?? "ok";
if (args.includes("--version")) { console.log("claude 0.0.0-shim"); process.exit(0); }
if (mode === "exit1") { console.error("something broke badly"); process.exit(3); }
if (mode === "rate") { console.error("Error: 429 rate limit exceeded for provider"); process.exit(1); }
if (mode === "rate-retry") {
  console.log(JSON.stringify({ type: "api_retry", error: "rate_limit", message: "rate limited" }));
  process.exit(0);
}
if (mode === "auth") { console.error("authentication_failed: not logged in"); process.exit(1); }
const report = mode === "garbage"
  ? "I wandered the codebase but produced nothing machine-readable"
  : JSON.stringify({ status: "done", summary: "did the thing", changedFiles: ["src/a.ts"], testEvidence: ["npm test"] });
if (mode === "fenced") {
  const event = { type: "text", text: "intro prose\\n\\\`\\\`\\\`json\\n" + report + "\\n\\\`\\\`\\\`" };
  console.log('{"part":"noise"}');
  console.log(JSON.stringify(event));
} else if (mode === "result-object") {
  console.log(JSON.stringify({ result: report }));
} else {
  console.log(JSON.stringify({ type: "text", text: report }));
}
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "crewel-claude-"));
  shimLog = path.join(dir, "shim.log");
  const jsPath = path.join(dir, "fake-claude.js");
  binPath = path.join(dir, "fake-claude");
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
    participantId: "claude-code-1",
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

describe("claude adapter", () => {
  it("probes availability through --version", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    expect(await adapter.checkAvailable()).toBe(true);
    const missing = createClaudeAdapter({ bin: path.join(dir, "nope-binary") });
    expect(await missing.checkAvailable()).toBe(false);
  });

  it("runs headless in the worktree with permission flags and parses a clean report", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
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
    }
    const calls = await readShimCalls();
    const turnCall = calls.find((c) => c.argv.includes("-p"));
    expect(turnCall).toBeDefined();
    const { realpath: rp } = await import("node:fs/promises");
    expect(await rp(turnCall!.cwd)).toBe(await rp(wt));
    expect(turnCall!.argv).toContain("--output-format");
    expect(turnCall!.argv).toContain("json");
    expect(turnCall!.argv).toContain("--dangerously-skip-permissions");
    const prompt = turnCall!.argv[turnCall!.argv.indexOf("-p") + 1] ?? "";
    expect(prompt).toContain("Ticket t1: Add the widget");
    expect(prompt).toContain("widget renders");
    expect(prompt).toContain("senior bar");
  });

  it("handles Claude result-object output shape", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    process.env.SHIM_MODE = "result-object";
    try {
      const wt = path.join(dir, "wt2");
      await mkdir(wt, { recursive: true });
      const result = await adapter.runTurn({
        bundle: makeBundle(wt),
        heartbeatPath: path.join(dir, "hb2"),
        touchHeartbeat: () => {},
      });
      expect(result.outcome).toBe("completed");
      expect(validateTurnReport(result.raw).ok).toBe(true);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("extracts fenced JSON from noisy event streams", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    const wt = path.join(dir, "wt3");
    await mkdir(wt, { recursive: true });
    process.env.SHIM_MODE = "fenced";
    try {
      const result = await adapter.runTurn({
        bundle: makeBundle(wt),
        heartbeatPath: path.join(dir, "hb3"),
        touchHeartbeat: () => {},
      });
      expect(result.outcome).toBe("completed");
      expect(validateTurnReport(result.raw).ok).toBe(true);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maps rate-limit via stderr and via typed api_retry events", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    process.env.SHIM_MODE = "rate";
    try {
      const limited = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb-rate"),
        touchHeartbeat: () => {},
      });
      expect(limited.outcome).toBe("rate-limited");
    } finally {
      delete process.env.SHIM_MODE;
    }
    process.env.SHIM_MODE = "rate-retry";
    try {
      const retry = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb-retry"),
        touchHeartbeat: () => {},
      });
      expect(retry.outcome).toBe("rate-limited");
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maps auth failures to failed-terminal", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    process.env.SHIM_MODE = "auth";
    try {
      const auth = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb-auth"),
        touchHeartbeat: () => {},
      });
      expect(auth.outcome).toBe("failed-terminal");
      expect(auth.error).toMatch(/auth failure/);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("treats hard crashes as failed-retryable, never done", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    process.env.SHIM_MODE = "exit1";
    try {
      const crashed = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb-crash"),
        touchHeartbeat: () => {},
      });
      expect(crashed.outcome).toBe("failed-retryable");
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("hands unparsable final messages to the engine for retry classification", async () => {
    const adapter = createClaudeAdapter({ bin: binPath });
    process.env.SHIM_MODE = "garbage";
    try {
      const result = await adapter.runTurn({
        bundle: makeBundle(dir),
        heartbeatPath: path.join(dir, "hb-garbage"),
        touchHeartbeat: () => {},
      });
      expect(result.outcome).toBe("completed");
      expect(validateTurnReport(result.raw).ok).toBe(false);
    } finally {
      delete process.env.SHIM_MODE;
    }
  });

  it("maintains parity with opencode on identical bundles", async () => {
    // Same shim behavior for both adapters should yield same outcome
    const claudeAdapter = createClaudeAdapter({ bin: binPath });
    // Create a second shim for opencode with same logic but opencode id
    const opencodeDir = await mkdtemp(path.join(tmpdir(), "crewel-oc-parity-"));
    const opencodeLog = path.join(opencodeDir, "shim.log");
    const opencodeJs = path.join(opencodeDir, "fake-opencode.js");
    const opencodeBin = path.join(opencodeDir, "fake-opencode");
    const opencodeShimJs = `
const fs = require("fs");
try { fs.appendFileSync(process.env.SHIM_LOG, "opencode run\\n"); } catch {}
if (process.argv.slice(2).includes("--version")) { console.log("opencode 0.0.0-shim"); process.exit(0); }
console.log(JSON.stringify({ type: "text", text: JSON.stringify({ status: "done", summary: "did the thing", changedFiles: ["src/a.ts"], testEvidence: ["npm test"] }) }));
`;
    await writeFile(opencodeJs, opencodeShimJs);
    await writeFile(opencodeBin, `#!/bin/sh\nexec node "${opencodeJs}" "$@"\n`);
    await chmod(opencodeBin, 0o755);
    const savedLog = process.env.SHIM_LOG;
    process.env.SHIM_LOG = opencodeLog;
    const opencodeAdapter = createOpencodeAdapter({ bin: opencodeBin });
    const bundle = makeBundle(dir);
    // Run both — they should both complete with same status
    process.env.SHIM_LOG = shimLog;
    const claudeResult = await claudeAdapter.runTurn({
      bundle,
      heartbeatPath: path.join(dir, "hb-parity-claude"),
      touchHeartbeat: () => {},
    });
    process.env.SHIM_LOG = opencodeLog;
    const opencodeResult = await opencodeAdapter.runTurn({
      bundle,
      heartbeatPath: path.join(dir, "hb-parity-oc"),
      touchHeartbeat: () => {},
    });
    process.env.SHIM_LOG = savedLog;
    await rm(opencodeDir, { recursive: true, force: true });
    expect(claudeResult.outcome).toBe("completed");
    expect(opencodeResult.outcome).toBe("completed");
    expect(validateTurnReport(claudeResult.raw).ok).toBe(true);
    expect(validateTurnReport(opencodeResult.raw).ok).toBe(true);
  });

  describe("stream parsing helpers", () => {
    it("extracts the last non-empty text field", () => {
      const stdout = [
        '{"part":"noise"}',
        '{"type":"text","text":"first"}',
        "not json at all",
        '{"nested":{"parts":[{"type":"text","text":"second"}]}}',
      ].join("\n");
      expect(extractClaudeFinalText(stdout)).toBe("second");
    });

    it("pulls JSON objects out of fences and surrounding prose", () => {
      const candidate = parseClaudeReportCandidate(
        'here you go:\n```json\n{"status":"done","summary":"s","changedFiles":[],"testEvidence":[]}\n```\nenjoy'
      );
      expect(validateTurnReport(candidate).ok).toBe(true);
    });

    it("handles single result-object shape", () => {
      const stdout = JSON.stringify({
        result: JSON.stringify({
          status: "done",
          summary: "s",
          changedFiles: [],
          testEvidence: [],
        }),
      });
      expect(extractClaudeFinalText(stdout)).toContain("done");
    });
  });
});
