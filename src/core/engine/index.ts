import { getAdapter } from "../adapters/index.js";
import type { TurnReport, TurnResult } from "../adapters/types.js";
import { validateTurnReport } from "../adapters/types.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CrewelError } from "../errors.js";
import { drainInbox, sendMessage } from "../mail/index.js";
import {
  loadAllTeams,
  loadTickets,
  participantDir,
  updateTicket,
} from "../team/store.js";
import type { Ticket } from "../tickets/model.js";

export const LEAD_MAILBOX = "lead";

export const SENIOR_ENGINEER_INSTRUCTIONS = [
  "You operate as a senior/principal engineer.",
  "Push back on unclear tickets via needs-clarification instead of guessing.",
  "Flag scope creep. Write the tests and docs a principal engineer would",
  "consider table stakes. Every turn ends with a TurnReport — never guess,",
  "never silently fail.",
].join(" ");

export interface TurnRunResult {
  ran: boolean;
  reason?: "nothing-due";
  outcome?: TurnResult["outcome"];
  reportStatus?: TurnReport["status"];
  ticketIds: string[];
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
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

export async function runTeammateTurn(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<TurnRunResult> {
  const { repoRoot, team, participantId } = input;

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

  // Deliver everything waiting at this boundary first: messages are
  // drained (and archived) exactly once per turn.
  const messages = await drainInbox(repoRoot, team, participantId);

  // Work due: fresh assignments plus resumable in-progress work. A ticket
  // parked in-progress still belongs to its teammate across turns.
  const work = (await loadTickets(repoRoot, team)).filter(
    (ticket) =>
      ticket.assignee === participantId &&
      !ticket.clarification &&
      (ticket.status === "assigned" || ticket.status === "in-progress")
  );
  if (messages.length === 0 && work.length === 0) {
    return { ran: false, reason: "nothing-due", ticketIds: [] };
  }

  const notes = await readOptional(
    path.join(participantDir(repoRoot, team, participantId), "notes.md")
  );

  // Work has begun: reflect fresh assignments on the board before
  // anything can crash.
  for (const ticket of work) {
    if (ticket.status === "assigned") {
      await updateTicket(repoRoot, team, ticket.id, {
        status: "in-progress",
      });
    }
  }

  const heartbeatPath = path.join(
    participantDir(repoRoot, team, participantId),
    "heartbeat"
  );
  await mkdir(participantDir(repoRoot, team, participantId), {
    recursive: true,
  });
  const touchHeartbeat = async (): Promise<void> => {
    await writeFile(heartbeatPath, new Date().toISOString(), "utf8");
  };
  await touchHeartbeat();

  let result: TurnResult;
  try {
    result = await adapter.runTurn({
      bundle: {
        team,
        participantId,
        role: "teammate",
        worktreePath: repoRoot, // Ticket 05 swaps in isolated worktrees.
        tickets: work,
        messages,
        progressNotes: notes,
        instructions: SENIOR_ENGINEER_INSTRUCTIONS,
      },
      heartbeatPath,
      touchHeartbeat,
    });
  } finally {
    await rm(heartbeatPath, { force: true });
  }

  const ticketIds = work.map((ticket) => ticket.id);
  const now = new Date();

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
      return { ran: true, outcome: "failed-retryable", ticketIds };
    }
    for (const ticket of work) {
      await updateTicket(
        repoRoot,
        team,
        ticket.id,
        applyReportToTicket(validation.report, now)
      );
      if (validation.report.status === "blocked") {
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

  // Failure outcomes: back to assigned with an attempt recorded; policy
  // escalation (reassignment/freeze/pause) lands with ticket 07.
  for (const ticket of work) {
    await updateTicket(repoRoot, team, ticket.id, {
      status: "assigned",
      attempts: (ticket.attempts ?? 0) + 1,
      lastError: result.error ?? result.outcome,
    });
  }
  return { ran: true, outcome: result.outcome, ticketIds };
}
