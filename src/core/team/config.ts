import { CrewelError } from "../errors.js";

export interface Teammate {
  id: string;
  type: string;
}

export interface TeamConfig {
  version: 1;
  name: string;
  status: "active";
  createdAt: string;
  lead: { type: string };
  teammates: Teammate[];
  settings: Record<string, string>;
}

export const TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidTeamName(name: string): boolean {
  return TEAM_NAME_PATTERN.test(name);
}

const TEAMMATE_ENTRY = /^([a-z0-9-]+):(\d+)$/;

export function expandTeammatesSpec(spec: string): Teammate[] {
  const parts = spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new CrewelError(
      "no teammates requested — a team needs at least one teammate"
    );
  }
  const teammates: Teammate[] = [];
  for (const part of parts) {
    const match = TEAMMATE_ENTRY.exec(part);
    if (!match || !match[1] || !match[2]) {
      throw new CrewelError(
        `invalid teammate entry "${part}" — expected type:count like mock:2`
      );
    }
    const type = match[1];
    const count = Number(match[2]);
    if (!Number.isInteger(count) || count < 1) {
      throw new CrewelError(
        `invalid teammate count in "${part}" — must be an integer >= 1`
      );
    }
    for (let i = 1; i <= count; i++) {
      teammates.push({ id: `${type}-${i}`, type });
    }
  }
  return teammates;
}

export function buildTeamConfig(input: {
  name: string;
  leadType: string;
  teammates: Teammate[];
}): TeamConfig {
  return {
    version: 1,
    name: input.name,
    status: "active",
    createdAt: new Date().toISOString(),
    lead: { type: input.leadType },
    teammates: input.teammates,
    settings: {},
  };
}
