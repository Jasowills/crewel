#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { decomposeRequest } from "../core/lead/index.js";

const repoRoot = process.argv[2] ?? process.cwd();
const teamName = process.argv[3];

if (!teamName) {
  console.error("lead-repl: missing team name");
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout, prompt: "lead> " });
console.log(
  `\x1b[1mCrewel lead for "${teamName}"\x1b[0m — type a request and press Enter`
);
console.log(`Example: Add a login flow per docs/spec.md`);
rl.prompt();

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
