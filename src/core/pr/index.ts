import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CrewelError } from "../errors.js";
import { loadTickets, teamDir } from "../team/store.js";
import { loadAllTeams } from "../team/store.js";
import { integrationBranchFor } from "../worktrees/index.js";

const run = promisify(execFile);

export async function openCloseoutPR(input: {
  repoRoot: string;
  team: string;
}): Promise<{ path: string; url?: string }> {
  const found = (await loadAllTeams(input.repoRoot)).find(
    (t) => t.name === input.team
  );
  if (!found) throw new CrewelError(`no team named "${input.team}"`);
  const tickets = await loadTickets(input.repoRoot, input.team);
  const integration = integrationBranchFor(input.team);
  const title = `crewel: ${input.team} → main`;
  const bodyLines: string[] = [];
  bodyLines.push(`Close-out for team **${input.team}**`);
  bodyLines.push(`Integration branch: \`${integration}\` → \`main\``);
  bodyLines.push(`Gated on Jason — do not auto-merge.`);
  bodyLines.push("");
  bodyLines.push("Tickets:");
  for (const t of tickets) {
    bodyLines.push(
      `- ${t.id}: ${t.title} — ${t.status}${t.approved ? " [approved]" : ""}`
    );
  }
  const body = bodyLines.join("\n");
  const prPath = path.join(teamDir(input.repoRoot, input.team), "pr.md");
  await mkdir(path.dirname(prPath), { recursive: true });
  const content = `# ${title}\n\n${body}\n\n_Gated on Jason_\n`;
  await writeFile(prPath, content, "utf8");

  // Best-effort gh attempt
  try {
    const { stdout } = await run(
      "gh",
      [
        "pr",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--base",
        "main",
        "--head",
        integration,
      ],
      {
        cwd: input.repoRoot,
        timeout: 10_000,
      }
    );
    const url = stdout.trim().split("\n").pop() || undefined;
    return { path: prPath, url };
  } catch {
    return { path: prPath };
  }
}
