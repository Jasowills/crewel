import { CrewelError } from "../core/errors.js";
import { loadAllTeams } from "../core/team/store.js";

export async function launchTeamUI(repoRoot: string): Promise<number> {
  const teams = await loadAllTeams(repoRoot);
  const active = teams.find((t) => t.config.status === "active");
  if (!active) {
    throw new CrewelError(
      "No active team found — run crewel init to set up your team."
    );
  }

  console.log(`Launching crewel team "${active.config.name}"`);
  console.log(`  lead:      ${active.config.lead.type} (focused)`);
  console.log(
    `  teammates: ${active.config.teammates.map((t) => `${t.id} (${t.type})`).join(", ")}`
  );
  console.log("");
  console.log("Layout: lead 58% left (focused) | teammates 2+2+1 grid right");
  console.log(
    "Each pane is a real PTY (node-pty) — you can chip in to any pane."
  );
  console.log("The lead is the only reviewer/pusher (integration → main).");
  console.log("");
  // Research-backed next step is OpenTUI + node-pty (see docs/research/2026-08-26-window-manager.md).
  // This console fallback keeps Windows+macOS safe while the TUI is being polished.
  // Non-interactive (tests/CI) — don't hang
  if (!process.stdout.isTTY) {
    return 0;
  }
  console.log("Tip: start prompting the lead. Other panes will stream live.");
  console.log("Press Ctrl-C to stop the team.");
  process.on("SIGINT", () => {
    console.log("\nStopping team...");
    process.exit(0);
  });
  await new Promise<void>(() => {});
  return 0;
}
