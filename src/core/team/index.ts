import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter, knownAdapterIds } from "../adapters/index.js";
import { CrewelError } from "../errors.js";
import {
  buildTeamConfig,
  expandTeammatesSpec,
  isValidTeamName,
  parseLeadSpec,
} from "./config.js";
import type { TeamConfig } from "./config.js";
import {
  appendGitIgnoreEntry,
  findActiveTeams,
  loadAllTeams,
  summarizeBoard,
  teamDir,
} from "./store.js";
import type { BoardSummary } from "./store.js";

const runGit = promisify(execFile);

async function assertInsideGitRepo(repoRoot: string): Promise<void> {
  try {
    const { stdout } = await runGit("git", [
      "-C",
      repoRoot,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (stdout.trim() !== "true") throw new Error("not a work tree");
  } catch {
    throw new CrewelError(
      `"${repoRoot}" is not inside a git repository — crewel requires git (worktree-per-teammate is mandatory in v1)`
    );
  }
}

function requireAdapter(type: string) {
  const adapter = getAdapter(type);
  if (!adapter) {
    throw new CrewelError(
      `unknown adapter type "${type}" — known types: ${knownAdapterIds().join(", ")}`
    );
  }
  return adapter;
}

export async function createTeam(input: {
  repoRoot: string;
  name: string;
  leadType: string;
  teammatesSpec: string;
}): Promise<TeamConfig> {
  const { repoRoot, name, leadType, teammatesSpec } = input;
  if (!isValidTeamName(name)) {
    throw new CrewelError(
      `invalid team name "${name}" — use lowercase letters, digits, and hyphens`
    );
  }
  const teammates = expandTeammatesSpec(teammatesSpec);
  const { type: leadAdapterType, model: leadModel } = parseLeadSpec(leadType);
  const lead = requireAdapter(leadAdapterType);
  const teammateAdapters = [
    ...new Set(teammates.map((teammate) => teammate.type)),
  ].map(requireAdapter);
  const adapters = [lead, ...teammateAdapters];
  const availability = await Promise.all(
    adapters.map((adapter) => adapter.checkAvailable())
  );
  const unavailable = adapters.filter((_, index) => !availability[index]);
  if (unavailable.length > 0) {
    const ids = unavailable.map((adapter) => adapter.id).join(", ");
    throw new CrewelError(`adapter(s) not available: ${ids}`);
  }
  await assertInsideGitRepo(repoRoot);
  const active = await findActiveTeams(repoRoot);
  if (active.length > 0 && active[0]) {
    throw new CrewelError(
      `team "${active[0].name}" is already active in this repo — crewel enforces one active team per repo`
    );
  }
  const config = buildTeamConfig({
    name,
    leadType: leadAdapterType,
    leadModel,
    teammates,
  });
  await mkdir(teamDir(repoRoot, name), { recursive: true });
  const configPath = path.join(teamDir(repoRoot, name), "config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await appendGitIgnoreEntry(repoRoot);
  return config;
}

export async function teamStatus(input: {
  repoRoot: string;
  name?: string;
}): Promise<{ config: TeamConfig; board: BoardSummary }> {
  const teams = await loadAllTeams(input.repoRoot);
  const found = input.name
    ? teams.find((team) => team.name === input.name)
    : (await findActiveTeams(input.repoRoot))[0];
  if (!found) {
    throw new CrewelError(
      input.name
        ? `no team named "${input.name}"`
        : "no active team found — create one with `crewel team create`"
    );
  }
  const board = await summarizeBoard(input.repoRoot, found.name);
  return { config: found.config, board };
}
