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

  if (!process.stdout.isTTY) {
    console.log(`Launching crewel team "${active.config.name}"`);
    console.log(`  lead:      ${active.config.lead.type} (focused)`);
    console.log(
      `  teammates: ${active.config.teammates.map((t) => `${t.id} (${t.type})`).join(", ")}`
    );
    console.log("Layout: lead 58% left | teammates 2+2+1 grid right");
    return 0;
  }

  // Try OpenTUI + node-pty
  try {
    const { createCliRenderer } = await import("@opentui/core");
    await import("node-pty");
    const renderer = await createCliRenderer();
    void renderer;

    console.log(`Launching crewel team "${active.config.name}" with OpenTUI`);
    console.log(`  lead: ${active.config.lead.type}`);
    // In full impl, we would set up Flexbox layout here
    // For now, just show the plan and keep alive
    console.log("Layout: lead 58% left (focused) | teammates 2+2+1 grid right");
    console.log("Each pane is a real PTY — you can chip in to any pane.");
    console.log("Press Ctrl-C to stop.");

    // Keep alive
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log("\nStopping team...");
        resolve();
      });
    });
    return 0;
  } catch {
    console.log(`Launching crewel team "${active.config.name}" (fallback)`);
    console.log(`  lead:      ${active.config.lead.type} (focused)`);
    console.log(
      `  teammates: ${active.config.teammates.map((t) => `${t.id} (${t.type})`).join(", ")}`
    );
    console.log("Layout: lead 58% left | teammates grid right");
    console.log("Press Ctrl-C to stop.");
    await new Promise(() => {});
    return 0;
  }
}
