#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CrewelError } from "./core/errors.js";
import { board, validateTickets } from "./core/tickets/index.js";
import { createTeam } from "./core/team/index.js";
import { teamStatus as teamStatusCore } from "./core/team/index.js";
import {
  answerClarification,
  assignTicket,
  checkStalls,
  interruptTeammate,
  pauseTeammate,
  resumeTeammate,
  runTeammateTurn,
  startTeam,
  stopTeam,
  unfreezeTicket,
} from "./core/engine/index.js";
import {
  pingDesktop,
  tailJasonLog,
  watchTeam,
} from "./core/notifications/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export function getVersion(): string {
  return pkg.version;
}

interface CliContext {
  repoRoot: string;
}

const BOOLEAN_FLAGS = new Set(["now", "desktop"]);

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
      const name = arg.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, "true");
        continue;
      }
      const value = args[i + 1];
      if (value === undefined) {
        throw new CrewelError(`flag ${arg} expects a value`);
      }
      flags.set(name, value);
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
  console.log("  team tickets [--team <name>]");
  console.log("  team watch [--team <name>] [--desktop]");
  console.log("  tickets validate [--team <name>]");
  console.log("  ticket assign <id> --to <teammate>");
  console.log('  ticket clarify <id> --answer "..."');
  console.log("  ticket unfreeze <id>");
  console.log("  teammate tick <id>");
  console.log("  teammate interrupt <id>");
  console.log('  teammate pause <id> --reason "..."');
  console.log("  teammate resume <id>");
  console.log("  team stop [--team <name>] [--now]");
  console.log("  team start [--team <name>]");
  console.log("  team check-stalls --older-than-ms <ms>");
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

async function resolveTeamName(
  ctx: CliContext,
  flagValue: string | undefined
): Promise<string> {
  if (flagValue) return flagValue;
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  return config.name;
}

async function ticketsValidate(
  ctx: CliContext,
  args: string[]
): Promise<number> {
  const { flags } = parseArgs(args);
  const team = await resolveTeamName(ctx, flags.get("team"));
  const { written } = await validateTickets({ repoRoot: ctx.repoRoot, team });
  console.log(`✓ ${written} ticket(s) valid — JSON twins updated`);
  return 0;
}

async function teamBoard(ctx: CliContext, args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const name = await resolveTeamName(ctx, flags.get("team"));
  const result = await board({ repoRoot: ctx.repoRoot, team: name });
  console.log(`ticket board for "${name}"`);
  for (const column of result.columns) {
    if (column.tickets.length === 0) {
      console.log(`  ${column.status}: (empty)`);
      continue;
    }
    console.log(`  ${column.status}:`);
    for (const ticket of column.tickets) {
      const who = ticket.assignee ? ` (${ticket.assignee})` : "";
      console.log(`    - ${ticket.id} ${ticket.title}${who}`);
    }
  }
  return 0;
}

async function ticketAssign(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const id = positionals[0];
  const to = flags.get("to");
  if (!id || !to) {
    console.error("error: ticket assign needs <id> and --to <teammate>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  await assignTicket({
    repoRoot: ctx.repoRoot,
    team: config.name,
    ticketId: id,
    assignee: to,
    teammateIds: config.teammates.map((mate) => mate.id),
  });
  console.log(`✓ ${id} assigned to ${to}`);
  return 0;
}

async function ticketClarify(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const id = positionals[0];
  const answer = flags.get("answer");
  if (!id || !answer) {
    console.error('error: ticket clarify needs <id> and --answer "..."');
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  await answerClarification({
    repoRoot: ctx.repoRoot,
    team: config.name,
    ticketId: id,
    answer,
  });
  console.log(`✓ clarification answered for ${id}`);
  return 0;
}

async function teammateTick(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals } = parseArgs(args);
  const id = positionals[0];
  if (!id) {
    console.error("error: teammate tick needs <teammate-id>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  const result = await runTeammateTurn({
    repoRoot: ctx.repoRoot,
    team: config.name,
    participantId: id,
  });
  if (!result.ran) {
    const why =
      result.reason === "paused"
        ? "paused — resume before ticking"
        : result.reason === "team-stopped"
          ? "team is stopped — crewel team start to resume"
          : "nothing due";
    console.log(`${id}: ${why}`);
    return 0;
  }
  const tickets = result.ticketIds.join(", ") || "no tickets";
  console.log(
    `${id}: ${result.outcome}${
      result.reportStatus ? ` (${result.reportStatus})` : ""
    } — ${tickets}`
  );
  return 0;
}

async function teamWatch(ctx: CliContext, args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const name = await resolveTeamName(ctx, flags.get("team"));
  const desktop = flags.has("desktop");
  let offset = (await tailJasonLog({ repoRoot: ctx.repoRoot, team: name }))
    .length;
  console.log(`watching "${name}" — Ctrl-C to stop`);
  const watcher = await watchTeam(
    { repoRoot: ctx.repoRoot, team: name },
    (event) => {
      if (event.source === "mail") {
        console.log(`[mail] new mail for ${event.participant}`);
      } else if (event.source === "tickets") {
        console.log("[board] ticket state changed");
      } else if (event.source === "jason") {
        void (async () => {
          const fresh = await tailJasonLog({
            repoRoot: ctx.repoRoot,
            team: name,
            sinceBytes: offset,
          });
          if (fresh.length > 0) {
            process.stdout.write(fresh);
            offset += Buffer.byteLength(fresh);
          }
        })();
        if (desktop) pingDesktop("crewel", `${name}: new notification`);
      }
    }
  );
  process.on("SIGINT", () => {
    void watcher.stop().then(() => process.exit(0));
  });
  await new Promise(() => {});
  return 0; // unreachable; keeps the signature honest
}

async function teammateInterrupt(
  ctx: CliContext,
  args: string[]
): Promise<number> {
  const { positionals } = parseArgs(args);
  const id = positionals[0];
  if (!id) {
    console.error("error: teammate interrupt needs <teammate-id>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  const result = await interruptTeammate({
    repoRoot: ctx.repoRoot,
    team: config.name,
    participantId: id,
  });
  console.log(
    result.aborted
      ? `✓ abort signalled to ${id} — ticket(s) return to assigned, worktree preserved`
      : `${id}: no in-flight turn to interrupt`
  );
  return 0;
}

async function teammatePause(ctx: CliContext, args: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const id = positionals[0];
  const reason = flags.get("reason") ?? "paused by operator";
  if (!id) {
    console.error("error: teammate pause needs <teammate-id>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  await pauseTeammate({
    repoRoot: ctx.repoRoot,
    team: config.name,
    participantId: id,
    reason,
  });
  console.log(`✓ ${id} paused — ${reason}`);
  return 0;
}

async function teammateResume(
  ctx: CliContext,
  args: string[]
): Promise<number> {
  const { positionals } = parseArgs(args);
  const id = positionals[0];
  if (!id) {
    console.error("error: teammate resume needs <teammate-id>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  await resumeTeammate({
    repoRoot: ctx.repoRoot,
    team: config.name,
    participantId: id,
  });
  console.log(`✓ ${id} resumed`);
  return 0;
}

async function teamStop(ctx: CliContext, args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const name = await resolveTeamName(ctx, flags.get("team"));
  const result = await stopTeam({
    repoRoot: ctx.repoRoot,
    team: name,
    now: flags.has("now"),
  });
  console.log(
    result.mode === "immediate"
      ? `✓ stopped "${name}" immediately (aborted: ${
          result.interrupted.join(", ") || "none"
        })`
      : `✓ "${name}" is stopping — in-flight turns finish, no new turns start`
  );
  return 0;
}

async function teamStart(ctx: CliContext, args: string[]): Promise<number> {
  const { flags } = parseArgs(args);
  const name = await resolveTeamName(ctx, flags.get("team"));
  await startTeam({ repoRoot: ctx.repoRoot, team: name });
  console.log(`✓ "${name}" started`);
  return 0;
}

async function teamCheckStalls(
  ctx: CliContext,
  args: string[]
): Promise<number> {
  const { flags } = parseArgs(args);
  const name = await resolveTeamName(ctx, flags.get("team"));
  const olderThanMs = Number(flags.get("older-than-ms") ?? "60000");
  const stalls = await checkStalls({
    repoRoot: ctx.repoRoot,
    team: name,
    stalledMs: Number.isFinite(olderThanMs) ? olderThanMs : 60000,
  });
  if (stalls.length === 0) {
    console.log("no stalls detected");
  } else {
    for (const stall of stalls) {
      console.log(
        `stalled: ${stall.participantId} (${Math.round(stall.ageMs / 1000)}s)${
          stall.ticketsReset.length
            ? ` — reset ${stall.ticketsReset.join(", ")}`
            : ""
        }`
      );
    }
  }
  return 0;
}

async function ticketUnfreeze(
  ctx: CliContext,
  args: string[]
): Promise<number> {
  const { positionals } = parseArgs(args);
  const id = positionals[0];
  if (!id) {
    console.error("error: ticket unfreeze needs <id>");
    return 1;
  }
  const { config } = await teamStatusCore({ repoRoot: ctx.repoRoot });
  await unfreezeTicket({
    repoRoot: ctx.repoRoot,
    team: config.name,
    ticketId: id,
  });
  console.log(`✓ ${id} unfrozen`);
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
      if (subcommand === "tickets") return await teamBoard(ctx, rest);
      if (subcommand === "watch") return await teamWatch(ctx, rest);
      if (subcommand === "stop") return await teamStop(ctx, rest);
      if (subcommand === "start") return await teamStart(ctx, rest);
      if (subcommand === "check-stalls") {
        return await teamCheckStalls(ctx, rest);
      }
      if (subcommand === undefined) {
        console.error(
          "error: team needs a subcommand (create, status, tickets)"
        );
        return 1;
      }
      console.error(`error: unknown team subcommand "${subcommand}"`);
      return 1;
    }
    if (command === "tickets") {
      if (subcommand === "validate") return await ticketsValidate(ctx, rest);
      console.error(
        'error: unknown tickets subcommand — try "crewel tickets validate"'
      );
      return 1;
    }
    if (command === "ticket") {
      if (subcommand === "assign") return await ticketAssign(ctx, rest);
      if (subcommand === "clarify") return await ticketClarify(ctx, rest);
      if (subcommand === "unfreeze") return await ticketUnfreeze(ctx, rest);
      console.error(
        "error: unknown ticket subcommand — try assign, clarify or unfreeze"
      );
      return 1;
    }
    if (command === "teammate") {
      if (subcommand === "tick") return await teammateTick(ctx, rest);
      if (subcommand === "interrupt") {
        return await teammateInterrupt(ctx, rest);
      }
      if (subcommand === "pause") return await teammatePause(ctx, rest);
      if (subcommand === "resume") return await teammateResume(ctx, rest);
      console.error(
        "error: unknown teammate subcommand — try tick, interrupt, pause or resume"
      );
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
