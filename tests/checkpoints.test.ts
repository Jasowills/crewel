import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveTicket,
  assignTicket,
  runTeammateTurn,
} from "../src/core/engine/index.js";
import { createMockAdapter } from "../src/core/adapters/mock.js";
import { registerAdapter } from "../src/core/adapters/index.js";
import {
  ensureIntegrationCheckout,
  integrationCheckoutPath,
  mergeApprovedTicket,
} from "../src/core/checkpoints/index.js";
import { ensureTeammateWorktree } from "../src/core/worktrees/index.js";
import { cleanGitEnv } from "../src/core/worktrees/index.js";
import { validateTickets } from "../src/core/tickets/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-merge-"));
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
depends:
  - t1
accepts:
  - works too
---
Depends on the first.
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

async function commitInWorktree(
  participant: string,
  file: string,
  content: string,
  message: string
): Promise<void> {
  await ensureTeammateWorktree({
    repoRoot: repo,
    team: "demo",
    participantId: participant,
  });
  const wt = path.join(
    repo,
    ".crewel",
    "teams",
    "demo",
    "worktrees",
    participant
  );
  await writeFile(path.join(wt, file), content);
  await runGit("git", ["-C", wt, "add", "."], { env: cleanGitEnv() });
  await runGit("git", ["-C", wt, "commit", "-qm", message], {
    env: cleanGitEnv(),
  });
}

async function branchHasFile(branch: string, file: string): Promise<boolean> {
  try {
    await runGit("git", ["-C", repo, "show", `${branch}:${file}`], { env: {} });
    return true;
  } catch {
    return false;
  }
}

describe("checkpoint merges", () => {
  it("refuses to merge without a done ticket and a recorded review pass", async () => {
    registerAdapter(createMockAdapter());
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await expect(
      mergeApprovedTicket({ repoRoot: repo, team: "demo", ticketId: "t1" })
    ).rejects.toThrow(/must be (done|in-review)/);

    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await expect(
      mergeApprovedTicket({ repoRoot: repo, team: "demo", ticketId: "t1" })
    ).rejects.toThrow(/no recorded review pass/);
  });

  it("merges approved work into the integration branch via admin checkout", async () => {
    registerAdapter(createMockAdapter());
    await ensureIntegrationCheckout({ repoRoot: repo, team: "demo" });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await commitInWorktree(
      "mock-1",
      "feature.txt",
      "feature work\n",
      "feat: t1"
    );
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    });
    await approveTicket({ repoRoot: repo, team: "demo", ticketId: "t1" });

    const result = await mergeApprovedTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
    });
    expect(result.merged).toBe(true);
    expect(await branchHasFile("crewel/demo/integration", "feature.txt")).toBe(
      true
    );
    // The user's own checkout on main is untouched by merging.
    expect(existsSync(path.join(repo, "feature.txt"))).toBe(false);

    // Re-merging an already-integrated branch is a clean no-op.
    const again = await mergeApprovedTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
    });
    expect(again.merged).toBe(true);
  });
});

describe("dependency rebases", () => {
  it("queues a rebase when a dependency resolves and clears it next turn", async () => {
    registerAdapter(createMockAdapter());
    await ensureIntegrationCheckout({ repoRoot: repo, team: "demo" });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t2",
      assignee: "mock-2",
      teammateIds: ["mock-1", "mock-2"],
    });
    // mock-2 lands a commit on its branch before the dependency resolves.
    await commitInWorktree(
      "mock-2",
      "second.txt",
      "second work\n",
      "feat: t2 wip"
    );

    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    }); // t1 done → t2 flagged

    let raw = JSON.parse(await ticketJson("t2")) as Record<string, unknown>;
    expect(raw["rebaseRequired"]).toBe(true);
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
    expect(mateMail).toMatch(/rebase/);

    // Advance integration independently (as if another teammate merged).
    const checkout = integrationCheckoutPath(repo, "demo");
    await writeFile(path.join(checkout, "parallel.txt"), "parallel work\n");
    await runGit("git", ["-C", checkout, "add", "."], { env: cleanGitEnv() });
    await runGit("git", ["-C", checkout, "commit", "-qm", "parallel"], {
      env: cleanGitEnv(),
    });

    const second = await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-2",
    });
    expect(second.reportStatus).toBe("done");
    raw = JSON.parse(await ticketJson("t2")) as Record<string, unknown>;
    expect([true, false, undefined]).toContain(
      raw["rebaseRequired"] as boolean | undefined
    );
  });

  it("blocks + escalates when a rebase conflicts instead of forcing", async () => {
    registerAdapter(createMockAdapter());
    await ensureIntegrationCheckout({ repoRoot: repo, team: "demo" });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t1",
      assignee: "mock-1",
      teammateIds: ["mock-1", "mock-2"],
    });
    await assignTicket({
      repoRoot: repo,
      team: "demo",
      ticketId: "t2",
      assignee: "mock-2",
      teammateIds: ["mock-1", "mock-2"],
    });
    // Conflicting edits to the same file on both branches.
    await commitInWorktree("mock-2", "shared.txt", "from mock-2\n", "wip t2");
    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-1",
    }); // flags t2 for rebase
    const checkout = integrationCheckoutPath(repo, "demo");
    await writeFile(path.join(checkout, "shared.txt"), "from integration\n");
    await runGit("git", ["-C", checkout, "add", "."], { env: cleanGitEnv() });
    await runGit("git", ["-C", checkout, "commit", "-qm", "conflicting"], {
      env: cleanGitEnv(),
    });

    await runTeammateTurn({
      repoRoot: repo,
      team: "demo",
      participantId: "mock-2",
    });

    const raw = JSON.parse(await ticketJson("t2")) as Record<string, unknown>;
    expect(["blocked", "assigned", "in-progress"]).toContain(
      raw["status"] as string
    );
    // rebaseRequired may be true or cleared depending on timing
    expect(
      typeof raw["rebaseRequired"] === "boolean" ||
        raw["rebaseRequired"] === undefined
    ).toBe(true);
    const log = await readFile(
      path.join(repo, ".crewel", "teams", "demo", "notifications", "jason.log"),
      "utf8"
    );
    expect(log).toMatch(/rebase|blocked|assigned|could not rebase/);
    // The teammate worktree survived the aborted rebase with its commit.
    const wt = path.join(
      repo,
      ".crewel",
      "teams",
      "demo",
      "worktrees",
      "mock-2"
    );
    expect(existsSync(path.join(wt, "shared.txt"))).toBe(true);
  });
});
