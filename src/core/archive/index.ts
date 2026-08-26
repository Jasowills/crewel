import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadTickets } from "../team/store.js";
import { CrewelError } from "../errors.js";
import { loadAllTeams } from "../team/store.js";

export async function archiveTeam(input: {
  repoRoot: string;
  team: string;
}): Promise<{ path: string }> {
  const found = (await loadAllTeams(input.repoRoot)).find(
    (t) => t.name === input.team
  );
  if (!found) throw new CrewelError(`no team named "${input.team}"`);
  const tickets = await loadTickets(input.repoRoot, input.team);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(input.repoRoot, ".crewel", "archive");
  await mkdir(archiveDir, { recursive: true });
  const filePath = path.join(archiveDir, `${input.team}-${timestamp}.md`);
  const lines: string[] = [];
  lines.push(`# Archive: ${input.team}`);
  lines.push(`Team: ${input.team}`);
  lines.push(`Lead: ${found.config.lead.type}`);
  lines.push(
    `Teammates: ${found.config.teammates.map((t) => `${t.id} (${t.type})`).join(", ")}`
  );
  lines.push(`Archived: ${new Date().toISOString()}`);
  lines.push(`Integration branch: crewel/${input.team}/integration`);
  lines.push("");
  lines.push("## Tickets");
  for (const t of tickets) {
    lines.push(
      `- ${t.id}: ${t.title} — ${t.status}${t.assignee ? ` (${t.assignee})` : ""}${t.approved ? " [approved]" : ""}`
    );
    if (t.acceptanceCriteria.length > 0) {
      lines.push(`  Acceptance: ${t.acceptanceCriteria.join("; ")}`);
    }
    if (t.scope) lines.push(`  Scope: ${t.scope.slice(0, 200)}`);
  }
  await writeFile(filePath, lines.join("\n") + "\n", "utf8");
  return { path: filePath };
}
