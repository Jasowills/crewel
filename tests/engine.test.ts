import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerClarification,
  assignTicket,
  LEAD_MAILBOX,
  runTeammateTurn,
} from "../src/core/engine/index.js";
import { createMockAdapter } from "../src/core/adapters/mock.js";
import { registerAdapter } from "../src/core/adapters/index.js";
import type { ContextBundle } from "../src/core/adapters/types.js";
import { drainInbox, sendMessage } from "../src/core/mail/index.js";
import { validateTickets } from "../src/core/tickets/index.js";
import { board } from "../src/core/tickets/index.js";
import { summarizeBoard } from "../src/core/team/store.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-engine-"));
  await runGit("git", ["init", "-q"], { cwd: repo });
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
title: First ticket
accepts:
  - it works
---
Body one.
`
  );
  await writeFile(
    path.join(ticketsDir, "t2.md"),
    `---
id: t2
title: Second ticket
accepts:
  - it also works
---
Body two.
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

describe("turn engine", () => {
  it("skips teammates with nothing due", async () => {
    registerAdapter(createMockAdapter());
    const result = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("nothing-due");
  });

  it("assignment queues mail and flips the ticket", async () => {
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["status"]).toBe("assigned");
    expect(raw["assignee"]).toBe("mock-1");
    const inbox = await drainInbox(repo, "demo", "mock-1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("assignment");
  });

  it("rejects assignments to unknown teammates", async () => {
    await expect(
      assignTicket({
        repoRoot: repo,
        team: "demo",
        ticketId: "t1",
        assignee: "ghost",
        teammateIds: ["mock-1", "mock-2"],
      })
    ).rejects.toThrow(/unknown teammate "ghost"/);
  });

  it("runs a completing turn end-to-end", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    const result = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(result.ran).toBe(true);
    expect(result.outcome).toBe("completed");
    expect(result.reportStatus).toBe("done");
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(["done", "in-review"]).toContain(raw["status"] as string);
    // Heartbeat is cleared once the turn settles.
    expect(
      existsSync(
        path.join(
          repo,
          ".crewel",
          "teams",
          "demo",
          "participants",
          "mock-1",
          "heartbeat"
        )
      )
    ).toBe(false);
  });

  it("shows the heartbeat during the turn and hides it after", async () => {
    let seenDuringTurn: boolean | undefined;
    registerAdapter(
      createMockAdapter({
        onTurn: (_bundle, heartbeatPath) => {
          seenDuringTurn = existsSync(heartbeatPath);
        },
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(seenDuringTurn).toBe(true);
  });

  it("carries progress notes into the next bundle", async () => {
    const bundles: ContextBundle[] = [];
    registerAdapter(
      createMockAdapter({
        steps: [
          {
            kind: "complete",
            report: {
              status: "in-progress",
              summary: "halfway there",
              progressNotes: "schema done; endpoint pending",
            },
          },
          { kind: "complete", report: { status: "done" } },
        ],
        onTurn: (bundle) => {
          bundles.push(bundle);
        },
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    const mid = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(mid["status"]).toBe("in-progress");

    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(bundles[1]?.progressNotes).toBe("schema done; endpoint pending");
    const done = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(["done", "in-review"]).toContain(done["status"] as string);
  });

  it("holds needs-clarification tickets until the lead answers", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [
          {
            kind: "complete",
            report: {
              status: "needs-clarification",
              summary: "spec ambiguous",
              message: { to: LEAD_MAILBOX, body: "Which DB — sqlite or pg?" },
            },
          },
          { kind: "complete", report: { status: "done" } },
        ],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });

    const held = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(held["status"]).toBe("assigned");
    expect(held["clarification"]).toBeTruthy();

    // Board surfaces it under needs-clarification only.
    const columns = await board({ repoRoot: repo, team: "demo" });
    const nc = columns.columns.find((c) => c.status === "needs-clarification");
    expect(nc?.tickets.map((t) => t.id)).toEqual(["t1"]);
    const assignedCol = columns.columns.find((c) => c.status === "assigned");
    expect(assignedCol?.tickets).toHaveLength(0);
    const counts = await summarizeBoard(repo, "demo");
    expect(counts.byStatus["needs-clarification"]).toBe(1);

    // The lead was asked.
    const leadMail = await drainInbox(repo, "demo", LEAD_MAILBOX);
    expect(leadMail.some((m) => m.kind === "clarification")).toBe(true);

    await answerClarification({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      answer: "sqlite",
    });
    const released = JSON.parse(await ticketJson("t1")) as Record<
      string,
      unknown
    >;
    expect(released["clarification"]).toBeNull();
    const backToWork = await drainInbox(repo, "demo", "mock-1");
    expect(backToWork[0]?.kind).toBe("clarification-answer");

    const final = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(final.reportStatus).toBe("done");
  });

  it("routes blocked reports to the lead", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [
          {
            kind: "complete",
            report: {
              status: "blocked",
              summary: "waiting on upstream API keys",
            },
          },
        ],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t2",
      assignee: "mock-2",
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-2",
    });
    const raw = JSON.parse(await ticketJson("t2")) as Record<string, unknown>;
    expect(raw["status"]).toBe("blocked");
    const leadMail = await drainInbox(repo, "demo", LEAD_MAILBOX);
    expect(leadMail.some((m) => m.body.includes("blocked"))).toBe(true);
  });

  it("never trusts an invalid report as done", async () => {
    registerAdapter(
      createMockAdapter({
        steps: [{ kind: "invalid", junk: { status: "done" } }],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    const result = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(result.outcome).toBe("failed-retryable");
    const raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["status"]).toBe("assigned");
    expect(raw["attempts"]).toBe(1);
    expect(String(raw["lastError"])).toMatch(/invalid TurnReport/);
  });

  it("records attempts for hard failures and rate limits", async () => {
    // mock-2 busy: keeps the ticket on mock-1 so attempts accumulate here
    // instead of auto-reassigning per the hybrid failure policy.
    const { updateTicket } = await import("../src/core/team/store.js");
    await updateTicket(repo, "demo", "t2", {
      status: "in-progress",
      assignee: "mock-2",
    });
    registerAdapter(
      createMockAdapter({
        steps: [
          { kind: "fail", outcome: "failed-terminal", error: "boom" },
          { kind: "fail", outcome: "rate-limited", error: "429" },
        ],
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    const first = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(first.outcome).toBe("failed-terminal");
    let raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["status"]).toBe("assigned");
    expect(raw["attempts"]).toBe(1);

    const second = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(second.outcome).toBe("rate-limited");
    raw = JSON.parse(await ticketJson("t1")) as Record<string, unknown>;
    expect(raw["attempts"]).toBe(2);
  });

  it("delivers messages sent mid-turn at the next boundary, exactly once", async () => {
    let sent = false;
    registerAdapter(
      createMockAdapter({
        steps: [
          { kind: "complete", report: { status: "done" } },
          { kind: "complete", report: {} },
        ],
        onTurn: () => {
          if (sent) return;
          sent = true;
          void sendMessage({
            repoRoot: repo,
            team: "demo",
            from: "mock-2",
            to: "mock-1",
            kind: "peer",
            body: "heads up: shared util renamed",
          }).catch(() => {});
        },
      })
    );
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
    });
    const first = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    void first;
    // Give the fire-and-forget send a beat to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    void second;
    // Third turn: the message was consumed at the second boundary.
    const third = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    expect(third.ran).toBe(false);

    const archivePath = path.join(
      repo,
      ".crewel",
      "teams",
      "demo",
      "messages",
      "mock-1",
      "archive.jsonl"
    );
    const archive = await readFile(archivePath, "utf8");
    const peerMessages = archive
      .split("\n")
      .filter((line) => line.includes('"kind":"peer"'));
    expect(peerMessages).toHaveLength(1);
  });

  it("rejects turns for participants outside the roster", async () => {
    registerAdapter(createMockAdapter());
    await expect(
      runTeammateTurn({
        repoRoot: repo,
        team: "demo",
        participantId: "ghost-1",
      })
    ).rejects.toThrow(/unknown teammate "ghost-1"/);
  });
});
