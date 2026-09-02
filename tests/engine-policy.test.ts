import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function waitForFile(file: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${file}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
import {
  assignTicket,
  checkStalls,
  interruptTeammate,
  LEAD_MAILBOX,
  resumeTeammate,
  runTeammateTurn,
  startTeam,
  stopTeam,
  unfreezeTicket,
} from "../src/core/engine/index.js";
import { createMockAdapter } from "../src/core/adapters/mock.js";
import { registerAdapter } from "../src/core/adapters/index.js";
import { isPaused } from "../src/core/participants/index.js";
import { validateTickets } from "../src/core/tickets/index.js";
import { board } from "../src/core/tickets/index.js";
import { updateTicket } from "../src/core/team/store.js";
import { ensureTeammateWorktree } from "../src/core/worktrees/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-policy-"));
  await runGit("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await runGit("git", ["-C", repo, "config", "user.email", "t@t"]);
  await runGit("git", ["-C", repo, "config", "user.name", "t"]);
  await writeFile(path.join(repo, "seed.txt"), "seed\n");
  await runGit("git", ["-C", repo, "add", "."]);
  await runGit("git", ["-C", repo, "commit", "-qm", "seed"]);
  const { createTeam } = await import("../src/core/team/index.js");
  await createTeam({
    repoRoot: repo,
    name: "demo",
    leadType: "mock",
    teammatesSpec: "mock:2",
  });
  const ticketsDir = path.join(repo, ".crewel", "teams", "demo", "tickets");
  await mkdir(ticketsDir, { recursive: true });
  await writeFile(
    path.join(ticketsDir, "t1.md"),
    `---
id: t1
title: First
accepts:
  - works
---
Body.
`
  );
  await writeFile(
    path.join(ticketsDir, "t2.md"),
    `---
id: t2
title: Second
accepts:
  - works too
---
Body.
`
  );
  await validateTickets({ repoRoot: repo, team: "demo" });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function ticketJson(id: string): Promise<string> {
  return readFile(
    path.join(repo, ".crewel", "teams", "demo", "tickets", `${id}.json`),
    "utf8"
  );
}

async function jasonLog(): Promise<string> {
  return readFile(
    path.join(repo, ".crewel", "teams", "demo", "notifications", "jason.log"),
    "utf8"
  ).catch(() => "");
}

function participantFile(participant: string, file: string): string {
  return path.join(
    repo,
    ".crewel",
    "teams",
    "demo",
    "participants",
    participant,
    file
  );
}

describe("rate-limit pause", () => {
  it("auto-pauses on rate-limited outcomes and resumes cleanly", async () => {
    // mock-2 busy so the failure policy escalates instead of reassigning —
    // keeps the ticket on mock-1 across this scenario.
    await updateTicket(repo, "demo", "t2", {
      status: "in-progress",
      assignee: "mock-2",
    });
    registerAdapter(
      createMockAdapter({
        steps: [
          { kind: "fail", outcome: "rate-limited", error: "429" },
          { kind: "complete", report: { status: "done" } },
        ],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    const failed = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(failed.outcome).toBe("rate-limited");
    expect(await isPaused(repo, "demo", "mock-1")).toBe(true);
    // A paused teammate claims nothing further.
    const gated = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(gated.ran).toBe(false);
    expect(gated.reason).toBe("paused");
    expect(await jasonLog()).toMatch(/rate limit/);

    await resumeTeammate({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(await isPaused(repo, "demo", "mock-1")).toBe(false);
    const recovered = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(recovered.reportStatus).toBe("done");
  });
});

describe("interrupt semantics", () => {
  it(
    "aborts an in-flight turn without penalizing the ticket",
    { timeout: 15000 },
    async () => {
      registerAdapter(createMockAdapter({ hangUntilAbort: true }));
      await assignTicket({
        repoRoot: repo,
        team: "demo",
        ticketId: "t1",
        assignee: "mock-1",
        teammateIds: ["mock-1", "mock-2"],
      });
      const pending = runTeammateTurn({
        repoRoot: repo,
        team: "demo",
        participantId: "mock-1",
      });
      await waitForFile(participantFile("mock-1", "turn.pid"));
      expect(existsSync(participantFile("mock-1", "heartbeat"))).toBe(true);
      const signal = await interruptTeammate({
        repoRoot: repo,
        team: "demo",
        participantId: "mock-1",
      });
      expect(signal.aborted).toBe(true);
      const result = await pending;
      expect(result.outcome).toBe("aborted");

      const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
      expect(raw["status"]).toBe("assigned");
      expect(raw["attempts"]).toBeUndefined();
      expect(existsSync(participantFile("mock-1", "heartbeat"))).toBe(false);
      expect(existsSync(participantFile("mock-1", "turn.pid"))).toBe(false);
      expect(await jasonLog()).toMatch(/interrupted/);
    }
  );

  it("team stop --now aborts in-flight turns; plain stop drains", async () => {
    registerAdapter(createMockAdapter({ hangUntilAbort: true }));
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    const pending = runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await waitForFile(participantFile("mock-1", "turn.pid"));
    const stopped = await stopTeam({ repoRoot: repo, team: "demo", now: true });
    expect(stopped.mode).toBe("immediate");
    expect(stopped.interrupted).toContain("mock-1");
    const result = await pending;
    expect(result.outcome).toBe("aborted");

    // Stopped teams refuse new turns until started again.
    const gated = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(gated.reason).toBe("team-stopped");

    await startTeam({ repoRoot: repo, team: "demo" });
    registerAdapter(createMockAdapter()); // back to a completing mock
    const resumed = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(resumed.ran).toBe(true);
  });
});

describe("stall watchdog", () => {
  it("flags stale heartbeats and applies the failure policy", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await updateTicket(repo, "demo", "t1", { status: "in-progress" });
    await mkdir(path.dirname(participantFile("mock-1", "heartbeat")), {
      recursive: true,
    });
    await writeFile(participantFile("mock-1", "heartbeat"), "stale\n");

    const stalls = await checkStalls({
      repoRoot: repo,
      team: "demo",
      stalledMs: 0,
    });
    expect(stalls.map((s) => s.participantId)).toEqual(["mock-1"]);
    expect(stalls[0]?.ticketsReset).toEqual(["t1"]);
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["status"]).toBe("assigned");
    expect(raw["attempts"]).toBe(1);
    expect(await jasonLog()).toMatch(/Stall watchdog/);

    // Clean slate: no heartbeat means nothing flagged.
    rm(participantFile("mock-1", "heartbeat"), { force: true }).catch(() => {});
  });

  it("reports nothing when nobody has a heartbeat at all", async () => {
    const stalls = await checkStalls({
      repoRoot: repo,
      team: "demo",
      stalledMs: 0,
    });
    expect(stalls).toEqual([]);
  });
});

describe("failure policy: freeze, reassign, escalate", () => {
  it("freezes a ticket after three failures and thaws on demand", async () => {
    // mock-2 busy throughout: failures must accumulate on mock-1 to reach
    // the freeze threshold instead of bouncing via auto-reassignment.
    await updateTicket(repo, "demo", "t2", {
      status: "in-progress",
      assignee: "mock-2",
    });
    registerAdapter(
      createMockAdapter({
        steps: [
          { kind: "fail", outcome: "failed-terminal", error: "x1" },
          { kind: "fail", outcome: "failed-terminal", error: "x2" },
          { kind: "fail", outcome: "failed-terminal", error: "x3" },
          { kind: "complete", report: { status: "done" } },
        ],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    for (let i = 0; i < 3; i++) {
      await runTeammateTurn({
        repoRoot: repo,
        team: "demo",
        participantId: "mock-1",
      });
    }
    let raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["frozen"]).toBe(true);
    expect(await jasonLog()).toMatch(/FROZEN/);

    // Frozen tickets leave their owner's queue and block assignment.
    const gated = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(gated.reason).toBe("nothing-due");
    await expect(
      assignTicket({
        repoRoot: repo,
        team: "demo",
        ticketId: "t1",
        assignee: "mock-2",
        teammateIds: ["mock-1", "mock-2"],
      })
    ).rejects.toThrow(/frozen/);
    const columns = await board({ repoRoot: repo, team: "demo" });
    const blockedCol = columns.columns.find((c) => c.status === "blocked");
    expect(blockedCol?.tickets.map((t) => t.id)).toContain("t1");

    await unfreezeTicket({ repoRoot: repo, team: "demo", ticketId: "t1" });
    raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["frozen"]).toBeFalsy();
    const final = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    void final;
    const done = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(["done", "in-review"]).toContain(done["status"] as string);
  });

  it("auto-reassigns to an idle teammate when the worktree is clean", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [{ kind: "fail", outcome: "failed-terminal", error: "boom" }],
      })
    );
    await ensureTeammateWorktree({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    const result = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(result.outcome).toBe("failed-terminal");
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["frozen"]).toBeFalsy();
    expect(raw["assignee"]).toBe("mock-2");
    expect(raw["attempts"]).toBe(1);
    const leadMail = await readFile(
      path.join(
        repo,
        ".crewel",
        "teams",
        "demo",
        "messages",
        LEAD_MAILBOX,
        "inbox.jsonl"
      ),
      "utf8"
    ).catch(() => "");
    void leadMail;
    const mateMail = await readFile(
      path.join(
        repo,
        ".crewel",
        "teams",
        "demo",
        "messages",
        "mock-2",
        "inbox.jsonl"
      ),
      "utf8"
    );
    expect(mateMail).toMatch(/reassigned/);
  });

  it("escalates instead of reassigning when the failed worktree is dirty", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [{ kind: "fail", outcome: "failed-terminal", error: "boom" }],
      })
    );
    await ensureTeammateWorktree({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    // Leave uncommitted mess behind — inspection wins over tidiness.
    await writeFile(
      path.join(
        repo,
        ".crewel",
        "teams",
        "demo",
        "worktrees",
        "mock-1",
        "mess.txt"
      ),
      "half-finished work\n"
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["assignee"]).toBe("mock-1");
    expect(raw["attempts"]).toBe(1);
    expect(await jasonLog()).toMatch(/dirty worktree|Jason attention/);
  });

  it("escalates when every other teammate is busy", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [{ kind: "fail", outcome: "failed-terminal", error: "boom" }],
      })
    );
    await updateTicket(repo, "demo", "t2", {
      status: "in-progress",
      assignee: "mock-2",
    });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["assignee"]).toBe("mock-1");
    expect(await jasonLog()).toMatch(/no idle teammate/);
  });
});
