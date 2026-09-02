import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTeam } from "../core/team/index.js";
import { getAdapter, knownAdapterIds } from "../core/adapters/index.js";
import { findActiveTeams, teamDir } from "../core/team/store.js";

const runGit = promisify(execFile);

function isTTY(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

// ── piped-input support for non-TTY (e.g. `printf "a\nb\n" | crewel init`) ──
let pipedLines: string[] | null = null;
let pipedIdx = 0;
function ensurePiped(): void {
  if (pipedLines !== null) return;
  if (isTTY()) {
    pipedLines = [];
    return;
  }
  try {
    const data = readFileSync(0, "utf8");
    // split preserving empty lines for defaults; keep trailing empty handling
    pipedLines = data.split(/\r?\n/);
  } catch {
    pipedLines = [];
  }
  pipedIdx = 0;
}

// Reuse one readline interface for TTY so prompts are clean
let sharedRl: ReturnType<typeof createInterface> | null = null;
function getRl() {
  if (!sharedRl) {
    input.resume();
    sharedRl = createInterface({ input, output });
  }
  return sharedRl;
}
function closeSharedRl() {
  if (sharedRl) {
    try {
      sharedRl.close();
    } catch {}
    sharedRl = null;
  }
  // pause stdin so process can exit cleanly; next getRl() will resume
  try {
    input.pause();
  } catch {}
}

async function ask(
  question: string,
  defaultValue?: string,
  validator?: (v: string) => string | null
): Promise<string> {
  // Non-TTY: serve from piped buffer instead of readline (readline per-question loses pipe)
  if (!isTTY()) {
    ensurePiped();
    while (true) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const raw = pipedLines![pipedIdx++] ?? "";
      // echo the prompt + what was piped, for log visibility
      output.write(`${question}${suffix}: ${raw}\n`);
      const trimmed = raw.trim();
      const value =
        trimmed === "" && defaultValue !== undefined ? defaultValue : trimmed;
      if (validator) {
        const err = validator(value);
        if (err) {
          console.error(
            `  ✗ ${err} (piped input "${value}" invalid, trying next line)`
          );
          continue;
        }
      }
      if (value === "" && defaultValue === undefined) {
        console.error("  ✗ required");
        continue;
      }
      return value;
    }
  }
  const rl = getRl();
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
}

async function askCount(agent: string): Promise<number> {
  const raw = await ask(`How many ${agent} teammates? (0-5)`, "1", (v) => {
    if (!/^\d+$/.test(v)) return "enter a number 0-5";
    const n = Number(v);
    if (n < 1 || n > 5) return "1-5";
    return null;
  });
  return Number(raw);
}

// ── TTY helpers ──────────────────────────────────────────────────────────

type Choice = {
  value: string;
  label: string;
  available: boolean;
  detail: string;
};

function ansi(s: string): void {
  output.write(s);
}

/** Probe all known adapters in parallel, return map id -> available */
async function probeAvailability(): Promise<Map<string, boolean>> {
  const ids = knownAdapterIds();
  const results = await Promise.all(
    ids.map(async (id) => {
      const adapter = getAdapter(id);
      if (!adapter) return [id, false] as const;
      try {
        const ok = await adapter.checkAvailable();
        return [id, ok] as const;
      } catch {
        return [id, false] as const;
      }
    })
  );
  return new Map(results);
}

/**
 * Interactive checkbox list.
 * - arrow up/down to move, space to toggle, a to toggle all, enter to confirm
 * - unavailable choices are rendered dimmed and cannot be selected
 * - returns selected values (available only)
 */
async function promptMultiSelect(
  message: string,
  choices: Choice[]
): Promise<string[]> {
  if (!isTTY()) {
    // Non-TTY fallback: return all available ids (caller will ask counts sequentially)
    return choices.filter((c) => c.available).map((c) => c.value);
  }

  const selected = new Set<string>();
  let cursor = choices.findIndex((c) => c.available);
  if (cursor === -1) cursor = 0;

  // enable keypress events - pause shared readline first so raw input works
  closeSharedRl();
  readline.emitKeypressEvents(input);
  const wasRaw = (input as unknown as { isRaw?: boolean }).isRaw;
  if (input.isTTY) input.setRawMode(true);
  input.resume();

  function render() {
    // move cursor up to overwrite previous render
    // first render: print message + choices
    // subsequent: clear and re-render
    const lines: string[] = [];
    lines.push(`\n${message}`);
    lines.push(`  (space to toggle, ↑/↓ to move, enter to confirm)\n`);
    choices.forEach((choice, idx) => {
      const isCursor = idx === cursor;
      const isSelected = selected.has(choice.value);
      const pointer = isCursor ? "❯" : " ";
      let box: string;
      if (!choice.available) {
        box = "○"; // unavailable cannot be checked
      } else {
        box = isSelected ? "◉" : "◯";
      }
      const label = choice.label;
      const detail = choice.detail;
      const dim = !choice.available ? "\x1b[2m" : "";
      const selectedStyle = isSelected ? "\x1b[36m" : "";
      const cursorStyle = isCursor ? "\x1b[1m" : "";
      const reset = "\x1b[0m";
      lines.push(
        `${pointer} ${dim}${cursorStyle}${box} ${label}${detail ? `  ${dim}${detail}${reset}` : reset}${isCursor ? reset : ""}${selectedStyle}${reset}`
      );
    });
    if (choices.some((c) => !c.available)) {
      lines.push(`\n  \x1b[2m○ = not installed (cannot select)\x1b[0m`);
    }
    lines.push("");
    ansi(`\x1B[2J\x1B[H`); // clear screen-ish; alternative: move up
    // Simpler: just clear from cursor and reprint — use clear + reprint
    // We already cleared screen; reprint
    for (const line of lines) ansi(`${line}\n`);
  }

  // We use a manual render that clears and redraws on every key.
  // To avoid clearing whole screen (noisy), we do a line-count clear on subsequent renders.
  // Initial clear
  let renderedOnce = false;
  function rerender() {
    if (!renderedOnce) {
      renderedOnce = true;
      render();
      return;
    }
    // clear previous lines: choices.length + 4 header/footer lines
    const totalLines = choices.length + 4 + 2;
    // move cursor up and clear
    ansi(`\x1B[${totalLines}A\x1B[2J\x1B[H`);
    render();
  }

  return await new Promise<string[]>((resolve) => {
    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.name === "up" || (key.name === "k" && key.ctrl === false)) {
        // find previous available? allow moving onto unavailable but skip selection
        cursor = (cursor - 1 + choices.length) % choices.length;
        rerender();
      } else if (
        key.name === "down" ||
        (key.name === "j" && key.ctrl === false)
      ) {
        cursor = (cursor + 1) % choices.length;
        rerender();
      } else if (key.name === "space" || _str === " ") {
        const choice = choices[cursor];
        if (!choice) return;
        if (!choice.available) {
          // beep
          ansi("\x07");
          return;
        }
        if (selected.has(choice.value)) selected.delete(choice.value);
        else selected.add(choice.value);
        rerender();
      } else if ((key.name === "a" || _str === "a") && !key.ctrl && !key.meta) {
        // toggle all available
        const allAvailable = choices
          .filter((c) => c.available)
          .map((c) => c.value);
        const allSelected = allAvailable.every((v) => selected.has(v));
        if (allSelected) allAvailable.forEach((v) => selected.delete(v));
        else allAvailable.forEach((v) => selected.add(v));
        rerender();
      } else if (
        key.name === "return" ||
        key.name === "enter" ||
        key.name === "lineFeed"
      ) {
        input.removeListener("keypress", onKeypress);
        if (input.isTTY) input.setRawMode(Boolean(wasRaw));
        // leave stdin resumed for next ask
        input.resume();
        ansi("\n");
        resolve([...selected]);
      } else if (key.ctrl && key.name === "c") {
        input.removeListener("keypress", onKeypress);
        if (input.isTTY) input.setRawMode(Boolean(wasRaw));
        input.resume();
        ansi("\nAborted.\n");
        // exit wizard via empty selection signal
        resolve([]);
      }
    };

    input.on("keypress", onKeypress);
    input.resume();
    // initial render
    rerender();
    // if no available at all, resolve empty after render so wizard can handle
    if (choices.every((c) => !c.available)) {
      // still let user see, but they can't select — wait for enter
    }
  });
}

/** Single-select list (arrow + enter) */
async function promptSelect(
  message: string,
  options: string[],
  defaultValue?: string
): Promise<string> {
  if (!isTTY() || options.length === 0) {
    // fallback to classic ask
    const def = defaultValue ?? options[0] ?? "";
    return ask(`${message} (${options.join(", ")})`, def, (v) =>
      options.includes(v) ? null : `unknown — pick: ${options.join(", ")}`
    );
  }

  let cursor = defaultValue ? options.indexOf(defaultValue) : 0;
  if (cursor < 0) cursor = 0;

  closeSharedRl();
  readline.emitKeypressEvents(input);
  const wasRaw = (input as unknown as { isRaw?: boolean }).isRaw;
  if (input.isTTY) input.setRawMode(true);
  input.resume();

  function render() {
    ansi(`\x1B[2J\x1B[H`);
    ansi(`${message}\n`);
    ansi(`  (↑/↓ to move, enter to confirm)\n\n`);
    options.forEach((opt, idx) => {
      const isCursor = idx === cursor;
      const pointer = isCursor ? "❯" : " ";
      const style = isCursor ? "\x1b[36m\x1b[1m" : "";
      const reset = "\x1b[0m";
      ansi(`${pointer} ${style}${opt}${reset}\n`);
    });
    ansi("\n");
  }

  return await new Promise<string>((resolve) => {
    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.name === "up") {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (
        key.name === "return" ||
        key.name === "enter" ||
        key.name === "lineFeed"
      ) {
        const choice = options[cursor] ?? options[0] ?? "";
        input.removeListener("keypress", onKeypress);
        if (input.isTTY) input.setRawMode(Boolean(wasRaw));
        input.resume();
        ansi(`\n`);
        resolve(choice);
      } else if (key.ctrl && key.name === "c") {
        input.removeListener("keypress", onKeypress);
        if (input.isTTY) input.setRawMode(Boolean(wasRaw));
        input.resume();
        ansi("\nAborted.\n");
        resolve(defaultValue ?? options[0] ?? "");
      }
    };
    input.on("keypress", onKeypress);
    input.resume();
    render();
  });
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
      closeSharedRl();
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

  // If an active team already exists, handle overwrite before probing agents
  try {
    const active = await findActiveTeams(repoRoot);
    if (active.length > 0) {
      const existing = active[0]!;
      if (existing.name === teamName) {
        const ow = await ask(
          `team "${teamName}" already exists and is active. Overwrite? (y/N)`,
          "n"
        );
        if (!/^y(es)?$/i.test(ow)) {
          console.log("Aborted — existing team kept.");
          closeSharedRl();
          return 0;
        }
        // Remove existing team state so createTeam won't throw "already active"
        await rm(teamDir(repoRoot, teamName), { recursive: true, force: true });
        try {
          await rm(crewelJsonPath, { force: true });
        } catch {}
        console.log(`  removed existing team "${teamName}" — recreating...`);
      } else {
        console.error(
          `error: team "${existing.name}" is already active in this repo — crewel enforces one active team per repo`
        );
        console.error(
          `  fix: run "crewel team archive --team ${existing.name}" or "crewel team archive" to archive it, then re-run crewel init`
        );
        closeSharedRl();
        return 1;
      }
    }
  } catch (e) {
    // findActiveTeams may throw if .crewel missing — treat as no active team
    if (e instanceof Error && e.message.includes("already active")) throw e;
  }

  // Early git check — fail fast before adapter prompts
  try {
    const { stdout } = await runGit("git", [
      "-C",
      repoRoot,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (stdout.trim() !== "true") throw new Error("not a work tree");
  } catch {
    console.error(
      `error: "${repoRoot}" is not inside a git repository — crewel requires git (worktree-per-teammate is mandatory in v1)`
    );
    console.error(`  fix: cd into a git repo or run \`git init\` first`);
    closeSharedRl();
    return 1;
  }

  // Probe adapters before asking
  console.log("\nChecking installed agents...");
  const availability = await probeAvailability();
  const known = knownAdapterIds();
  const choiceDetails = new Map<string, string>([
    ["mock", "always available — for CI/dry runs"],
    ["opencode", "needs `opencode --version`"],
    [
      "claude-code",
      "needs `claude --version` (npm i -g @anthropic-ai/claude-code)",
    ],
    ["codex", "needs `codex --version`"],
  ]);

  // Show detection summary
  for (const id of known) {
    const ok = availability.get(id);
    const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[2m✗\x1b[0m";
    const detail = choiceDetails.get(id) ?? "";
    console.log(
      `  ${mark} ${id.padEnd(12)} ${ok ? "installed" : "not installed"}  \x1b[2m${detail}\x1b[0m`
    );
  }
  const anyAvailable = [...availability.values()].some(Boolean);
  if (!anyAvailable) {
    console.error(
      "\n  No adapters detected — install at least one (or use mock for testing)."
    );
  }

  // Step 1: pick which agent types to use (space to select)
  console.log("");
  const choices: Choice[] = known.map((id) => ({
    value: id,
    label: id,
    available: Boolean(availability.get(id)),
    detail: availability.get(id) ? "installed" : "not installed",
  }));

  const selected = await promptMultiSelect(
    "Select agents to include in this team:",
    choices
  );

  if (selected.length === 0) {
    console.error(
      "error: no agents selected — re-run crewel init and select at least one with space"
    );
    closeSharedRl();
    return 1;
  }

  // Validate that all selected are actually available (defense if bypassed)
  const unavailableSelected = selected.filter((id) => !availability.get(id));
  if (unavailableSelected.length > 0) {
    console.error(
      `error: adapter(s) not available: ${unavailableSelected.join(", ")} — install them first`
    );
    closeSharedRl();
    return 1;
  }

  // Step 2: for each selected agent, ask count and model
  console.log(`\nHow many instances for each selected agent? (1-5)\n`);
  const counts = new Map<string, number>();
  const models = new Map<string, string>();
  for (const agent of selected) {
    const n = await askCount(agent);
    counts.set(agent, n);
    if (agent !== "mock") {
      const m = await ask(
        `  Model for ${agent} (leave empty for default)`,
        "",
        () => null
      );
      if (m.trim() !== "") models.set(agent, m.trim());
    }
  }

  const teammatesSpec = [...counts.entries()]
    .map(([type, n]) => {
      const m = models.get(type);
      return m ? `${type}:${m}:${n}` : `${type}:${n}`;
    })
    .join(",");

  // Step 3: pick lead from selected agents only
  const leadDefault = selected[0] ?? known[0] ?? "mock";
  const leadBase = await promptSelect(
    "Pick team lead / orchestrator",
    selected,
    leadDefault
  );

  if (!selected.includes(leadBase)) {
    console.error(
      `error: lead must be one of the selected agents: ${selected.join(", ")}`
    );
    closeSharedRl();
    return 1;
  }

  let lead = leadBase;
  if (leadBase !== "mock") {
    const lm = await ask(
      `  Model for lead ${leadBase} (leave empty for default)`,
      models.get(leadBase) ?? "",
      () => null
    );
    if (lm.trim() !== "") lead = `${leadBase}:${lm.trim()}`;
    else if (models.get(leadBase)) lead = `${leadBase}:${models.get(leadBase)}`;
  }

  console.log(
    `\nCreating team "${teamName}" — lead ${lead}, teammates ${teammatesSpec} ...`
  );

  let config;
  try {
    config = await createTeam({
      repoRoot,
      name: teamName,
      leadType: lead,
      teammatesSpec,
    });
  } catch (e) {
    closeSharedRl();
    throw e;
  }

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
  closeSharedRl();
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
