import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CrewelError } from "../errors.js";
import type { TeamConfig } from "../team/config.js";
import { loadAllTeams, teamDir } from "../team/store.js";

const runGit = promisify(execFile);

export interface ProvisionedWorktree {
  participantId: string;
  path: string;
  branch: string;
}

export type ProvisionTeamWorktreesResult =
  | { skipped: "no-commits" }
  | { integrationBranch: string; worktrees: ProvisionedWorktree[] };

export type EnsureTeammateWorktreeResult =
  | { skipped: "no-commits" }
  | { status: "created" | "existing"; path: string; branch: string };

export interface ListedWorktree {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
}

export function integrationBranchFor(team: string): string {
  // Not `crewel/{team}` as first written in DECISIONS.md Q15: git cannot hold
  // refs/heads/crewel/{team} alongside crewel/{team}/{id} (file/dir ref
  // conflict), so the integration tip lives inside the team namespace.
  return `crewel/${team}/integration`;
}

export function teammateBranchFor(team: string, participantId: string): string {
  return `crewel/${team}/${participantId}`;
}

export function worktreePathFor(
  repoRoot: string,
  team: string,
  participantId: string
): string {
  return path.join(teamDir(repoRoot, team), "worktrees", participantId);
}

function worktreesRoot(resolvedRepoRoot: string, team: string): string {
  return path.join(teamDir(resolvedRepoRoot, team), "worktrees");
}

// Hook runners (husky/lint-staged) export GIT_INDEX_FILE & friends into
// every child process; inherited by spawned git they poison index writes
// ("index file open failed: Not a directory"). Strip them — `-C` plus the
// sanitized env fully determines each invocation's repo.
const POISONED_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

export function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of POISONED_GIT_ENV) delete env[key];
  return env;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runGit("git", ["-C", repoRoot, ...args], {
      env: cleanGitEnv(),
    });
    return stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CrewelError(`git ${args[0] ?? ""} failed — ${detail.trim()}`);
  }
}

async function probeGit(
  repoRoot: string,
  args: string[]
): Promise<string | null> {
  try {
    const { stdout } = await runGit("git", ["-C", repoRoot, ...args], {
      env: cleanGitEnv(),
    });
    return stdout;
  } catch {
    return null;
  }
}

async function assertInsideGitRepo(repoRoot: string): Promise<void> {
  const stdout = await probeGit(repoRoot, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (stdout?.trim() !== "true") {
    throw new CrewelError(
      `"${repoRoot}" is not inside a git repository — crewel requires git (worktree-per-teammate is mandatory in v1)`
    );
  }
}

async function loadTeamConfig(
  repoRoot: string,
  team: string
): Promise<TeamConfig> {
  const found = (await loadAllTeams(repoRoot)).find(
    (entry) => entry.name === team
  );
  if (!found) throw new CrewelError(`no team named "${team}"`);
  return found.config;
}

async function resolveRepoRoot(repoRoot: string): Promise<string> {
  // git reports fully resolved absolute paths in its listings; resolve up
  // front so path comparisons hold under symlinked roots (macOS /tmp etc).
  return realpath(repoRoot);
}

async function resolveHeadCommit(repoRoot: string): Promise<string | null> {
  // A zero-commit repo cannot host branches; callers degrade gracefully.
  const sha = (await probeGit(repoRoot, ["rev-parse", "HEAD"]))?.trim();
  return sha ? sha : null;
}

async function branchExists(
  repoRoot: string,
  branch: string
): Promise<boolean> {
  const stdout = await probeGit(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return stdout !== null && stdout.trim().length > 0;
}

function parseWorktreeList(output: string): ListedWorktree[] {
  const list: ListedWorktree[] = [];
  let current: ListedWorktree | undefined;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("worktree ")) {
      if (current) list.push(current);
      current = { path: line.slice("worktree ".length), detached: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  if (current) list.push(current);
  return list;
}

async function ensureTeammateWorktreeIn(
  repoRoot: string,
  team: string,
  config: TeamConfig,
  participantId: string
): Promise<EnsureTeammateWorktreeResult> {
  if (!config.teammates.some((mate) => mate.id === participantId)) {
    throw new CrewelError(
      `unknown teammate "${participantId}" — roster: ${config.teammates
        .map((mate) => mate.id)
        .join(", ")}`
    );
  }
  const targetPath = worktreePathFor(repoRoot, team, participantId);
  const registered = parseWorktreeList(
    await git(repoRoot, ["worktree", "list", "--porcelain"])
  ).find((worktree) => worktree.path === targetPath);
  if (registered) {
    // Inspection wins over tidiness: an existing worktree is never touched.
    return {
      status: "existing",
      path: targetPath,
      branch: registered.branch ?? teammateBranchFor(team, participantId),
    };
  }
  const head = await resolveHeadCommit(repoRoot);
  if (!head) return { skipped: "no-commits" };
  const integration = integrationBranchFor(team);
  if (!(await branchExists(repoRoot, integration))) {
    await git(repoRoot, ["branch", integration, head]);
  }
  // Ticket branches are cut from the current integration tip.
  if (!(await branchExists(repoRoot, teammateBranchFor(team, participantId)))) {
    await git(repoRoot, [
      "branch",
      teammateBranchFor(team, participantId),
      integration,
    ]);
  }
  await git(repoRoot, [
    "worktree",
    "add",
    targetPath,
    teammateBranchFor(team, participantId),
  ]);
  return {
    status: "created",
    path: targetPath,
    branch: teammateBranchFor(team, participantId),
  };
}

export async function provisionTeamWorktrees(input: {
  repoRoot: string;
  team: string;
}): Promise<ProvisionTeamWorktreesResult> {
  const config = await loadTeamConfig(input.repoRoot, input.team);
  await assertInsideGitRepo(input.repoRoot);
  const repoRoot = await resolveRepoRoot(input.repoRoot);
  const head = await resolveHeadCommit(repoRoot);
  if (!head) return { skipped: "no-commits" };
  const integration = integrationBranchFor(input.team);
  if (!(await branchExists(repoRoot, integration))) {
    await git(repoRoot, ["branch", integration, head]);
  }
  const worktrees: ProvisionedWorktree[] = [];
  for (const mate of config.teammates) {
    const ensured = await ensureTeammateWorktreeIn(
      repoRoot,
      input.team,
      config,
      mate.id
    );
    if ("skipped" in ensured) continue;
    worktrees.push({
      participantId: mate.id,
      path: ensured.path,
      branch: ensured.branch,
    });
  }
  return { integrationBranch: integration, worktrees };
}

export async function ensureTeammateWorktree(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<EnsureTeammateWorktreeResult> {
  const config = await loadTeamConfig(input.repoRoot, input.team);
  await assertInsideGitRepo(input.repoRoot);
  const repoRoot = await resolveRepoRoot(input.repoRoot);
  return ensureTeammateWorktreeIn(
    repoRoot,
    input.team,
    config,
    input.participantId
  );
}

export async function listTeamWorktrees(input: {
  repoRoot: string;
  team: string;
}): Promise<ListedWorktree[]> {
  const repoRoot = await resolveRepoRoot(input.repoRoot);
  const root = worktreesRoot(repoRoot, input.team);
  const output = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const prefix = root + path.sep;
  return parseWorktreeList(output).filter(
    (worktree) => worktree.path === root || worktree.path.startsWith(prefix)
  );
}
