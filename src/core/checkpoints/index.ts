import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CrewelError } from "../errors.js";
import { sendMessage } from "../mail/index.js";
import { notifyJason } from "../notifications/index.js";
import { loadTickets, teamDir, updateTicket } from "../team/store.js";
import { loadAllTeams } from "../team/store.js";
import type { Ticket } from "../tickets/model.js";
import {
  cleanGitEnv,
  integrationBranchFor,
  teammateBranchFor,
  worktreePathFor,
} from "../worktrees/index.js";

const runGit = promisify(execFile);

const LEAD_MAILBOX = "lead";

function safeNotify(input: Parameters<typeof notifyJason>[0]): void {
  notifyJason(input).catch(() => {});
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

/**
 * A dedicated admin checkout of the integration branch, hidden under the
 * team's coordination dir. Merges happen here so the user's own working
 * copy on main is never disturbed.
 */
export function integrationCheckoutPath(
  repoRoot: string,
  team: string
): string {
  return path.join(teamDir(repoRoot, team), "integration-checkout");
}

export async function ensureIntegrationCheckout(input: {
  repoRoot: string;
  team: string;
}): Promise<string> {
  const repoRoot = await resolveRepoRoot(input.repoRoot);
  const target = integrationCheckoutPath(repoRoot, input.team);
  const integration = integrationBranchFor(input.team);
  // The integration branch may not exist yet (no teammate has ever run);
  // bootstrap it from HEAD like the worktrees module does.
  const exists = await git(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${integration}`,
  ]).then(
    () => true,
    () => false
  );
  if (!exists) {
    if (!(await hasCommits(repoRoot))) {
      throw new CrewelError(
        "cannot create the integration checkpoint — the repo has no commits yet"
      );
    }
    await git(repoRoot, ["branch", integration, "HEAD"]);
  }
  const listed = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (listed.includes(`worktree ${target}`)) return target;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await git(repoRoot, ["worktree", "add", target, integration]);
  } catch {
    if (!(await hasCommits(repoRoot))) {
      throw new CrewelError(
        "cannot create the integration checkpoint — the repo has no commits yet"
      );
    }
    throw new CrewelError(
      `could not check out ${integration} for merging — is it checked out somewhere else?`
    );
  }
  return target;
}

async function hasCommits(repoRoot: string): Promise<boolean> {
  try {
    await runGit("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      env: cleanGitEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

// git listings report fully resolved paths; normalize up front so path
// comparisons hold under symlinked roots (macOS /tmp etc).
async function resolveRepoRoot(repoRoot: string): Promise<string> {
  return realpath(repoRoot);
}

export interface MergeResult {
  merged: boolean;
  detail: string;
}

export async function mergeApprovedTicket(input: {
  repoRoot: string;
  team: string;
  ticketId: string;
}): Promise<MergeResult> {
  const tickets = await loadTickets(input.repoRoot, input.team);
  const ticket = tickets.find((t) => t.id === input.ticketId);
  if (!ticket) {
    throw new CrewelError(`ticket "${input.ticketId}" not found`);
  }
  if (ticket.status !== "done") {
    throw new CrewelError(
      `ticket "${input.ticketId}" must be done before merging (is ${ticket.status})`
    );
  }
  if (!ticket.approved) {
    throw new CrewelError(
      `ticket "${input.ticketId}" has no recorded review pass — approve before merging`
    );
  }
  if (!ticket.assignee) {
    throw new CrewelError(
      `ticket "${input.ticketId}" has no assignee — cannot locate its branch`
    );
  }
  // checkCommand gate: run configured command in the ticket worktree
  const teamEntry = (await loadAllTeams(input.repoRoot)).find(
    (e) => e.name === input.team
  );
  const checkCommand = teamEntry?.config.checkCommand;
  if (checkCommand) {
    const wt = worktreePathFor(input.repoRoot, input.team, ticket.assignee);
    try {
      const runSh = promisify(execFile);
      await runSh("sh", ["-c", checkCommand], {
        cwd: wt,
        env: cleanGitEnv(),
        timeout: 60_000,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await updateTicket(input.repoRoot, input.team, ticket.id, {
        status: "in-progress",
        approved: false,
        lastError: `checkCommand failed: ${detail.slice(0, 300)}`,
      });
      safeNotify({
        repoRoot: input.repoRoot,
        team: input.team,
        kind: "system",
        body: `"${ticket.id}" checkCommand failed — bounced to in-progress.`,
      });
      return { merged: false, detail: "check failed" };
    }
  }
  const checkout = await ensureIntegrationCheckout(input);
  // Merge into the integration branch inside the admin checkout; a dirty
  // checkpoint would poison later merges, so refuse instead of guessing.
  const status = await git(checkout, ["status", "--porcelain"]);
  if (status.trim() !== "") {
    throw new CrewelError(
      "integration checkpoint is dirty — resolve it before merging"
    );
  }
  const branch = teammateBranchFor(input.team, ticket.assignee);
  try {
    const out = await git(checkout, [
      "merge",
      "--no-ff",
      branch,
      "-m",
      `Merge ${branch} (${ticket.id}: ${ticket.title})`,
    ]);
    safeNotify({
      repoRoot: input.repoRoot,
      team: input.team,
      kind: "system",
      body: `"${ticket.id}" merged into ${integrationBranchFor(input.team)}.`,
    });
    // Cleanup ticket-specific branch if it exists (teammate branches stay)
    const ticketBranch = `crewel/${input.team}/${ticket.id}`;
    if (ticketBranch !== branch) {
      await git(input.repoRoot, ["branch", "-d", ticketBranch]).catch(() => {});
    }
    return { merged: true, detail: out.trim() };
  } catch {
    // Conflict: abort cleanly, block the ticket, escalate — never force.
    await git(checkout, ["merge", "--abort"]).catch(() => {});
    await updateTicket(input.repoRoot, input.team, input.ticketId, {
      status: "blocked",
      lastError: "merge conflict with integration branch",
    });
    safeNotify({
      repoRoot: input.repoRoot,
      team: input.team,
      kind: "blocked",
      body: `"${ticket.id}" hit a merge conflict integrating to ${integrationBranchFor(input.team)} — Jason attention required.`,
    });
    return { merged: false, detail: "merge conflict" };
  }
}

export interface RebaseOutcome {
  rebased: boolean;
  blockedTicketIds: string[];
}

/**
 * Called at turn start for work flagged rebaseRequired: bring the
 * teammate's branch onto the current integration tip. A conflict the
 * engine can't cleanly resolve blocks the ticket and escalates — the
 * rebase flag stays set for retry after human unblocking.
 */
export async function rebaseDependentWorktrees(input: {
  repoRoot: string;
  team: string;
  participantId: string;
  tickets: Ticket[];
}): Promise<RebaseOutcome> {
  const needing = input.tickets.filter((t) => t.rebaseRequired);
  if (needing.length === 0) return { rebased: false, blockedTicketIds: [] };
  const wt = worktreePathFor(input.repoRoot, input.team, input.participantId);
  const blocked: string[] = [];
  let anyRebased = false;
  for (const ticket of needing) {
    try {
      await git(wt, ["rebase", integrationBranchFor(input.team)]);
      await updateTicket(input.repoRoot, input.team, ticket.id, {
        rebaseRequired: false,
      });
      anyRebased = true;
    } catch {
      await git(wt, ["rebase", "--abort"]).catch(() => {});
      await updateTicket(input.repoRoot, input.team, ticket.id, {
        status: "blocked",
        lastError: "could not rebase onto updated integration tip",
      });
      blocked.push(ticket.id);
      safeNotify({
        repoRoot: input.repoRoot,
        team: input.team,
        kind: "blocked",
        body: `"${ticket.id}" could not rebase onto ${integrationBranchFor(input.team)} — Jason attention required.`,
      });
    }
  }
  return { rebased: anyRebased, blockedTicketIds: blocked };
}

/** Fan-out when a dependency lands: mark dependents and wake their owners. */
export async function announceDependencyResolved(input: {
  repoRoot: string;
  team: string;
  resolvedTicketId: string;
}): Promise<void> {
  const all = await loadTickets(input.repoRoot, input.team);
  const dependents = all.filter((t) =>
    t.dependsOn.includes(input.resolvedTicketId)
  );
  for (const dependent of dependents) {
    await updateTicket(input.repoRoot, input.team, dependent.id, {
      rebaseRequired: true,
    });
    if (!dependent.assignee) continue;
    await sendMessage({
      repoRoot: input.repoRoot,
      team: input.team,
      from: LEAD_MAILBOX,
      to: dependent.assignee,
      kind: "system",
      body: `Dependency "${input.resolvedTicketId}" landed on the integration branch — your next turn rebases "${dependent.id}" onto it.`,
    });
    safeNotify({
      repoRoot: input.repoRoot,
      team: input.team,
      kind: "system",
      body: `"${input.resolvedTicketId}" resolved — "${dependent.id}" queued for rebase.`,
    });
  }
}
