#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CrewelError } from "./core/errors.js";
import { createTeam } from "./core/team/index.js";
import { teamStatus as teamStatusCore } from "./core/team/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export function getVersion(): string {
  return pkg.version;
}

interface CliContext {
  repoRoot: string;
}

function parseArgs(args: string[]): {
  positionals: string[];
  flags: Map<string, string>;
} {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new CrewelError(`flag ${arg} expects a value`);
      }
      flags.set(arg.slice(2), value);
      i++;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function printHelp(): void {
  console.log(
    `crewel ${getVersion()} — a mixed crew of coding agents, stitched together on one ticket board.`
  );
  console.log("");
  console.log("Usage: crewel <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log(
    "  team create <name> --lead <type> --teammates <type>:<count>,..."
  );
  console.log("  team status [name]");
  console.log("");
  console.log("  --version, -v   Print the version");
}

async function teamCreate(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const name = positionals[0];
  const lead = flags.get("lead");
  const teammates = flags.get("teammates");
  if (!name || !lead || !teammates) {
    console.error(
      "error: team create needs <name>, --lead <type>, and --teammates <type>:<count>,..."
    );
    return 1;
  }
  const config = await createTeam({
    repoRoot: ctx.repoRoot,
    name,
    leadType: lead,
    teammatesSpec: teammates,
  });
  console.log(`created team "${config.name}"`);
  console.log(`  lead:      ${config.lead.type}`);
  const roster = config.teammates
    .map((teammate) => `${teammate.id} (${teammate.type})`)
    .join(", ");
  console.log(`  teammates: ${roster}`);
  return 0;
}

async function teamStatus(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals } = parseArgs(args);
  const { config, board } = await teamStatusCore({
    repoRoot: ctx.repoRoot,
    name: positionals[0],
  });
  console.log(`team "${config.name}" (${config.status})`);
  console.log(`  lead:      ${config.lead.type}`);
  const roster = config.teammates
    .map((teammate) => `${teammate.id} (${teammate.type})`)
    .join(", ");
  console.log(`  teammates: ${roster}`);
  const entries = Object.entries(board.byStatus)
    .map(([status, count]) => `${status} ${count}`)
    .join(" · ");
  console.log(`  board:     ${board.total === 0 ? "no tickets yet" : entries}`);
  return 0;
}

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const [command, subcommand, ...rest] = argv;
  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp();
      return 0;
    }
    if (command === "--version" || command === "-v") {
      console.log(getVersion());
      return 0;
    }
    if (command === "team") {
      if (subcommand === "create") return await teamCreate(ctx, rest);
      if (subcommand === "status") return await teamStatus(ctx, rest);
      if (subcommand === undefined) {
        console.error("error: team needs a subcommand (create, status)");
        return 1;
      }
      console.error(`error: unknown team subcommand "${subcommand}"`);
      return 1;
    }
    console.error(`error: unknown command "${command}"`);
    return 1;
  } catch (error) {
    if (error instanceof CrewelError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

export function main(argv: string[]): Promise<number> {
  return runCli(argv, { repoRoot: process.cwd() });
}

let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = process.argv[1] ?? "";
}
if (invoked === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
