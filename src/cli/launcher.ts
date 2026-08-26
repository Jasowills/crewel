/* eslint-disable @typescript-eslint/no-explicit-any */
import { CrewelError } from "../core/errors.js";
import { loadAllTeams } from "../core/team/store.js";
import { worktreePathFor } from "../core/worktrees/index.js";

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

  try {
    const { createCliRenderer } = await import("@opentui/core");
    const { BoxRenderable, TextRenderable, EmbeddedTerminalRenderable } =
      await import("@opentui/core");
    const pty = await import("node-pty");

    const renderer = await createCliRenderer();
    const root = (
      renderer as unknown as { root: InstanceType<typeof BoxRenderable> }
    ).root;
    root.flexDirection = "row";

    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/zsh";

    const leadCwd = repoRoot;
    const leadBox = new BoxRenderable(renderer as any, {
      flexGrow: 1.6,
      width: "58%",
      border: true,
      borderColor: "cyan",
      title: `♦ LEAD — ${active.config.lead.type} — focused`,
    });
    const leadTerm = new EmbeddedTerminalRenderable(renderer as any, {
      flexGrow: 1,
    });
    leadBox.add(leadTerm);
    root.add(leadBox);

    // Lead REPL — the only place the user types requests
    const leadScript = new URL("./lead-repl.js", import.meta.url).pathname;

    const right = new BoxRenderable(renderer as any, {
      flexDirection: "column",
      flexGrow: 1,
      width: "42%",
      gap: 1,
    });
    root.add(right);

    const teammates = active.config.teammates;
    // Build 3 rows: 2+2+1 for 5 teammates, flexible for other counts
    const rows: InstanceType<typeof BoxRenderable>[] = [];
    for (let i = 0; i < 3; i++) {
      const row = new BoxRenderable(renderer as any, {
        flexDirection: "row",
        flexGrow: 1,
        gap: 1,
      });
      right.add(row);
      rows.push(row);
    }

    const allTerms: InstanceType<typeof EmbeddedTerminalRenderable>[] = [
      leadTerm,
    ];
    const ptys: ReturnType<typeof pty.spawn>[] = [];

    const spawnForPane = (
      term: InstanceType<typeof EmbeddedTerminalRenderable>,
      title: string,
      cwd: string,
      cols: number,
      rows: number
    ) => {
      const p = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
      term.onData = (data) => p.write(data as unknown as string);
      term.onTerminalResize = (cols, rows) => p.resize(cols, rows);
      p.onData((data) => term.write(data));
      // Initial banner
      p.write(`\r\n\x1b[1m${title}\x1b[0m — ${cwd}\r\n`);
      return p;
    };

    // Lead pane — runs the lead REPL (user's only input)
    const leadPty = (() => {
      const p = pty.spawn("node", [leadScript, repoRoot, active.config.name], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: leadCwd,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
      leadTerm.onData = (data) => p.write(data as unknown as string);
      leadTerm.onTerminalResize = (cols, rows) => p.resize(cols, rows);
      p.onData((data) => leadTerm.write(data));
      p.write(
        `\r\n\x1b[1mLEAD ${active.config.lead.type}\x1b[0m — ${leadCwd}\r\n`
      );
      return p;
    })();
    ptys.push(leadPty);
    leadTerm.focus();

    // Teammate panes — each in its isolated worktree (fallback to repoRoot if not yet provisioned)
    const { existsSync } = await import("node:fs");
    teammates.forEach((m, idx) => {
      const row = rows[Math.floor(idx / 2)] ?? rows[2]!;
      const box = new BoxRenderable(renderer as any, {
        flexGrow: 1,
        border: true,
        title: ` ${m.id} (${m.type}) `,
      });
      const term = new EmbeddedTerminalRenderable(renderer as any, {
        flexGrow: 1,
      });
      box.add(term);
      row.add(box);
      allTerms.push(term);
      const wt = worktreePathFor(repoRoot, active.config.name, m.id);
      const cwd = existsSync(wt) ? wt : repoRoot;
      const p = spawnForPane(term, `${m.id}`, cwd, 80, 12);
      ptys.push(p);
    });

    // Focus handling — Tab cycles, Ctrl+A toggles
    let focusedIdx = 0;
    const focusIdx = (idx: number) => {
      allTerms.forEach((t, i) => {
        if (i === idx) t.focus();
        else t.blur();
      });
      focusedIdx = idx;
    };
    renderer.keyInput?.on?.("keypress", (key: any) => {
      if (key.ctrl && key.name === "a") {
        focusIdx((focusedIdx + 1) % allTerms.length);
      }
    });

    // Status bar
    const status = new TextRenderable(renderer as any, {
      content: ` crewel — ${active.config.name} — ${active.config.teammates.length + 1} panes — Ctrl+A to switch — Ctrl-C to stop `,
      height: 1,
    });
    root.add(status);

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        ptys.forEach((p) => {
          try {
            p.kill();
          } catch {}
        });
        try {
          (renderer as any).destroy?.();
        } catch {}
        resolve();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    });
    return 0;
  } catch (e) {
    console.error(
      "TUI launch failed, falling back to console:",
      (e as Error).message
    );
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
