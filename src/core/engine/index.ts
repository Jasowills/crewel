import { execFile } from "node:child_process";
import { getAdapter } from "../adapters/index.js";
import type { TurnReport, TurnResult } from "../adapters/types.js";
import { validateTurnReport } from "../adapters/types.js";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CrewelError } from "../errors.js";
import {
  announceDependencyResolved,
  rebaseDependentWorktrees,
} from "../checkpoints/index.js";
import { drainInbox, sendMessage } from "../mail/index.js";
import { notifyJason } from "../notifications/index.js";
import {
  heartbeatAge,
  isPaused,
  pauseParticipant,
  resumeParticipant,
} from "../participants/index.js";
import {
  loadAllTeams,
  loadTickets,
  participantDir,
  updateTicket,
} from "../team/store.js";
import type { Ticket } from "../tickets/model.js";
import {
  cleanGitEnv,
  ensureTeammateWorktree,
  worktreePathFor,
} from "../worktrees/index.js";

const runGit = promisify(execFile);

export const LEAD_MAILBOX = "lead";

function safeNotify(input: Parameters<typeof notifyJason>[0]): void {
  // Notifications must never break engine operations.
  notifyJason(input).catch(() => {});
}

export const SENIOR_ENGINEER_INSTRUCTIONS = [
  "You operate as a senior/principal engineer.",
  "Push back on unclear tickets via needs-clarification instead of guessing.",
  "Flag scope creep. Write the tests and docs a principal engineer would",
  "consider table stakes. Every turn ends with a TurnReport — never guess,",
  "never silently fail.",
].join(" ");

export interface TurnRunResult {
  ran: boolean;
  reason?: "nothing-due" | "paused" | "team-stopped";
  outcome?: TurnResult["outcome"];
  reportStatus?: TurnReport["status"];
  ticketIds: string[];
}

// Same-process registry of in-flight turns for interrupt support. The pid
// file below covers cross-process interruption best-effort.
const inflight = new Map<string, () => void>();

function inflightKey(team: string, participantId: string): string {
  return `${team}/${participantId}`;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function stoppedMarker(repoRoot: string, team: string): string {
  return path.join(".crewel", "teams", team, "STOPPED");
}

async function isTeamStopped(repoRoot: string, team: string): Promise<boolean> {
  const info = await stat(
    path.join(repoRoot, stoppedMarker(repoRoot, team))
  ).catch(() => null);
  return info !== null;
}

export async function stopTeam(input: {
  repoRoot: string;
  team: string;
  now?: boolean;
}): Promise<{ mode: "drain" | "immediate"; interrupted: string[] }> {
  const marker = path.join(
    input.repoRoot,
    stoppedMarker(input.repoRoot, input.team)
  );
  await mkdir(path.dirname(marker), { recursive: true });
  await writeFile(marker, `${new Date().toISOString()}\n`, "utf8");
  if (!input.now) return { mode: "drain", interrupted: [] };
  // Immediate mode: abort every in-flight turn we can reach.
  const interrupted: string[] = [];
  for (const [key, abort] of [...inflight]) {
    if (!key.startsWith(`${input.team}/`)) continue;
    abort();
    interrupted.push(key.split("/")[1] ?? key);
  }
  return { mode: "immediate", interrupted };
}

export async function startTeam(input: {
  repoRoot: string;
  team: string;
}): Promise<void> {
  await rm(
    path.join(input.repoRoot, stoppedMarker(input.repoRoot, input.team)),
    {
      force: true,
    }
  );
}

export async function interruptTeammate(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<{ aborted: boolean }> {
  const abort = inflight.get(inflightKey(input.team, input.participantId));
  if (abort) {
    abort();
    return { aborted: true };
  }
  // Best-effort cross-process interrupt via the recorded pid.
  try {
    const pidRaw = await readFile(
      path.join(
        participantDir(input.repoRoot, input.team, input.participantId),
        "turn.pid"
      ),
      "utf8"
    );
    const pid = Number(pidRaw.trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      process.kill(pid, "SIGTERM");
      return { aborted: true };
    }
  } catch {
    // No live turn — nothing to interrupt.
  }
  return { aborted: false };
}

export async function pauseTeammate(input: {
  repoRoot: string;
  team: string;
  participantId: string;
  reason: string;
}): Promise<void> {
  await pauseParticipant(input);
  safeNotify({
    repoRoot: input.repoRoot,
    team: input.team,
    kind: "rate-limited",
    body: `${input.participantId} paused manually — ${input.reason}.`,
  });
}

export async function resumeTeammate(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<void> {
  await resumeParticipant(input);
  safeNotify({
    repoRoot: input.repoRoot,
    team: input.team,
    kind: "system",
    body: `${input.participantId} resumed.`,
  });
}

async function worktreeIsClean(
  repoRoot: string,
  team: string,
  participantId: string
): Promise<boolean> {
  const wt = worktreePathFor(repoRoot, team, participantId);
  try {
    const { stdout } = await runGit(
      "git",
      ["-C", wt, "status", "--porcelain"],
      { env: cleanGitEnv() }
    );
    return stdout.trim() === "";
  } catch {
    // No provisioned worktree yet counts as clean (nothing to lose).
    return true;
  }
}

const FREEZE_THRESHOLD = 3;

async function applyFailurePolicy(input: {
  repoRoot: string;
  team: string;
  ticket: Ticket;
  failedParticipantId: string;
  roster: Array<{ id: string; type: string }>;
}): Promise<"frozen" | "reassigned" | "escalated"> {
  const { repoRoot, team, ticket } = input;
  const attempts = (ticket.attempts ?? 0) + 1;

  if (attempts >= FREEZE_THRESHOLD) {
    await updateTicket(repoRoot, team, ticket.id, {
      attempts,
      status: "assigned",
      frozen: true,
      lastError: `frozen after ${attempts} failed attempts`,
    });
    safeNotify({
      repoRoot,
      team,
      kind: "system",
      body: `"${ticket.id}" FROZEN after ${attempts} failures — Jason decision required.`,
    });
    return "frozen";
  }

  // Hybrid rule: auto-reassign only to an idle teammate when the failed
  // worktree shows no uncommitted mess; otherwise escalate.
  const clean = await worktreeIsClean(
    repoRoot,
    team,
    input.failedParticipantId
  );
  const candidates: string[] = [];
  if (clean) {
    const all = await loadTickets(repoRoot, team);
    for (const mate of input.roster) {
      if (mate.id === input.failedParticipantId) continue;
      if (await isPaused(repoRoot, team, mate.id)) continue;
      const busy = all.some(
        (t) =>
          t.assignee === mate.id &&
          (t.status === "assigned" || t.status === "in-progress") &&
          !t.clarification
      );
      if (!busy) candidates.push(mate.id);
    }
  }
  const candidate = candidates[0];
  if (!candidate) {
    await updateTicket(repoRoot, team, ticket.id, { attempts });
    safeNotify({
      repoRoot,
      team,
      kind: "system",
      body: `"${ticket.id}" failed on ${input.failedParticipantId}${
        clean ? "" : " (dirty worktree left for inspection)"
      } — no idle teammate available, Jason attention required.`,
    });
    return "escalated";
  }
  await updateTicket(repoRoot, team, ticket.id, {
    attempts,
    status: "assigned",
    assignee: candidate,
  });
  await sendMessage({
    repoRoot,
    team,
    from: LEAD_MAILBOX,
    to: candidate,
    kind: "assignment",
    body: `Ticket "${ticket.id} — ${ticket.title}" reassigned to you after failures on ${input.failedParticipantId}.`,
  });
  safeNotify({
    repoRoot,
    team,
    kind: "assignment",
    body: `"${ticket.id}" auto-reassigned ${input.failedParticipantId} → ${candidate} (attempt ${attempts}).`,
  });
  return "reassigned";
}

export async function unfreezeTicket(input: {
  repoRoot: string;
  team: string;
  ticketId: string;
}): Promise<void> {
  await updateTicket(input.repoRoot, input.team, input.ticketId, {
    frozen: false,
    lastError: undefined,
  });
}

/** Record the lead's review verdict (Q8) — required before integration. */
export async function approveTicket(input: {
  repoRoot: string;
  team: string;
  ticketId: string;
}): Promise<void> {
  const tickets = await loadTickets(input.repoRoot, input.team);
  const ticket = tickets.find((t) => t.id === input.ticketId);
  if (!ticket) {
    throw new CrewelError(`ticket "${input.ticketId}" not found`);
  }
  if (ticket.status !== "done") {
    throw new CrewelError(
      `only done tickets can be approved ("${input.ticketId}" is ${ticket.status})`
    );
  }
  await updateTicket(input.repoRoot, input.team, input.ticketId, {
    approved: true,
  });
  safeNotify({
    repoRoot: input.repoRoot,
    team: input.team,
    kind: "system",
    body: `"${input.ticketId}" approved by review — eligible for integration.`,
  });
}

export async function assignTicket(input: {
  repoRoot: string;
  team: string;
  ticketId: string;
  assignee: string;
  teammateIds?: string[];
}): Promise<void> {
  if (input.teammateIds && !input.teammateIds.includes(input.assignee)) {
    throw new CrewelError(
      `unknown teammate "${input.assignee}" — roster: ${input.teammateIds.join(", ")}`
    );
  }
  const existing = (await loadTickets(input.repoRoot, input.team)).find(
    (t) => t.id === input.ticketId
  );
  if (existing?.frozen) {
    throw new CrewelError(
      `ticket "${input.ticketId}" is frozen — unfreeze before assigning`
    );
  }
  const ticket = await updateTicket(
    input.repoRoot,
    input.team,
    input.ticketId,
    { status: "assigned", assignee: input.assignee }
  );
  await sendMessage({
    repoRoot: input.repoRoot,
    team: input.team,
    from: LEAD_MAILBOX,
    to: input.assignee,
    kind: "assignment",
    body: `Ticket "${ticket.id} — ${ticket.title}" assigned to you.`,
  });
  safeNotify({
    repoRoot: input.repoRoot,
    team: input.team,
    kind: "assignment",
    body: `"${ticket.id} — ${ticket.title}" assigned to ${input.assignee}.`,
  });
}

export async function answerClarification(input: {
  repoRoot: string;
  team: string;
  ticketId: string;
  answer: string;
}): Promise<void> {
  const tickets = await loadTickets(input.repoRoot, input.team);
  const ticket = tickets.find((t) => t.id === input.ticketId);
  if (!ticket) {
    throw new CrewelError(`ticket "${input.ticketId}" not found`);
  }
  if (!ticket.clarification) {
    throw new CrewelError(
      `ticket "${input.ticketId}" has no pending clarification`
    );
  }
  await updateTicket(input.repoRoot, input.team, input.ticketId, {
    clarification: null,
    status: "assigned",
  });
  if (!ticket.assignee) return;
  await sendMessage({
    repoRoot: input.repoRoot,
    team: input.team,
    from: LEAD_MAILBOX,
    to: ticket.assignee,
    kind: "clarification-answer",
    body: `Clarification on "${input.ticketId}": ${input.answer}`,
  });
  safeNotify({
    repoRoot: input.repoRoot,
    team: input.team,
    kind: "clarification",
    body: `Lead answered clarification on "${input.ticketId}".`,
  });
}

async function persistNotes(
  repoRoot: string,
  team: string,
  participantId: string,
  notes: string
): Promise<void> {
  const dir = participantDir(repoRoot, team, participantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "notes.md"), notes, "utf8");
}

function applyReportToTicket(report: TurnReport, now: Date): Partial<Ticket> {
  switch (report.status) {
    case "done":
      return { status: "done", clarification: null };
    case "blocked":
      return { status: "blocked" };
    case "needs-clarification":
      return {
        status: "assigned",
        clarification: {
          question: report.message?.body ?? report.summary,
          askedAt: now.toISOString(),
        },
      };
    default:
      return { status: "in-progress" };
  }
}

export interface StallReport {
  participantId: string;
  ageMs: number;
  ticketsReset: string[];
}

export async function checkStalls(input: {
  repoRoot: string;
  team: string;
  stalledMs: number;
}): Promise<StallReport[]> {
  const teamEntry = (await loadAllTeams(input.repoRoot)).find(
    (entry) => entry.name === input.team
  );
  if (!teamEntry) throw new CrewelError(`no team named "${input.team}"`);
  const reports: StallReport[] = [];
  for (const mate of teamEntry.config.teammates) {
    const age = await heartbeatAge(input.repoRoot, input.team, mate.id);
    if (age === null || age < input.stalledMs) continue;
    const stale = await loadTickets(input.repoRoot, input.team);
    const reset: string[] = [];
    for (const ticket of stale.filter(
      (t) =>
        t.assignee === mate.id && t.status === "in-progress" && !t.clarification
    )) {
      await updateTicket(input.repoRoot, input.team, ticket.id, {
        status: "assigned",
        attempts: (ticket.attempts ?? 0) + 1,
        lastError: `stalled ${Math.round(age / 1000)}s without heartbeat`,
      });
      reset.push(ticket.id);
    }
    reports.push({ participantId: mate.id, ageMs: age, ticketsReset: reset });
  }
  if (reports.length > 0) {
    safeNotify({
      repoRoot: input.repoRoot,
      team: input.team,
      kind: "system",
      body: `Stall watchdog flagged: ${reports
        .map(
          (r) =>
            `${r.participantId} (${Math.round(r.ageMs / 1000)}s${r.ticketsReset.length ? `, reset ${r.ticketsReset.join(", ")}` : ""})`
        )
        .join("; ")}.`,
    });
  }
  return reports;
}

export async function runTeammateTurn(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<TurnRunResult> {
  const { repoRoot, team, participantId } = input;

  if (await isTeamStopped(repoRoot, team)) {
    return { ran: false, reason: "team-stopped", ticketIds: [] };
  }

  // Validate the participant before anything else: a typo'd id must fail
  // loudly, not silently no-op.
  const teamEntry = (await loadAllTeams(repoRoot)).find(
    (entry) => entry.name === team
  );
  if (!teamEntry) throw new CrewelError(`no team named "${team}"`);
  const participant = teamEntry.config.teammates.find(
    (mate) => mate.id === participantId
  );
  if (!participant) {
    throw new CrewelError(
      `unknown teammate "${participantId}" — roster: ${teamEntry.config.teammates
        .map((mate) => mate.id)
        .join(", ")}`
    );
  }
  const adapter = getAdapter(participant.type);
  if (!adapter) {
    throw new CrewelError(`unknown adapter type "${participant.type}"`);
  }
  if (await isPaused(repoRoot, team, participantId)) {
    return { ran: false, reason: "paused", ticketIds: [] };
  }

  // Deliver everything waiting at this boundary first: messages are
  // drained (and archived) exactly once per turn.
  const messages = await drainInbox(repoRoot, team, participantId);

  // Work due: fresh assignments plus resumable in-progress work. A ticket
  // parked in-progress still belongs to its teammate across turns. Frozen
  // tickets are immune until released.
  let work = (await loadTickets(repoRoot, team)).filter(
    (ticket) =>
      ticket.assignee === participantId &&
      !ticket.clarification &&
      !ticket.frozen &&
      (ticket.status === "assigned" || ticket.status === "in-progress")
  );
  if (messages.length === 0 && work.length === 0) {
    return { ran: false, reason: "nothing-due", ticketIds: [] };
  }

  // Dependencies landed since our last turn? Rebase onto the new
  // integration tip first; unresolvable conflicts block + escalate.
  const rebase = await rebaseDependentWorktrees({
    repoRoot,
    team,
    participantId,
    tickets: work,
  });
  if (rebase.blockedTicketIds.length > 0) {
    const blocked = new Set(rebase.blockedTicketIds);
    work = work.filter((ticket) => !blocked.has(ticket.id));
    if (work.length === 0 && messages.length === 0) {
      return { ran: false, reason: "nothing-due", ticketIds: [] };
    }
  }

  const notes = await readOptional(
    path.join(participantDir(repoRoot, team, participantId), "notes.md")
  );

  // Real isolated worktree for the turn (lazy-provisioned; zero-commit
  // repos degrade to running in-place).
  const ensured = await ensureTeammateWorktree({
    repoRoot,
    team,
    participantId,
  });
  const worktreePath = "skipped" in ensured ? repoRoot : ensured.path;

  // Work has begun: reflect fresh assignments on the board before
  // anything can crash.
  for (const ticket of work) {
    if (ticket.status === "assigned") {
      await updateTicket(repoRoot, team, ticket.id, {
        status: "in-progress",
      });
    }
  }

  const pDir = participantDir(repoRoot, team, participantId);
  const heartbeatPath = path.join(pDir, "heartbeat");
  await mkdir(pDir, { recursive: true });
  const touchHeartbeat = async (): Promise<void> => {
    await writeFile(heartbeatPath, new Date().toISOString(), "utf8");
  };
  await touchHeartbeat();
  const pidPath = path.join(pDir, "turn.pid");
  await writeFile(pidPath, `${process.pid}\n`, "utf8");

  const controller = new AbortController();
  inflight.set(inflightKey(team, participantId), () => controller.abort());

  let result: TurnResult;
  let aborted = false;
  try {
    result = await adapter.runTurn({
      bundle: {
        team,
        participantId,
        role: "teammate",
        worktreePath,
        tickets: work,
        messages,
        progressNotes: notes,
        instructions: SENIOR_ENGINEER_INSTRUCTIONS,
      },
      heartbeatPath,
      touchHeartbeat,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      aborted = true;
      result = { outcome: "aborted" };
    } else {
      result = {
        outcome: "failed-retryable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    inflight.delete(inflightKey(team, participantId));
    await rm(heartbeatPath, { force: true });
    await rm(pidPath, { force: true });
  }

  const ticketIds = work.map((ticket) => ticket.id);

  // Deliberate operator interrupt: back to assigned, NO attempt penalty,
  // worktree untouched (inspection wins over tidiness).
  if (aborted || result.outcome === "aborted") {
    for (const ticket of work) {
      await updateTicket(repoRoot, team, ticket.id, {
        status: "assigned",
        lastError: "turn aborted by operator",
      });
    }
    safeNotify({
      repoRoot,
      team,
      kind: "system",
      body: `${participantId}'s turn was interrupted; ${ticketIds.length} ticket(s) returned to assigned. Worktree preserved.`,
    });
    return { ran: true, outcome: "aborted", ticketIds };
  }

  if (result.outcome === "completed") {
    const validation = validateTurnReport(result.report ?? result.raw);
    if (!validation.ok) {
      // An invalid or missing report is NEVER silently done.
      for (const ticket of work) {
        await updateTicket(repoRoot, team, ticket.id, {
          status: "assigned",
          attempts: (ticket.attempts ?? 0) + 1,
          lastError: `invalid TurnReport: ${validation.errors.join("; ")}`,
        });
      }
      safeNotify({
        repoRoot,
        team,
        kind: "system",
        body: `${participantId} produced an invalid TurnReport on ${ticketIds.join(", ") || "its turn"}.`,
      });
      return { ran: true, outcome: "failed-retryable", ticketIds };
    }
    for (const ticket of work) {
      await updateTicket(
        repoRoot,
        team,
        ticket.id,
        applyReportToTicket(validation.report, new Date())
      );
      if (validation.report.status === "blocked") {
        safeNotify({
          repoRoot,
          team,
          kind: "blocked",
          body: `"${ticket.id}" blocked — ${validation.report.summary}`,
        });
        await sendMessage({
          repoRoot,
          team,
          from: participantId,
          to: LEAD_MAILBOX,
          kind: "system",
          body: `Ticket "${ticket.id}" blocked: ${validation.report.summary}`,
        });
      }
      if (validation.report.status === "needs-clarification") {
        safeNotify({
          repoRoot,
          team,
          kind: "clarification",
          body: `"${ticket.id}" needs clarification from the lead.`,
        });
        await sendMessage({
          repoRoot,
          team,
          from: participantId,
          to: LEAD_MAILBOX,
          kind: "clarification",
          body: `Ticket "${ticket.id}" needs clarification: ${
            validation.report.message?.body ?? validation.report.summary
          }`,
        });
      }
      if (validation.report.status === "done") {
        safeNotify({
          repoRoot,
          team,
          kind: "done",
          body: `"${ticket.id}" completed by ${participantId}.`,
        });
        await announceDependencyResolved({
          repoRoot,
          team,
          resolvedTicketId: ticket.id,
        });
      }
    }
    if (validation.report.progressNotes !== undefined) {
      await persistNotes(
        repoRoot,
        team,
        participantId,
        validation.report.progressNotes
      );
    }
    return {
      ran: true,
      outcome: "completed",
      reportStatus: validation.report.status,
      ticketIds,
    };
  }

  // Failure outcomes: attempt recorded, then the failure policy decides —
  // auto-reassign (idle teammate + clean worktree), freeze at threshold,
  // or escalate to Jason.
  for (const ticket of work) {
    const updated = await updateTicket(repoRoot, team, ticket.id, {
      status: "assigned",
      lastError: result.error ?? result.outcome,
    });
    if (result.outcome === "rate-limited") {
      await pauseParticipant({
        repoRoot,
        team,
        participantId,
        reason: "rate-limited",
      });
      safeNotify({
        repoRoot,
        team,
        kind: "rate-limited",
        body: `${participantId} hit a rate limit — paused automatically. Resume with teammate resume.`,
      });
    }
    await applyFailurePolicy({
      repoRoot,
      team,
      ticket: { ...updated, attempts: updated.attempts ?? 0 },
      failedParticipantId: participantId,
      roster: teamEntry.config.teammates,
    });
  }
  return { ran: true, outcome: result.outcome, ticketIds };
}
