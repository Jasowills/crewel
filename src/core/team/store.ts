import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CrewelError } from "../errors.js";
import { TICKET_LIFECYCLE } from "../tickets/model.js";
import type { Ticket } from "../tickets/model.js";
import type { TeamConfig } from "./config.js";

export const crewelDirName = ".crewel";

export function crewelRoot(repoRoot: string): string {
  return path.join(repoRoot, crewelDirName);
}

export function teamsRoot(repoRoot: string): string {
  return path.join(crewelRoot(repoRoot), "teams");
}

export function teamDir(repoRoot: string, name: string): string {
  return path.join(teamsRoot(repoRoot), name);
}

export function ticketsDir(repoRoot: string, name: string): string {
  return path.join(teamDir(repoRoot, name), "tickets");
}

export interface LoadedTeam {
  name: string;
  config: TeamConfig;
}

export async function loadAllTeams(repoRoot: string): Promise<LoadedTeam[]> {
  const dir = teamsRoot(repoRoot);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const teams: LoadedTeam[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(dir, entry.name, "config.json");
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
      throw new CrewelError(
        `corrupt team state: missing config.json for "${entry.name}"`
      );
    }
    let config: TeamConfig;
    try {
      config = JSON.parse(raw) as TeamConfig;
    } catch {
      throw new CrewelError(
        `corrupt team state: unreadable config.json for "${entry.name}"`
      );
    }
    teams.push({ name: entry.name, config });
  }
  return teams;
}

export async function findActiveTeams(repoRoot: string): Promise<LoadedTeam[]> {
  const teams = await loadAllTeams(repoRoot);
  return teams.filter((team) => team.config.status === "active");
}

export interface BoardSummary {
  total: number;
  byStatus: Record<string, number>;
}

export async function summarizeBoard(
  repoRoot: string,
  name: string
): Promise<BoardSummary> {
  const tickets = await loadTickets(repoRoot, name);
  const byStatus: Record<string, number> = {};
  for (const status of TICKET_LIFECYCLE) {
    byStatus[status] = 0;
  }
  let total = 0;
  for (const ticket of tickets) {
    total += 1;
    // Frozen surfaces under blocked; clarification under
    // needs-clarification; both override underlying status.
    const key = ticket.frozen
      ? "blocked"
      : ticket.clarification
        ? "needs-clarification"
        : ticket.status;
    if (byStatus[key] !== undefined) byStatus[key] += 1;
  }
  return { total, byStatus };
}

export async function loadTickets(
  repoRoot: string,
  name: string
): Promise<Ticket[]> {
  const dir = ticketsDir(repoRoot, name);
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const tickets: Ticket[] = [];
  for (const file of entries.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = await readFile(path.join(dir, file), "utf8");
      tickets.push(JSON.parse(raw) as Ticket);
    } catch {
      // Skip unreadable twins; validateTickets is the strict gate.
    }
  }
  return tickets;
}

export async function updateTicket(
  repoRoot: string,
  team: string,
  id: string,
  patch: Partial<Ticket>
): Promise<Ticket> {
  const ticketPath = path.join(ticketsDir(repoRoot, team), `${id}.json`);
  let raw: string;
  try {
    raw = await readFile(ticketPath, "utf8");
  } catch {
    throw new CrewelError(`ticket "${id}" not found — validate tickets first`);
  }
  let current: Ticket;
  try {
    current = JSON.parse(raw) as Ticket;
  } catch {
    throw new CrewelError(`corrupt ticket twin for "${id}"`);
  }
  const updated: Ticket = { ...current, ...patch };
  await writeFile(ticketPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export function participantsDir(repoRoot: string, team: string): string {
  return path.join(teamDir(repoRoot, team), "participants");
}

export function participantDir(
  repoRoot: string,
  team: string,
  participantId: string
): string {
  return path.join(participantsDir(repoRoot, team), participantId);
}

export async function appendGitIgnoreEntry(
  repoRoot: string,
  entry = `${crewelDirName}/`
): Promise<void> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf8");
  } catch {
    // No .gitignore yet — start a fresh one below.
  }
  const alreadyIgnored = content
    .split(/\r?\n/)
    .some((line) => line.trim() === entry);
  if (alreadyIgnored) return;
  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  await writeFile(gitignorePath, `${content}${separator}${entry}\n`, "utf8");
}
