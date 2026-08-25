import { watch } from "node:fs";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import {
  notifyJason,
  pingDesktop,
  tailJasonLog,
  watchTeam,
} from "../src/core/notifications/index.js";
import type {
  TeamWatchEvent,
  TeamWatcher,
} from "../src/core/notifications/index.js";

const team = "demo";

let repo: string;

beforeAll(async () => {
  // Warm up macOS FSEvents: the first fs.watch stream in a process pays a
  // one-time framework init cost that can exceed our per-test timeouts and
  // swallow early events. Open and close one throwaway stream up front so
  // every real watcher below starts against a live fseventsd connection.
  const warm = await mkdtemp(path.join(tmpdir(), "crewel-warmup-"));
  const stream = watch(warm, {}, () => {});
  await sleep(300);
  stream.close();
  await rm(warm, { recursive: true, force: true });
});

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-notifications-"));
  const root = path.join(repo, ".crewel", "teams", team);
  await mkdir(path.join(root, "messages", "mock-1"), { recursive: true });
  await mkdir(path.join(root, "messages", "mock-2"), { recursive: true });
  await mkdir(path.join(root, "tickets"), { recursive: true });
  await mkdir(path.join(root, "notifications"), { recursive: true });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function teamPath(...parts: string[]): string {
  return path.join(repo, ".crewel", "teams", team, ...parts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry the triggering write until the watcher surfaces the expected event.
 * macOS FSEvents can register a brand-new stream asynchronously, so writes
 * landing within milliseconds of watch start may be missed; re-attempting
 * (unique filenames, bounded at 2s) keeps these tests deterministic without
 * weakening what they prove: the watcher wakes on file changes, unprompted.
 */
async function eventually(
  attempt: () => Promise<void>,
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("eventually: condition not met before timeout");
    }
    await attempt();
    await sleep(150); // Just past the debounce window.
  }
}

describe("notifications", () => {
  it("notifyJason appends timestamped readable lines that accumulate", async () => {
    await notifyJason({
      repoRoot: repo,
      team,
      kind: "assignment",
      body: 'Ticket "t1 — login form" assigned to mock-1.',
    });
    await notifyJason({
      repoRoot: repo,
      team,
      kind: "blocked",
      body: "t2 blocked on upstream API keys",
    });
    const log = await tailJasonLog({ repoRoot: repo, team });
    const lines = log.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(lines[0]).toContain("[assignment]");
    expect(lines[0]).toContain("assigned to mock-1");
    expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(lines[1]).toContain("[blocked]");
    expect(lines[1]).toContain("t2 blocked");
  });

  it("tailJasonLog honors sinceBytes and tolerates a missing log", async () => {
    expect(await tailJasonLog({ repoRoot: repo, team })).toBe("");
    await notifyJason({ repoRoot: repo, team, kind: "system", body: "first" });
    await notifyJason({ repoRoot: repo, team, kind: "done", body: "second" });
    const log = await tailJasonLog({ repoRoot: repo, team });
    const lines = log.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    const firstLine = lines[0] ?? "";
    const rest = await tailJasonLog({
      repoRoot: repo,
      team,
      sinceBytes: Buffer.byteLength(`${firstLine}\n`),
    });
    expect(rest).not.toContain("first");
    expect(rest).toContain("second");
  });

  it("watchTeam surfaces ticket writes as tickets events", async () => {
    const events: TeamWatchEvent[] = [];
    const watcher: TeamWatcher = await watchTeam(
      { repoRoot: repo, team },
      (event) => {
        events.push(event);
      }
    );
    try {
      let n = 0;
      await eventually(
        () => writeFile(teamPath("tickets", `t1-${n++}.json`), "{}\n", "utf8"),
        () => events.some((e) => e.source === "tickets")
      );
    } finally {
      await watcher.stop();
    }
  });

  it("watchTeam surfaces mailbox writes with the participant name", async () => {
    const events: TeamWatchEvent[] = [];
    const watcher: TeamWatcher = await watchTeam(
      { repoRoot: repo, team },
      (event) => {
        events.push(event);
      }
    );
    try {
      let n = 0;
      await eventually(
        () =>
          appendFile(
            teamPath("messages", "mock-1", "inbox.jsonl"),
            `{"id":"m${n++}"}\n`,
            "utf8"
          ),
        () =>
          events.some((e) => e.source === "mail" && e.participant === "mock-1")
      );
    } finally {
      await watcher.stop();
    }
  });

  it("watchTeam surfaces jason.log growth as jason events", async () => {
    const events: TeamWatchEvent[] = [];
    const watcher: TeamWatcher = await watchTeam(
      { repoRoot: repo, team },
      (event) => {
        events.push(event);
      }
    );
    try {
      // Watcher started before the write: push-not-poll in that order.
      await eventually(
        () =>
          notifyJason({
            repoRoot: repo,
            team,
            kind: "rate-limited",
            body: "claude-1 paused by provider 429",
          }),
        () => events.some((e) => e.source === "jason")
      );
    } finally {
      await watcher.stop();
    }
  });

  it("rapid bursts coalesce into a few events instead of flooding", async () => {
    const events: TeamWatchEvent[] = [];
    const watcher: TeamWatcher = await watchTeam(
      { repoRoot: repo, team },
      (event) => {
        events.push(event);
      }
    );
    try {
      // Prime the stream first so burst timing measures coalescing, not
      // first-event subscription latency.
      let prime = 0;
      await eventually(
        () =>
          writeFile(
            teamPath("tickets", `prime-${prime++}.md`),
            "prime\n",
            "utf8"
          ),
        () => events.some((e) => e.source === "tickets")
      );
      const baseline = events.filter((e) => e.source === "tickets").length;
      for (let i = 0; i < 5; i++) {
        await writeFile(
          teamPath("tickets", `burst-${i}.md`),
          `burst ${i}\n`,
          "utf8"
        );
      }
      // Wait well past the debounce window plus FSEvents latency.
      await sleep(500);
      const ticketEvents = events
        .filter((e) => e.source === "tickets")
        .slice(baseline);
      expect(ticketEvents.length).toBeGreaterThanOrEqual(1);
      expect(ticketEvents.length).toBeLessThanOrEqual(3);
    } finally {
      await watcher.stop();
    }
  });

  it("stop() quiets the watchers for good", async () => {
    const events: TeamWatchEvent[] = [];
    const watcher: TeamWatcher = await watchTeam(
      { repoRoot: repo, team },
      (event) => {
        events.push(event);
      }
    );
    try {
      let n = 0;
      await eventually(
        () =>
          writeFile(
            teamPath("tickets", `before-stop-${n++}.json`),
            "{}\n",
            "utf8"
          ),
        () => events.some((e) => e.source === "tickets")
      );
    } finally {
      await watcher.stop();
    }
    // Idempotent: stopping twice must not throw.
    await watcher.stop();
    const before = events.length;
    await writeFile(teamPath("tickets", "after-stop.json"), "{}\n", "utf8");
    await appendFile(
      teamPath("messages", "mock-2", "inbox.jsonl"),
      '{"id":"m2"}\n',
      "utf8"
    );
    await notifyJason({
      repoRoot: repo,
      team,
      kind: "system",
      body: "written after stop",
    });
    await sleep(200);
    expect(events.length).toBe(before);
  });

  it("pingDesktop never throws, whatever the platform decides", () => {
    expect(() => pingDesktop("crewel", "ticket t1 done")).not.toThrow();
  });
});
