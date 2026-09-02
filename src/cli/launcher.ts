/* eslint-disable @typescript-eslint/no-explicit-any */
import { CrewelError } from "../core/errors.js";
import { loadAllTeams } from "../core/team/store.js";
import { worktreePathFor } from "../core/worktrees/index.js";
import { runTeammateTurn } from "../core/engine/index.js";

const isBun = typeof (process as any).versions?.bun === "string";

type PtyHandle = {
  onData: (cb: (data: string) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  pid?: number;
};

async function createPty(
  file: string,
  args: string[],
  opts: { cols: number; rows: number; cwd: string; env: Record<string, string> }
): Promise<PtyHandle> {
  if (isBun) {
    // Bun native pty (Bun.spawn with pty) — avoids node-pty NAPI issues on Bun
    // Bun 1.3.5+ supports pty: https://bun.com/blog/bun-v1.3.5
    const proc: any = (Bun as any).spawn([file, ...args], {
      pty: { cols: opts.cols, rows: opts.rows },
      cwd: opts.cwd,
      env: opts.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let onDataCb: (data: string) => void = () => {};
    // Pipe stdout -> onData
    (async () => {
      const reader =
        proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) onDataCb(decoder.decode(value));
        }
      } catch {}
    })();
    // Also pipe stderr to same handler for banner visibility
    (async () => {
      try {
        const reader =
          proc.stderr.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) onDataCb(decoder.decode(value));
        }
      } catch {}
    })();

    return {
      onData: (cb) => {
        onDataCb = cb;
      },
      write: (data: string) => {
        try {
          proc.stdin.write(data);
        } catch {}
      },
      resize: (cols: number, rows: number) => {
        try {
          // Bun's pty proc may expose resize via proc.resize or pty object
          if (typeof proc.resize === "function") proc.resize(cols, rows);
        } catch {}
      },
      kill: () => {
        try {
          proc.kill();
        } catch {}
      },
      pid: proc.pid,
    };
  } else {
    const pty = await import("node-pty");
    const p = (pty as any).spawn(file, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
    });
    return {
      onData: (cb) => p.onData(cb),
      write: (data) => p.write(data),
      resize: (cols, rows) => p.resize(cols, rows),
      kill: () => p.kill(),
      pid: p.pid,
    };
  }
}

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

  // Pre-flight for OpenTUI runtime
  if (!isBun) {
    const major = parseInt(process.versions.node.split(".")[0]!, 10);
    let hasFfi = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:ffi");
      hasFfi = true;
    } catch {}
    if (major < 26 || !hasFfi) {
      console.error(
        `TUI needs Bun >=1.3.0 or Node >=26.4 with --experimental-ffi --allow-ffi (you have Node ${process.versions.node}).`
      );
      console.error(
        "Falling back to console — run with: bunx crewel  or  node --experimental-ffi --allow-ffi dist/cli.js"
      );
    }
  }

  // Early signal handlers — must be before createCliRenderer so we capture SIGINT even if OpenTUI handles it
  let tuiCleanup: (() => void) | null = null;
  const earlySigHandler = () => {
    if (tuiCleanup) tuiCleanup();
  };
  process.on("SIGINT", earlySigHandler);
  process.on("SIGTERM", earlySigHandler);

  try {
    const { createCliRenderer } = await import("@opentui/core");
    const { BoxRenderable, TextRenderable, EmbeddedTerminalRenderable } =
      await import("@opentui/core");

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
    const ptys: PtyHandle[] = [];

    const spawnForPane = async (
      term: InstanceType<typeof EmbeddedTerminalRenderable>,
      title: string,
      cwd: string,
      cols: number,
      rows: number
    ) => {
      const p = await createPty(shell, [], {
        cols,
        rows,
        cwd,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
      (term as any).onData = (data: string) =>
        p.write(data as unknown as string);
      (term as any).onTerminalResize = (cols: number, rows: number) =>
        p.resize(cols, rows);
      p.onData((data) => (term as any).write(data));
      // Initial banner
      p.write(`\r\n\x1b[1m${title}\x1b[0m — ${cwd}\r\n`);
      return p;
    };

    // Lead pane — runs the lead REPL (user's only input)
    const leadPty = await (async () => {
      const p = await createPty(
        process.execPath,
        [leadScript, repoRoot, active.config.name],
        {
          cols: 80,
          rows: 24,
          cwd: leadCwd,
          env: {
            ...(process.env as Record<string, string>),
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        }
      );
      (leadTerm as any).onData = (data: string) =>
        p.write(data as unknown as string);
      (leadTerm as any).onTerminalResize = (cols: number, rows: number) =>
        p.resize(cols, rows);
      p.onData((data) => (leadTerm as any).write(data));
      p.write(
        `\r\n\x1b[1mLEAD ${active.config.lead.type}\x1b[0m — ${leadCwd}\r\n`
      );
      return p;
    })();
    ptys.push(leadPty);
    (leadTerm as any).focus();

    // Teammate panes — each in its isolated worktree (provisioned now so shell cwd is correct)
    // Each pane now runs its model loop, not just an idle shell
    const { existsSync } = await import("node:fs");
    const { ensureTeammateWorktree } =
      await import("../core/worktrees/index.js");
    for (let idx = 0; idx < teammates.length; idx++) {
      const m = teammates[idx]!;
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
      // Ensure worktree exists so pane cwd is isolated (was lazy-only on first tick)
      try {
        await ensureTeammateWorktree({
          repoRoot,
          team: active.config.name,
          participantId: m.id,
        });
      } catch {}
      const wt = worktreePathFor(repoRoot, active.config.name, m.id);
      const cwd = existsSync(wt) ? wt : repoRoot;
      const p = await spawnForPane(
        term as any,
        `${m.id} (${m.type})`,
        cwd,
        80,
        12
      );
      ptys.push(p);

      // Agent loop — per-model, visible in its pane (push-driven via fs.watch + polling fallback)
      const teamNameForLoop = active.config.name;
      const participantId = m.id;
      const participantType = m.type;
      // banner for model
      (term as any).write(
        `\r\n\x1b[2m[${participantId}] ${participantType}${participantType !== m.type || (m as any).model ? `:${(m as any).model ?? ""}` : ""} — watching for tickets…\x1b[0m\r\n`
      );
      (term as any).write(`\r\n\x1b[2m  worktree: ${wt}\x1b[0m\r\n`);
      void (async () => {
        const { watchTeam } = await import("../core/notifications/index.js");
        let trigger: (() => void) | null = null;
        let watcher: Awaited<ReturnType<typeof watchTeam>> | null = null;
        try {
          watcher = await watchTeam(
            { repoRoot, team: teamNameForLoop },
            (event) => {
              if (
                event.source === "mail" &&
                (event as any).participant === participantId
              ) {
                if (trigger) trigger();
              } else if (event.source === "tickets") {
                if (trigger) trigger();
              }
            }
          );
        } catch {}
        while (true) {
          try {
            const result = await runTeammateTurn({
              repoRoot,
              team: teamNameForLoop,
              participantId,
            });
            if (result.ran) {
              const tickets = result.ticketIds.join(", ") || "—";
              const status = result.reportStatus
                ? ` (${result.reportStatus})`
                : "";
              (term as any).write(
                `\r\n\x1b[33m[${participantId} ${participantType}] ${result.outcome}${status} — ${tickets}\x1b[0m\r\n`
              );
            } else if (result.reason && result.reason !== "nothing-due") {
              (term as any).write(
                `\r\n\x1b[2m[${participantId}] ${result.reason}\x1b[0m\r\n`
              );
            }
          } catch (e) {
            (term as any).write(
              `\r\n\x1b[31m[${participantId}] error: ${(e as Error).message}\x1b[0m\r\n`
            );
          }
          // wait for push event or polling fallback (3.5s)
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };
            trigger = finish;
            setTimeout(finish, 3500);
          });
        }
        // cleanup watcher on exit (unreachable, but for completeness)
        try {
          await watcher?.stop();
        } catch {}
      })();
    }

    // Focus handling — Tab cycles, Ctrl+A toggles
    let focusedIdx = 0;
    const focusIdx = (idx: number) => {
      allTerms.forEach((t, i) => {
        if (i === idx) (t as any).focus();
        else (t as any).blur();
      });
      focusedIdx = idx;
    };
    (renderer as any).keyInput?.on?.("keypress", (key: any) => {
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

    // Keep alive until Ctrl-C / SIGINT / SIGTERM — TUI owns the terminal
    // In raw mode Ctrl-C is handled by OpenTUI's exitOnCtrlC (destroy), not SIGINT
    await new Promise<void>(() => {
      const cleanup = (src: string) => {
        try {
          console.error(`\n[crewel] exit via ${src}`);
        } catch {}
        ptys.forEach((p) => {
          try {
            p.kill();
          } catch {}
        });
        try {
          (renderer as any).destroy?.();
        } catch {}
        try {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
        } catch {}
        try {
          process.stdin.pause();
          process.stdin.removeAllListeners("data");
          process.stdin.removeAllListeners("keypress");
        } catch {}
        process.exit(0);
      };
      // register for early signals (already have earlySigHandler, but also register here for completeness)
      tuiCleanup = () => cleanup("SIGINT/SIGTERM");
      process.on("SIGINT", () => cleanup("SIGINT"));
      process.on("SIGTERM", () => cleanup("SIGTERM"));
      try {
        process.stdin.on("data", (data: Buffer) => {
          if (data.toString().includes("\x03")) cleanup("data-\\x03");
        });
      } catch {}
      try {
        (renderer as any).keyInput?.on?.("keypress", (key: any) => {
          if (key.ctrl && key.name === "c") cleanup("keyInput-ctrl-c");
        });
      } catch {}
      try {
        (renderer as any).on?.("destroy", () => cleanup("renderer-destroy"));
        (renderer as any).once?.("destroy", () =>
          cleanup("renderer-destroy-once")
        );
      } catch {}
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
    // Keep event loop alive until SIGINT — stdin resume alone isn't enough in all runtimes
    try {
      process.stdin.resume();
      // ensure stdin has a handler so resume actually holds the loop
      process.stdin.on("data", () => {});
    } catch {}
    const keepAlive = setInterval(() => {}, 1000);
    await new Promise<void>((resolve) => {
      const done = () => {
        try {
          clearInterval(keepAlive);
        } catch {}
        try {
          process.stdin.pause();
          process.stdin.removeAllListeners("data");
        } catch {}
        resolve();
      };
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
      try {
        process.stdin.on("data", (data: Buffer) => {
          if (data.toString().includes("\x03")) done();
        });
      } catch {}
    });
    return 0;
  }
}
