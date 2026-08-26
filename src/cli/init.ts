import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createTeam } from "../core/team/index.js";
import { knownAdapterIds } from "../core/adapters/index.js";

async function ask(
  question: string,
  defaultValue?: string,
  validator?: (v: string) => string | null
): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = (await rl.question(`${question}${suffix}: `)).trim();
      const value =
        answer === "" && defaultValue !== undefined ? defaultValue : answer;
      if (validator) {
        const err = validator(value);
        if (err) {
          console.error(`  ✗ ${err}`);
          continue;
        }
      }
      if (value === "" && defaultValue === undefined) {
        console.error("  ✗ required");
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

async function askCount(agent: string): Promise<number> {
  const raw = await ask(`How many ${agent} teammates? (0-5)`, "0", (v) => {
    if (!/^\d+$/.test(v)) return "enter a number 0-5";
    const n = Number(v);
    if (n < 0 || n > 5) return "0-5";
    return null;
  });
  return Number(raw);
}

export async function runInitWizard(repoRoot: string): Promise<number> {
  const crewelJsonPath = path.join(repoRoot, "crewel.json");
  if (existsSync(crewelJsonPath)) {
    const overwrite = await ask(
      `crewel.json already exists at ${crewelJsonPath}. Overwrite? (y/N)`,
      "n"
    );
    if (!/^y(es)?$/i.test(overwrite)) {
      console.log("Aborted — existing config kept.");
      return 0;
    }
  }

  // Team name — default to folder name sanitized
  const folderName =
    path
      .basename(path.resolve(repoRoot))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-") || "team";
  const teamName = await ask("Team name", folderName, (v) =>
    /^[a-z0-9][a-z0-9-]*$/.test(v)
      ? null
      : "lowercase letters, digits, hyphens only"
  );

  console.log(
    "\nConfigure teammates — for each agent type, how many instances?"
  );
  const known = knownAdapterIds(); // e.g. mock, opencode, claude-code, codex
  const counts = new Map<string, number>();
  let total = 0;
  for (const agent of known) {
    // Don't prompt for mock in the wizard's happy path? Keep it but default 0.
    const n = await askCount(agent);
    counts.set(agent, n);
    total += n;
  }
  if (total === 0) {
    console.error(
      "error: team needs at least one teammate — re-run crewel init"
    );
    return 1;
  }

  // Build teammatesSpec for createTeam
  const teammatesSpec = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${type}:${n}`)
    .join(",");

  // Lead — pick from any known type, suggest first non-zero
  const firstNonZero =
    [...counts.entries()].find(([, n]) => n > 0)?.[0] ?? known[0] ?? "mock";
  const lead = await ask(
    `Pick team lead / orchestrator (${known.join(", ")})`,
    firstNonZero,
    (v) =>
      known.includes(v) ? null : `unknown type — known: ${known.join(", ")}`
  );

  console.log(
    `\nCreating team "${teamName}" — lead ${lead}, teammates ${teammatesSpec} ...`
  );

  const config = await createTeam({
    repoRoot,
    name: teamName,
    leadType: lead,
    teammatesSpec,
  });

  // Also write visible crewel.json at repo root for the launcher's quick check
  const crewelJson = {
    team: config.name,
    lead: config.lead.type,
    teammates: teammatesSpec,
    createdAt: config.createdAt,
  };
  await writeFile(
    crewelJsonPath,
    JSON.stringify(crewelJson, null, 2) + "\n",
    "utf8"
  );
  console.log(`✓ wrote ${crewelJsonPath}`);
  console.log(
    `✓ team "${config.name}" ready — teammates: ${config.teammates.map((t) => t.id).join(", ")}`
  );
  console.log(`\nNext: run \x1b[1mcrewel\x1b[0m to launch the team.`);
  return 0;
}

export async function ensureCrewelConfig(repoRoot: string): Promise<boolean> {
  const crewelJsonPath = path.join(repoRoot, "crewel.json");
  const crewelDir = path.join(repoRoot, ".crewel");
  if (existsSync(crewelJsonPath)) return true;
  if (existsSync(crewelDir)) return true;
  // Also check .crewel/config.json hidden alternative
  if (existsSync(path.join(crewelDir, "config.json"))) return true;
  return false;
}
