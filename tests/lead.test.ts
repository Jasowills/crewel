import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdapter } from "../src/core/adapters/index.js";
import { createMockAdapter } from "../src/core/adapters/mock.js";
import type { ContextBundle } from "../src/core/adapters/types.js";
import { CrewelError } from "../src/core/errors.js";
import {
  answerClarification,
  runTeammateTurn,
} from "../src/core/engine/index.js";
import {
  DECOMPOSITION_CONTRACT,
  createMockLeadAdapter,
  decomposeRequest,
} from "../src/core/lead/index.js";
import { board, validateTickets } from "../src/core/tickets/index.js";
import { runCli } from "../src/cli.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-lead-"));
  await runGit("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await runGit("git", ["-C", repo, "config", "user.email", "t@t"]);
  await runGit("git", ["-C", repo, "config", "user.name", "t"]);
  await writeFile(path.join(repo, "README.md"), "# scratch\n");
  await runGit("git", ["-C", repo, "add", "."]);
  await runGit("git", ["-C", repo, "commit", "-qm", "seed"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(repo, { recursive: true, force: true });
});

async function listOutsideCrewel(root: string): Promise<string[]> {
  const entries = await readdir(root);
  return entries.filter((e) => e !== ".crewel" && e !== ".git");
}

describe("lead decomposition", () => {
  it("yields tickets that pass validation and are assignable", async () => {
    const specs = [
      {
        id: "auth-schema",
        title: "Add auth schema",
        scope: "Create migration for users table with password hash.",
        accepts: ["migration runs", "users table exists"],
      },
      {
        id: "login-endpoint",
        title: "Login endpoint",
        scope: "POST /login returns JWT on valid credentials.",
        depends: ["auth-schema"],
        accepts: ["POST /login returns token", "bad credentials rejected"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-a", specs));
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-a",
      teammatesSpec: "mock:2",
    });
    const result = await decomposeRequest({
      repoRoot: repo,
      team: "demo",
      request: "Implement login flow per spec",
    });
    expect(result.count).toBe(2);
    expect(result.ticketIds).toEqual(["auth-schema", "login-endpoint"]);

    const columns = await board({ repoRoot: repo, team: "demo" });
    expect(columns.total).toBe(2);
    // Each ticket is open or assigned (decomposition assigns round-robin)
    for (const ticket of columns.columns.flatMap((c) => c.tickets)) {
      expect(["open", "assigned", "in-progress"]).toContain(ticket.status);
    }
    const assigned = columns.columns.find((c) => c.status === "assigned");
    expect(assigned?.tickets.length).toBeGreaterThan(0);
    // Depends valid
    const allTickets = columns.columns.flatMap((c) => c.tickets);
    const login = allTickets.find((t) => t.id === "login-endpoint");
    expect(login?.dependsOn).toEqual(["auth-schema"]);

    const { written } = await validateTickets({ repoRoot: repo, team: "demo" });
    expect(written).toBe(2);
  });

  it("dependency edges form an acyclic graph with no orphan blockers", async () => {
    const specs = [
      {
        id: "t1",
        title: "One",
        scope: "Do one.",
        accepts: ["one works"],
      },
      {
        id: "t2",
        title: "Two",
        scope: "Do two.",
        depends: ["t1"],
        accepts: ["two works"],
      },
      {
        id: "t3",
        title: "Three",
        scope: "Do three.",
        depends: ["t2"],
        accepts: ["three works"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-chain", specs));
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-chain",
      teammatesSpec: "mock:2",
    });
    const result = await decomposeRequest({
      repoRoot: repo,
      team: "demo",
      request: "Chain of three",
    });
    expect(result.ticketIds).toEqual(["t1", "t2", "t3"]);
    const columns = await board({ repoRoot: repo, team: "demo" });
    expect(columns.total).toBe(3);
    // Verify no orphan: every depends exists in set
    const ids = new Set(
      columns.columns.flatMap((c) => c.tickets).map((t) => t.id)
    );
    for (const ticket of columns.columns.flatMap((c) => c.tickets)) {
      for (const dep of ticket.dependsOn) {
        expect(ids.has(dep)).toBe(true);
      }
    }
    // Verify acyclic: t1 has no depends, t3 depends on t2 etc.
    const byId = new Map(
      columns.columns.flatMap((c) => c.tickets).map((t) => [t.id, t])
    );
    expect(byId.get("t1")?.dependsOn).toEqual([]);
    expect(byId.get("t2")?.dependsOn).toEqual(["t1"]);
    expect(byId.get("t3")?.dependsOn).toEqual(["t2"]);

    // Also prove invalid cycles are rejected and write nothing
    const badSpecs = [
      {
        id: "a",
        title: "A",
        scope: "a",
        depends: ["b"],
        accepts: ["x"],
      },
      {
        id: "b",
        title: "B",
        scope: "b",
        depends: ["a"],
        accepts: ["y"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-bad", badSpecs));
    const { createTeam: createTeam2 } =
      await import("../src/core/team/index.js");
    // Need fresh repo for cycle test to avoid existing tickets
    const repo2 = await mkdtemp(path.join(tmpdir(), "crewel-lead-cycle-"));
    try {
      await runGit("git", ["init", "-q", "-b", "main"], { cwd: repo2 });
      await runGit("git", ["-C", repo2, "config", "user.email", "t@t"]);
      await runGit("git", ["-C", repo2, "config", "user.name", "t"]);
      await writeFile(path.join(repo2, "README.md"), "# scratch\n");
      await runGit("git", ["-C", repo2, "add", "."]);
      await runGit("git", ["-C", repo2, "commit", "-qm", "seed"]);
      await createTeam2({
        repoRoot: repo2,
        name: "demo",
        leadType: "lead-bad",
        teammatesSpec: "mock:1",
      });
      await expect(
        decomposeRequest({
          repoRoot: repo2,
          team: "demo",
          request: "cycle",
        })
      ).rejects.toThrow(/cycle/);
      // No tickets written beyond the failed attempt
      const entries = await readdir(
        path.join(repo2, ".crewel", "teams", "demo", "tickets")
      ).catch(() => [] as string[]);
      const mds = entries.filter((e) => e.endsWith(".md"));
      expect(mds.length).toBe(0);
    } finally {
      await rm(repo2, { recursive: true, force: true });
    }
  });

  it("the lead holds no code-writing permissions", async () => {
    const specs = [
      {
        id: "t1",
        title: "One",
        scope: "Do one.",
        accepts: ["works"],
      },
    ];
    // Track whether lead's worktree path was misused for file writes
    let leadWorktreePath = "";
    const capturingAdapter = {
      id: "lead-nocode",
      async checkAvailable() {
        return true;
      },
      renderBundle() {
        return "";
      },
      async runTurn(input: {
        bundle: ContextBundle;
        heartbeatPath: string;
        touchHeartbeat: () => void | Promise<void>;
      }) {
        leadWorktreePath = input.bundle.worktreePath;
        await input.touchHeartbeat();
        // Lead must NOT write outside .crewel; we return array directly
        return { outcome: "completed" as const, raw: specs };
      },
    };
    registerAdapter(capturingAdapter);
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-nocode",
      teammatesSpec: "mock:1",
    });
    const before = await listOutsideCrewel(repo);
    const beforeSet = new Set(before);
    await decomposeRequest({
      repoRoot: repo,
      team: "demo",
      request: "Do not write code",
    });
    // Lead's worktree should be repoRoot, not a separate worktree under .crewel
    expect(leadWorktreePath).toBe(repo);
    // No worktree dir for lead
    expect(
      existsSync(
        path.join(repo, ".crewel", "teams", "demo", "worktrees", "lead")
      )
    ).toBe(false);
    // No files created outside .crewel
    const after = await listOutsideCrewel(repo);
    expect(after).toEqual([...beforeSet]);
    // Heartbeat file for lead must not linger as a code artifact outside tickets
    const heartbeat = path.join(
      repo,
      ".crewel",
      "teams",
      "demo",
      "participants",
      "lead",
      "heartbeat"
    );
    expect(existsSync(heartbeat)).toBe(false);
    // Only tickets written
    const tickets = await readdir(
      path.join(repo, ".crewel", "teams", "demo", "tickets")
    );
    expect(tickets).toContain("t1.md");
    expect(tickets).toContain("t1.json");
  });

  it("clarification loop still works after decomposition", async () => {
    const specs = [
      {
        id: "feature",
        title: "Feature",
        scope: "Build feature with ambiguous spec.",
        accepts: ["feature works"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-clarify", specs));
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-clarify",
      teammatesSpec: "mock:1",
    });
    await decomposeRequest({
      repoRoot: repo,
      team: "demo",
      request: "Ambiguous request",
    });

    // Now teammate asks for clarification
    registerAdapter(
      createMockAdapter({
        id: "mock",
        steps: [
          {
            kind: "complete",
            report: {
              status: "needs-clarification",
              summary: "spec ambiguous",
              message: { to: "lead", body: "Which DB?" },
            },
          },
          { kind: "complete", report: { status: "done", summary: "done" } },
        ],
      })
    );
    const first = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(first.reportStatus).toBe("needs-clarification");
    const board1 = await board({ repoRoot: repo, team: "demo" });
    const nc = board1.columns.find((c) => c.status === "needs-clarification");
    expect(nc?.tickets.map((t) => t.id)).toContain("feature");

    await answerClarification({
      repoRoot: repo,
      team: "demo",
      ticketId: "feature",
      answer: "Use sqlite",
    });
    const second = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(second.reportStatus).toBe("done");
    const board2 = await board({ repoRoot: repo, team: "demo" });
    const inReview = board2.columns.find((c) => c.status === "in-review");
    const doneCol = board2.columns.find((c) => c.status === "done");
    const combined = [
      ...(inReview?.tickets ?? []),
      ...(doneCol?.tickets ?? []),
    ].map((t) => t.id);
    expect(combined).toContain("feature");
  });

  it("works with any nominated lead type and prompt contains request", async () => {
    let captured: ContextBundle | undefined;
    const specs = [
      {
        id: "a",
        title: "A",
        scope: "scope a",
        accepts: ["a works"],
      },
    ];
    const customAdapter = {
      id: "custom-lead",
      async checkAvailable() {
        return true;
      },
      renderBundle(bundle: ContextBundle) {
        return bundle.instructions;
      },
      async runTurn(input: {
        bundle: ContextBundle;
        heartbeatPath: string;
        touchHeartbeat: () => void | Promise<void>;
      }) {
        captured = input.bundle;
        await input.touchHeartbeat();
        return { outcome: "completed" as const, raw: specs };
      },
    };
    registerAdapter(customAdapter);
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "custom-lead",
      teammatesSpec: "mock:1",
    });
    const request = "Implement login per docs/spec.md with OAuth";
    await decomposeRequest({ repoRoot: repo, team: "demo", request });
    expect(captured).toBeDefined();
    expect(captured?.role).toBe("lead");
    expect(captured?.tickets[0]?.scope).toContain(request);
    expect(captured?.instructions).toContain(DECOMPOSITION_CONTRACT);
    expect(captured?.instructions).toContain("non-coding");
  });

  it("CLI team run --request decomposes and prints ids", async () => {
    const specs = [
      {
        id: "cli-t1",
        title: "CLI ticket",
        scope: "Do cli thing.",
        accepts: ["cli works"],
      },
      {
        id: "cli-t2",
        title: "CLI ticket two",
        scope: "Do more.",
        accepts: ["more works"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-cli", specs));
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-cli",
      teammatesSpec: "mock:1",
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) =>
      logs.push(String(msg))
    );
    const code = await runCli(
      ["team", "run", "--request", "hello from cli", "--team", "demo"],
      { repoRoot: repo }
    );
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(
      /✓ decomposed into 2 tickets: cli-t1, cli-t2/
    );
    // Works with positional team as well
    const specs2 = [
      {
        id: "pos-t1",
        title: "Pos",
        scope: "pos scope",
        accepts: ["ok"],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-pos", specs2));
    // Need second repo for positional test to avoid duplicate team active issue
    const repo2 = await mkdtemp(path.join(tmpdir(), "crewel-lead-cli2-"));
    try {
      await runGit("git", ["init", "-q", "-b", "main"], { cwd: repo2 });
      await runGit("git", ["-C", repo2, "config", "user.email", "t@t"]);
      await runGit("git", ["-C", repo2, "config", "user.name", "t"]);
      await writeFile(path.join(repo2, "README.md"), "# scratch\n");
      await runGit("git", ["-C", repo2, "add", "."]);
      await runGit("git", ["-C", repo2, "commit", "-qm", "seed"]);
      const { createTeam: ct2 } = await import("../src/core/team/index.js");
      await ct2({
        repoRoot: repo2,
        name: "demo",
        leadType: "lead-pos",
        teammatesSpec: "mock:1",
      });
      const logs2: string[] = [];
      vi.spyOn(console, "log").mockImplementation((m) => logs2.push(String(m)));
      const code2 = await runCli(
        ["team", "run", "demo", "--request", "positional team"],
        { repoRoot: repo2 }
      );
      expect(code2).toBe(0);
      expect(logs2.join("\n")).toMatch(/✓ decomposed into 1 tickets: pos-t1/);
    } finally {
      await rm(repo2, { recursive: true, force: true });
    }
  });

  it("rejects invalid decomposition as failed-retryable", async () => {
    const bad = [
      {
        id: "Bad_ID!",
        title: "",
        scope: "",
        accepts: [],
      },
    ];
    registerAdapter(createMockLeadAdapter("lead-invalid", bad));
    const { createTeam } = await import("../src/core/team/index.js");
    await createTeam({
      repoRoot: repo,
      name: "demo",
      leadType: "lead-invalid",
      teammatesSpec: "mock:1",
    });
    await expect(
      decomposeRequest({
        repoRoot: repo,
        team: "demo",
        request: "bad",
      })
    ).rejects.toThrow(CrewelError);
    await expect(
      decomposeRequest({
        repoRoot: repo,
        team: "demo",
        request: "bad",
      })
    ).rejects.toThrow(/lowercase slug|non-empty/);
    const ticketsDir = path.join(repo, ".crewel", "teams", "demo", "tickets");
    const entries = await readdir(ticketsDir).catch(() => [] as string[]);
    expect(entries.filter((e) => e.endsWith(".md"))).toHaveLength(0);
  });
});
