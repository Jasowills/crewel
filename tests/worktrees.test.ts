import { execFile } from "node:child_process";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTeam } from "../src/core/team/index.js";
import {
  ensureTeammateWorktree,
  listTeamWorktrees,
  provisionTeamWorktrees,
  teammateBranchFor,
} from "../src/core/worktrees/index.js";
import type {
  ProvisionTeamWorktreesResult,
  ProvisionedWorktree,
} from "../src/core/worktrees/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-worktrees-"));
  await runGit("git", ["init", "-q"], { cwd: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function makeTeamInput(name: string) {
  return {
    repoRoot: repo,
    name,
    leadType: "mock",
    teammatesSpec: "mock:2",
  };
}

async function seedCommit(): Promise<string> {
  await writeFile(path.join(repo, "README.md"), "# scratch\n", "utf8");
  await runGit("git", ["add", "."], { cwd: repo });
  await runGit(
    "git",
    [
      "-c",
      "user.name=Crewel Tests",
      "-c",
      "user.email=tests@crewel.local",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "seed",
    ],
    { cwd: repo }
  );
  const { stdout } = await runGit("git", ["rev-parse", "HEAD"], { cwd: repo });
  return stdout.trim();
}

async function gitOut(args: string[]): Promise<string> {
  const { stdout } = await runGit("git", args, { cwd: repo });
  return stdout;
}

async function branchNames(): Promise<string[]> {
  return (await gitOut(["branch", "--format=%(refname:short)"]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function expectProvisioned(
  result: ProvisionTeamWorktreesResult
): Exclude<ProvisionTeamWorktreesResult, { skipped: "no-commits" }> {
  if ("skipped" in result) {
    throw new Error("expected provisioning to run, got a skipped result");
  }
  return result;
}

describe("provisionTeamWorktrees", () => {
  it("creates the integration branch and one branch + worktree per teammate", async () => {
    const head = await seedCommit();
    await createTeam(makeTeamInput("login-flow"));
    const result = expectProvisioned(
      await provisionTeamWorktrees({ repoRoot: repo, team: "login-flow" })
    );
    expect(result.integrationBranch).toBe("crewel/login-flow/integration");
    expect(result.worktrees.map((wt) => wt.participantId)).toEqual([
      "mock-1",
      "mock-2",
    ]);

    // Branch topology: integration at HEAD, teammates cut from its tip.
    const names = await branchNames();
    expect(names).toContain("crewel/login-flow/integration");
    expect(names).toContain("crewel/login-flow/mock-1");
    expect(names).toContain("crewel/login-flow/mock-2");
    expect(await gitOut(["rev-parse", "crewel/login-flow/integration"])).toBe(
      `${head}\n`
    );
    for (const mate of ["mock-1", "mock-2"]) {
      expect(await gitOut(["rev-parse", `crewel/login-flow/${mate}`])).toBe(
        `${head}\n`
      );
    }

    // Worktrees live under .crewel/teams/{team}/worktrees/{id}, checked out
    // on their own branches.
    const realRoot = await realpath(repo);
    const expectedPaths = ["mock-1", "mock-2"].map((mate) =>
      path.join(realRoot, ".crewel", "teams", "login-flow", "worktrees", mate)
    );
    expect(result.worktrees.map((wt) => wt.path)).toEqual(expectedPaths);
    for (const wt of result.worktrees as ProvisionedWorktree[]) {
      const checkedOut = await runGit(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: wt.path }
      );
      expect(checkedOut.stdout.trim()).toBe(wt.branch);
      expect(wt.branch).toBe(teammateBranchFor("login-flow", wt.participantId));
    }
    const listed = await listTeamWorktrees({
      repoRoot: repo,
      team: "login-flow",
    });
    expect(listed.map((wt) => wt.path).sort()).toEqual(
      [...expectedPaths].sort()
    );
    expect(listed.map((wt) => wt.branch).sort()).toEqual([
      "crewel/login-flow/mock-1",
      "crewel/login-flow/mock-2",
    ]);
  });

  it("never touches main during provisioning", async () => {
    const head = await seedCommit();
    await createTeam(makeTeamInput("calm"));
    const initialBranch = (
      await gitOut(["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    await provisionTeamWorktrees({ repoRoot: repo, team: "calm" });
    expect((await gitOut(["rev-parse", "HEAD"])).trim()).toBe(head);
    expect((await gitOut(["rev-parse", "--abbrev-ref", "HEAD"])).trim()).toBe(
      initialBranch
    );
    // The only dirt in the main worktree is crewel's own .gitignore entry.
    const status = (await gitOut(["status", "--porcelain"])).trim();
    const dirtyLines = status.split("\n").filter(Boolean);
    expect(dirtyLines.length).toBeGreaterThan(0);
    expect(dirtyLines.every((line) => line.includes(".gitignore"))).toBe(true);
  });

  it("is idempotent across re-runs", async () => {
    await seedCommit();
    await createTeam(makeTeamInput("steady"));
    await provisionTeamWorktrees({ repoRoot: repo, team: "steady" });
    const firstListing = await gitOut(["worktree", "list", "--porcelain"]);
    const firstBranches = await branchNames();

    const second = expectProvisioned(
      await provisionTeamWorktrees({ repoRoot: repo, team: "steady" })
    );

    expect(second.worktrees).toHaveLength(2);
    expect(await gitOut(["worktree", "list", "--porcelain"])).toBe(
      firstListing
    );
    expect(await branchNames()).toEqual(firstBranches);
    expect(
      await listTeamWorktrees({ repoRoot: repo, team: "steady" })
    ).toHaveLength(2);
  });

  it("preserves teammate worktree contents byte-for-byte across re-provisioning", async () => {
    await seedCommit();
    await createTeam(makeTeamInput("sacred"));
    const result = expectProvisioned(
      await provisionTeamWorktrees({ repoRoot: repo, team: "sacred" })
    );
    const worktree = result.worktrees[0];
    if (!worktree) throw new Error("expected a provisioned worktree");

    // Untracked junk plus a tampered tracked file — neither may be cleaned.
    const junkPath = path.join(worktree.path, "junk.txt");
    const junkContent = "uncommitted agent work — must survive\n";
    await writeFile(junkPath, junkContent, "utf8");
    await writeFile(
      path.join(worktree.path, "README.md"),
      "# tampered in turn\n",
      "utf8"
    );

    await provisionTeamWorktrees({ repoRoot: repo, team: "sacred" });

    const survived = await readFile(junkPath, "utf8");
    expect(survived).toBe(junkContent);
    expect(await readFile(path.join(worktree.path, "README.md"), "utf8")).toBe(
      "# tampered in turn\n"
    );
  });

  it("skips gracefully on a zero-commit repo instead of throwing", async () => {
    await createTeam(makeTeamInput("unborn"));
    const result = await provisionTeamWorktrees({
      repoRoot: repo,
      team: "unborn",
    });
    expect(result).toEqual({ skipped: "no-commits" });
    expect(await branchNames()).toEqual([]);
    expect(await listTeamWorktrees({ repoRoot: repo, team: "unborn" })).toEqual(
      []
    );
    const ensured = await ensureTeammateWorktree({
      repoRoot: repo,
      team: "unborn",
      participantId: "mock-1",
    });
    expect(ensured).toEqual({ skipped: "no-commits" });
  });

  it("rejects an unknown team", async () => {
    await seedCommit();
    await createTeam(makeTeamInput("real"));
    await expect(
      provisionTeamWorktrees({ repoRoot: repo, team: "ghost" })
    ).rejects.toThrow(/no team named "ghost"/);
  });
});

describe("ensureTeammateWorktree", () => {
  it("provisions a single missing worktree and is idempotent", async () => {
    await seedCommit();
    await createTeam(makeTeamInput("lazy"));
    const realRoot = await realpath(repo);
    const mock2Path = path.join(
      realRoot,
      ".crewel",
      "teams",
      "lazy",
      "worktrees",
      "mock-2"
    );

    const created = await ensureTeammateWorktree({
      repoRoot: repo,
      team: "lazy",
      participantId: "mock-2",
    });
    expect(created).toEqual({
      status: "created",
      path: mock2Path,
      branch: "crewel/lazy/mock-2",
    });
    // The integration branch exists as a prerequisite of the teammate branch.
    expect(await branchNames()).toContain("crewel/lazy/integration");

    const again = await ensureTeammateWorktree({
      repoRoot: repo,
      team: "lazy",
      participantId: "mock-2",
    });
    expect(again).toEqual({
      status: "existing",
      path: mock2Path,
      branch: "crewel/lazy/mock-2",
    });

    const listed = await listTeamWorktrees({ repoRoot: repo, team: "lazy" });
    expect(listed.map((wt) => wt.path)).toEqual([mock2Path]);
  });

  it("rejects an unknown teammate with the roster in the message", async () => {
    await seedCommit();
    await createTeam(makeTeamInput("rostered"));
    await expect(
      ensureTeammateWorktree({
        repoRoot: repo,
        team: "rostered",
        participantId: "mock-9",
      })
    ).rejects.toThrow(/unknown teammate "mock-9"/);
  });
});
