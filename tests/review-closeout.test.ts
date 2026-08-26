import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveTeam } from "../src/core/archive/index.js";
import { mergeApprovedTicket } from "../src/core/checkpoints/index.js";
import { openCloseoutPR } from "../src/core/pr/index.js";
import {
  approveTicket,
  assignTicket,
  runTeammateTurn,
} from "../src/core/engine/index.js";
import { createMockAdapter } from "../src/core/adapters/mock.js";
import { registerAdapter } from "../src/core/adapters/index.js";
import { validateTickets } from "../src/core/tickets/index.js";
import { cleanGitEnv } from "../src/core/worktrees/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-review-"));
  await runGit("git", ["init", "-q", "-b", "main"], {
    cwd: repo,
    env: cleanGitEnv(),
  });
  await runGit("git", ["-C", repo, "config", "user.email", "t@t"], {
    env: cleanGitEnv(),
  });
  await runGit("git", ["-C", repo, "config", "user.name", "t"], {
    env: cleanGitEnv(),
  });
  await writeFile(path.join(repo, "seed.txt"), "seed\n");
  await runGit("git", ["-C", repo, "add", "."], { env: cleanGitEnv() });
  await runGit("git", ["-C", repo, "commit", "-qm", "seed"], {
    env: cleanGitEnv(),
  });
  const { createTeam } = await import("../src/core/team/index.js");
  await createTeam({
    repoRoot: repo,
    name: "demo",
    leadType: "mock",
    teammatesSpec: "mock:1",
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
  await validateTickets({ repoRoot: repo, team: "demo" });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("review closeout", () => {
  it("refuses to merge without a recorded review pass", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1"],
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await expect(
      mergeApprovedTicket({ repoRoot: repo, team: "demo", ticketId: "t1" })
    ).rejects.toThrow(/no recorded review pass/);
  });

  it("checkCommand failure bounces to in-progress and clears approved", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1"],
    });
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await approveTicket({ repoRoot: repo, team: "demo", ticketId: "t1" });
    // Set a failing checkCommand via direct config edit
    const configPath = path.join(
      repo,
      ".crewel",
      "teams",
      "demo",
      "config.json"
    );
    const cfg = JSON.parse(await readFile(configPath, "utf8"));
    cfg.checkCommand = "false";
    await writeFile(configPath, JSON.stringify(cfg, null, 2));
    const result = await mergeApprovedTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
    });
    expect(result.merged).toBe(false);
    expect(result.detail).toBe("check failed");
    const raw = JSON.parse(
      await readFile(
        path.join(repo, ".crewel", "teams", "demo", "tickets", "t1.json"),
        "utf8"
      )
    );
    expect(raw.status).toBe("in-progress");
    expect(raw.approved).toBe(false);
  });

  it("unconfigured checkCommand means no gate", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1"],
    });
    // Trigger lazy provisioning via a turn
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await approveTicket({ repoRoot: repo, team: "demo", ticketId: "t1" });
    // No checkCommand set, so merge should proceed
    const result = await mergeApprovedTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
    });
    expect(result.merged).toBe(true);
  });

  it("archive writes human-readable history snapshot", async () => {
    const result = await archiveTeam({ repoRoot: repo, team: "demo" });
    expect(existsSync(result.path)).toBe(true);
    const content = await readFile(result.path, "utf8");
    expect(content).toContain("demo");
    expect(content).toContain("t1");
    expect(content).toContain("First");
  });

  it("close-out PR opened integration→main, gated on Jason", async () => {
    const result = await openCloseoutPR({ repoRoot: repo, team: "demo" });
    expect(existsSync(result.path)).toBe(true);
    const content = await readFile(result.path, "utf8");
    expect(content).toContain("crewel/demo/integration");
    expect(content).toContain("main");
    expect(content).toContain("Gated on Jason");
  });
});
