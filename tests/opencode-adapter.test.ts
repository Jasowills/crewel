import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpencodeAdapter,
  extractFinalText,
  parseReportCandidate,
} from "../src/core/adapters/opencode.js";
import type { ContextBundle } from "../src/core/adapters/types.js";
import { validateTurnReport } from "../src/core/adapters/types.js";

const run = promisify(execFile);

let dir: string;
let shimLog: string;
let binPath: string;

const shimJs = `
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.SHIM_LOG,
  JSON.stringify({ argv: args, cwd: process.cwd() }) + "\\n"
);
const mode = process.env.SHIM_MODE ?? "ok";
if (args.includes("--version")) { console.log("opencode 0.0.0-shim"); process.exit(0); }
if (mode === "exit1") { console.error("something broke badly"); process.exit(3); }
if (mode === "rate") { console.error("Error: 429 rate limit exceeded for provider"); process.exit(1); }
if (mode === "auth") { console.error("authentication failed: not logged in"); process.exit(1); }
const report = mode === "garbage"
  ? "I wandered the codebase but produced nothing machine-readable"
  : JSON.stringify({ status: "done", summary: "did the thing", changedFiles: ["src/a.ts"], testEvidence: ["npm test"] });
if (mode === "fenced") {
  const event = { type: "text", text: "intro prose\\n\\\`\\\`\\\`json\\n" + report + "\\n\\\`\\\`\\\`" };
  console.log('{"part":"noise"}');
  console.log(JSON.stringify(event));
} else {
  console.log('{"type":"text","text":' + JSON.stringify(report) + "}"); 
}
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "crewel-oc-"));
  shimLog = path.join(dir, "shim.log");
  const jsPath = path.join(dir, "fake-opencode.js");
  binPath = path.join(dir, "fake-opencode");
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
    participantId: "opencode-1",
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

describe("opencode adapter", () => {
  it("probes availability through --version", async () => {
    const adapter = createOpencodeAdapter({ bin: binPath });
    expect(await adapter.checkAvailable()).toBe(true);
    const missing = createOpencodeAdapter({
      bin: path.join(dir, "nope-binary"),
    });
    expect(await missing.checkAvailable()).toBe(false);
  });

  it("runs headless in the worktree and parses a clean report", async () => {
    const adapter = createOpencodeAdapter({ bin: binPath });
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
    // First call is the availability probe; second is the turn.
    const turnCall = calls.find((c) => c.argv.includes("run"));
    // /var is a symlink to /private/var on macOS — compare resolved paths
    const { realpath: rp } = await import("node:fs/promises");
    expect(turnCall).toBeDefined();
    expect(await rp(turnCall!.cwd)).toBe(await rp(wt));
    const prompt = turnCall?.argv[turnCall.argv.indexOf("--format") + 2] ?? "";
    expect(prompt).toContain("Ticket t1: Add the widget");
    expect(prompt).toContain("widget renders");
    expect(prompt).toContain("senior bar");
    expect(prompt).toMatch(/TurnReport schema/);
  });

  it("extracts fenced JSON from noisy event streams", async () => {
    const adapter = createOpencodeAdapter({ bin: binPath });
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

  it("maps rate-limit and auth signatures onto the outcome contract", async () => {
    const adapter = createOpencodeAdapter({ bin: binPath });
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

  it("treats hard crashes as failed-retryable, never done", async () => {
    const adapter = createOpencodeAdapter({ bin: binPath });
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
    const adapter = createOpencodeAdapter({ bin: binPath });
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

  describe("stream parsing helpers", () => {
    it("extracts the last non-empty text field", () => {
      const stdout = [
        '{"part":"noise"}',
        '{"type":"text","text":"first"}',
        "not json at all",
        '{"nested":{"parts":[{"type":"text","text":"second"}]}}',
      ].join("\n");
      expect(extractFinalText(stdout)).toBe("second");
    });

    it("pulls JSON objects out of fences and surrounding prose", () => {
      const candidate = parseReportCandidate(
        'here you go:\n```json\n{"status":"done","summary":"s","changedFiles":[],"testEvidence":[]}\n```\nenjoy'
      );
      const validation = validateTurnReport(candidate);
      expect(validation.ok).toBe(true);
    });
  });
});

const LIVE = process.env.CREWEL_LIVE_OPENCODE === "1";
describe.skipIf(!LIVE)("live opencode integration", () => {
  it(
    "completes a scoped ticket against the real CLI",
    { timeout: 10 * 60 * 1000 },
    async () => {
      const repo = await mkdtemp(path.join(tmpdir(), "crewel-live-"));
      try {
        await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
        await run("git", ["-C", repo, "config", "user.email", "t@t"]);
        await run("git", ["-C", repo, "config", "user.name", "t"]);
        await writeFile(path.join(repo, "README.md"), "# scratch\n");
        await run("git", ["-C", repo, "add", "."]);
        await run("git", ["-C", repo, "commit", "-qm", "seed"]);
        const adapter = createOpencodeAdapter();
        expect(await adapter.checkAvailable()).toBe(true);
        const bundle = makeBundle(repo);
        bundle.tickets = [
          {
            id: "hello",
            title: "Create hello.txt",
            status: "in-progress",
            dependsOn: [],
            acceptanceCriteria: ["a file hello.txt exists containing hello"],
            scope:
              "Create a file named hello.txt in the repository root whose content is exactly: hello",
          },
        ];
        const result = await adapter.runTurn({
          bundle,
          heartbeatPath: path.join(repo, "heartbeat"),
          touchHeartbeat: () => {},
        });
        expect(result.outcome).toBe("completed");
        const validation = validateTurnReport(result.raw);
        expect(validation.ok).toBe(true);
        expect(existsSync(path.join(repo, "hello.txt"))).toBe(true);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  );
});
