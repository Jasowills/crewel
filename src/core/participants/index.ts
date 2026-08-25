import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { participantDir } from "../team/store.js";

export interface ParticipantState {
  paused?: boolean;
  pausedReason?: string;
}

function statePath(repoRoot: string, team: string, id: string): string {
  return path.join(participantDir(repoRoot, team, id), "state.json");
}

export async function getParticipantState(
  repoRoot: string,
  team: string,
  participantId: string
): Promise<ParticipantState> {
  try {
    const raw = await readFile(
      statePath(repoRoot, team, participantId),
      "utf8"
    );
    return JSON.parse(raw) as ParticipantState;
  } catch {
    return {};
  }
}

export async function writeParticipantState(
  repoRoot: string,
  team: string,
  participantId: string,
  patch: ParticipantState
): Promise<ParticipantState> {
  const dir = participantDir(repoRoot, team, participantId);
  await mkdir(dir, { recursive: true });
  const current = await getParticipantState(repoRoot, team, participantId);
  // Explicit undefined clears a flag (e.g. resume clearing pausedReason).
  const next: ParticipantState = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key as keyof ParticipantState];
    else next[key as keyof ParticipantState] = value;
  }
  await writeFile(
    statePath(repoRoot, team, participantId),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8"
  );
  return next;
}

export async function isPaused(
  repoRoot: string,
  team: string,
  participantId: string
): Promise<boolean> {
  return (
    (await getParticipantState(repoRoot, team, participantId)).paused === true
  );
}

export async function pauseParticipant(input: {
  repoRoot: string;
  team: string;
  participantId: string;
  reason: string;
}): Promise<void> {
  await writeParticipantState(input.repoRoot, input.team, input.participantId, {
    paused: true,
    pausedReason: input.reason,
  });
}

export async function resumeParticipant(input: {
  repoRoot: string;
  team: string;
  participantId: string;
}): Promise<void> {
  await writeParticipantState(input.repoRoot, input.team, input.participantId, {
    paused: false,
    pausedReason: undefined,
  });
}

export interface HeartbeatInfo {
  ageMs: number | null;
}

export async function heartbeatAge(
  repoRoot: string,
  team: string,
  participantId: string
): Promise<number | null> {
  try {
    const info = await stat(
      path.join(participantDir(repoRoot, team, participantId), "heartbeat")
    );
    return Date.now() - info.mtimeMs;
  } catch {
    return null;
  }
}
