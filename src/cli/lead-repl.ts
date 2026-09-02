#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { decomposeRequest } from "../core/lead/index.js";
import { loadAllTeams, loadTickets } from "../core/team/store.js";
import { watchTeam } from "../core/notifications/index.js";
import { answerClarification, approveTicket } from "../core/engine/index.js";
import { mergeApprovedTicket } from "../core/checkpoints/index.js";

const repoRoot = process.argv[2] ?? process.cwd();
const teamNameArg = process.argv[3];

async function resolveTeam(): Promise<string> {
  if (teamNameArg) return teamNameArg;
  const teams = await loadAllTeams(repoRoot);
  const active = teams.find((t) => t.config.status === "active");
  if (!active) throw new Error("No active team — run crewel init first");
  return active.config.name;
}

const teamName: string = (await resolveTeam().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
})) as string;

const rl = createInterface({ input: stdin, output: stdout, prompt: "lead> " });
console.log(
  `\x1b[1mCrewel lead for "${teamName}"\x1b[0m — type a request and press Enter`
);
console.log(`Example: Add a login flow per docs/spec.md`);
console.log(
  ` lead is the only reviewer/pusher — teammates stream in the grid.`
);
rl.prompt();

// Watch for needs-clarification and auto-prompt the user
let watcher: Awaited<ReturnType<typeof watchTeam>> | null = null;
try {
  watcher = await watchTeam({ repoRoot, team: teamName }, async (event) => {
    if (event.source === "tickets") {
      const tickets = await loadTickets(repoRoot, teamName).catch(() => []);
      const needs = tickets.filter((t) => t.clarification);
      for (const t of needs) {
        console.log(
          `\n\x1b[33m[needs-clarification] ${t.id}: ${t.title}\x1b[0m\n  Q: ${t.clarification?.question}\n  → type: clarify ${t.id} <answer>`
        );
        rl.prompt();
      }
    }
  });
  void watcher;
} catch {}

rl.on("line", async (line) => {
  const request = line.trim();
  if (!request) {
    rl.prompt();
    return;
  }
  if (request === "exit" || request === "quit") {
    rl.close();
    return;
  }
  // Handle `clarify <id> <answer>` directly in the lead REPL
  if (request.startsWith("clarify ")) {
    const [, id, ...rest] = request.split(" ");
    const answer = rest.join(" ");
    if (!id || !answer) {
      console.error("Usage: clarify <ticket-id> <answer>");
      rl.prompt();
      return;
    }
    try {
      await answerClarification({
        repoRoot,
        team: teamName,
        ticketId: id,
        answer,
      });
      console.log(`✓ clarification sent for ${id}`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
    }
    rl.prompt();
    return;
  }
  if (request.startsWith("approve ")) {
    const id = request.split(" ")[1];
    try {
      await approveTicket({ repoRoot, team: teamName, ticketId: id! });
      console.log(`✓ approved ${id}`);
      const result = await mergeApprovedTicket({
        repoRoot,
        team: teamName,
        ticketId: id!,
      });
      console.log(
        result.merged
          ? `✓ merged ${id} to integration`
          : `✗ merge blocked: ${result.detail}`
      );
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
    }
    rl.prompt();
    return;
  }
  console.log(`\n→ decomposing: "${request}" ...`);
  try {
    const result = await decomposeRequest({
      repoRoot,
      team: teamName,
      request,
    });
    console.log(
      `✓ decomposed into ${result.count} tickets: ${result.ticketIds.join(", ")}`
    );
    console.log(
      `  Board: run "crewel team tickets --team ${teamName}" or watch the grid.`
    );
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
  }
  console.log("");
  rl.prompt();
});

rl.on("close", () => {
  console.log("\nLead session ended.");
  process.exit(0);
});
