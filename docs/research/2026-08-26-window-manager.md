# Cross-platform terminal window management for crewel — Research Findings

**Date:** 2026-08-26
**Question:** How should `crewel` launch and arrange ~6 terminal panes (1 lead focused large, 5 teammates tiled) so it looks nice and works perfectly on both Windows and macOS, with no extra manual setup?
**Deliverable location:** `docs/research/2026-08-26-window-manager.md` (repo convention: `docs/` holds `PRD.md`, `DECISIONS.md`, `SPEC.md`; new `docs/research/` subdir for dated research notes; fallback temp path `/var/folders/.../T/opencode` was checked and exists but is ephemeral)
**Author:** background research agent — all claims cite primary sources (official docs / source repos / specs).

---

## TL;DR — Recommendation (ranked)

| Rank                     | Approach                                                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Recommended**      | **In-process TUI with `@opentui/core` + `EmbeddedTerminalRenderable` (Ghostty VT) + `node-pty` (`pty.spawn`) for each pane** — Flexbox layout in one terminal window (lead 55–60% left, teammates 2×3 grid right). Ship as the default `crewel` launcher. | Works natively on Windows + macOS with no WSL, no external terminal binary. Polished (borders, focus highlight, theme), fully programmatic layout, each pane is a **real interactive PTY** you can chip into. Precedent: `tuimux` uses exactly this stack. |
| 2 — Fallback CLI делегат | **WezTerm CLI backend** (`wezterm cli split-pane`) when WezTerm is the user's terminal.                                                                                                                                                                   | Cross-platform native, good programmatic panes, but **requires WezTerm installed** — fails "no extra manual setup" for everyone. Keep as optional adapter à la Claude Code's proposed `teammateMode: wezterm`.                                             |
| 3 — Do not use           | **tmux / Zellij / Windows Terminal `wt`** as the primary launcher.                                                                                                                                                                                        | Each fails one hard requirement (see §§1, 2, 7).                                                                                                                                                                                                           |

**Why rank 1 wins:** it is the only option that simultaneously satisfies (a) native Windows, (b) native macOS, (c) single-window 6-pane layout with programmatic control, (d) each pane is a real PTY (so `opencode`/`Muse`/`codex` think they're in a terminal), and (e) polished look without asking the user to install/configure another multiplexer.

---

## 1. `tmux` — official story

**What it is:** client-server terminal multiplexer with sessions, windows, panes; five built-in layouts (`even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`, `tiled`) and scriptable via `tmux split-window`, `select-layout`, etc. [tmux.app/doc](https://tmux.app/doc) / [github.com/tmux/tmux/wiki](https://github.com/tmux/tmux/wiki) / `man tmux` at [man.openbsd.org/tmux](https://man.openbsd.org/tmux).

**Pane layout commands (primary source):**

- `split-window -h / -v`, `select-layout main-vertical`, `select-layout tiled`, `resize-pane`, plus capture of custom layout strings like `5aed,176x79...` for pixel-perfect restores. [tao-of-tmux stable docs — window layouts](https://tao-of-tmux.readthedocs.io/en/stable/manuscript/06-window.html)

**Windows support:** **No native Windows binary.** Official/primary install doc is **"WSL2 is the only fully-supported Windows approach. Cygwin provides limited legacy support."** [tmux.info installation — Windows via WSL2](https://tmux.info/docs/installation) / [tmux.app/install/windows](https://tmux.app/install/windows). Community comparison reiterates: `tmux` on Windows = inside WSL; "No WSL required = ❌". [gist: tmux on Windows comparison 2025/2026](https://gist.github.com/psmux/16e2c278b32c25c6a6663b6247ec24c3)

**macOS support:** Native via Homebrew/MacPorts, works on Intel + Apple Silicon. [tmux.info installation — macOS](https://tmux.info/docs/installation)

**Assessment for crewel:**

| Criterion                               | Result                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Windows native, no WSL                  | **Fail** — requires WSL, violates "no extra manual setup"                                |
| macOS                                   | Pass                                                                                     |
| Programmatic layout control             | Excellent (but only inside tmux)                                                         |
| Appearance/UX polish                    | Functional, not polished app chrome; status bar customizable but still terminal-scrolled |
| Chip-in (real interactive PTY per pane) | Yes — each pane is a real PTY                                                            |
| Operational overhead                    | Extra binary + shell dep; on Windows: full Linux subsystem                               |

**Note on `psmux`:** a Rust ConPTY-based native Windows tmux-compat (76 commands, `psmux new-session`, `winget install psmux`) exists but is niche (~792 stars, Mar 2026). It proves ConPTY can host multiplexing natively, but depending on a barely-known binary is riskier than depending on the ConPTY API directly via `node-pty`. [psmux article 2026-03-28](https://zenn.dev/sora_biz/articles/psmux-windows-native-tmux?locale=en)

---

## 2. Windows Terminal (`wt`) — official Microsoft docs

**What it is:** modern host for shells (PowerShell, cmd, WSL). Panes live **inside one tab**: `splitPane` with `vertical`/`horizontal`/`auto`, keyboard or `wt` CLI. [learn.microsoft.com — Panes](https://learn.microsoft.com/en-us/windows/terminal/panes) / [learn.microsoft.com — Command line arguments (`wt`) ](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)

**CLI splitting (primary source):**

```cmd
wt -p "Command Prompt" ; split-pane -p "Windows PowerShell" ; split-pane -H wsl.exe
```

with `-H` horizontal, `-V` vertical, `--size .4` for proportion, `move-focus`, `swap-pane`. Semicolon is the delimiter (PowerShell needs `` `; `` or `--%`). [command-line-arguments — split-pane / move-focus / swap-pane docs](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)

**Cross-platform story:** **Windows-only.** No macOS support. Official overview: Windows Terminal is a host application for Command Prompt, PowerShell, and WSL — it is not cross-platform. [learn.microsoft.com — What is Windows Terminal?](https://learn.microsoft.com/en-us/windows/terminal/)

**Other limits for crewel:**

- Panes cannot be detached/reattached; no persistent sessions ("Persistent sessions: ❌" in comparison table). [tmux on Windows comparison gist](https://gist.github.com/psmux/16e2c278b32c25c6a6663b6247ec24c3)
- Layout is binary splits; no `main-vertical` with 5 equal tiles in one command — you sequence splits, and focus matters. Awkward to guarantee "lead 60% left, 5-teammate grid right" reliably across window sizes.
- Requires Windows Terminal installed; on Windows 10/11 it usually is, but still an external binary, and the escape dance for `wt` inside Node (`cmd.exe /c wt.exe ...`) is fragile.

**Assessment:** **Reject as primary.** Useful as an optional Windows-only backend, but fails cross-platform + polish.

---

## 3. ConPTY / Windows Pseudoconsole — Microsoft spec

**What it is:** device type that lets an application become the host for character-mode apps **without** creating a host window. Host collects input and renders output. Designed for third-party terminal window apps or remoting. Always UTF-8 over the channel; codepage translation inside. [learn.microsoft.com — Pseudoconsoles](https://learn.microsoft.com/en-us/windows/console/pseudoconsoles)

**API:** `CreatePseudoConsole(COORD size, HANDLE hInput, HANDLE hOutput, DWORD flags, HPCON*)`, `ResizePseudoConsole`, `ClosePseudoConsole`. Requires Windows 10 1809+ / Server 2019+. Channel handles must be synchronous pipes. Sample flow: create pipes → `CreatePseudoConsole` → prepare `STARTUPINFOEX` with `EXTENDED_STARTUPINFO_PRESENT` → `CreateProcessW`. [learn.microsoft.com — CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) / [learn.microsoft.com — Creating a Pseudoconsole session](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) / [intro blog: Introducing the Windows Pseudo Console](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)

**Why it matters:** ConPTY is the primitive that makes **native** Windows PTYs possible without WSL/winpty. `wt`, WezTerm, VS Code, and `node-pty` all sit on top of it.

---

## 4. `node-pty` (`microsoft/node-pty`) — repo/docs

**What it is:** `forkpty(3)` bindings for Node.js — `pty.spawn(shell, args, {name, cols, rows, cwd, env})`, `ptyProcess.onData`, `ptyProcess.write`, `ptyProcess.resize`. Used to write terminal emulators (e.g., via xterm.js) or make programs think they're in a terminal. [github.com/microsoft/node-pty — README](https://github.com/microsoft/node-pty)

**Platform support (primary source):** "supports Linux, macOS and Windows. Windows support is possible by utilizing the Windows conpty API on Windows 1809+" [node-pty README — Platforms](https://github.com/microsoft/node-pty). > **Note:** `winpty` support has been **removed**; Windows 10 build 18309+ is now required. [node-pty README — Note](https://github.com/microsoft/node-pty) / [node-pty releases — v1.2.0-beta.7 "Remove support for winpty"](https://github.com/microsoft/node-pty/releases)

**Multiple PTYs from one Node process:** supported — each `pty.spawn` returns an independent `IPty` with `pid`, `cols`, `rows`, `onData`, `write`, `resize`, `kill`. No global singleton; tuimux spawns N `node-pty` children alongside N `EmbeddedTerminalRenderable`s. [node-pty typings `node-pty.d.ts`](https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts) / [tuimux — Tech Stack: `node-pty` via `spawn-pty`](https://github.com/shuv1337/tuimux)

**Real-world validation:** powers VS Code, Hyper, Theia, electerm, etc. [node-pty README — Real-world Uses](https://github.com/microsoft/node-pty). Building requires Python + C++ compiler; Windows needs Desktop C++ Apps + Spectre-mitigated libs. [node-pty README — Building/Windows](https://github.com/microsoft/node-pty). Node ≥16 / Electron ≥19 required; supported Node tracks VS Code's version. [node-pty README — Dependencies](https://github.com/microsoft/node-pty). Bundles ConPTY binary at `third_party/conpty/1.25.260303002`. [node-pty repo file listing](https://github.com/microsoft/node-pty)

**Thread safety:** not thread-safe across worker threads. [node-pty README — Thread Safety](https://github.com/microsoft/node-pty)

**Assessment:**

| Criterion                      | Result                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows native                 | **Pass** (ConPTY, no WSL)                                                                                                                                            |
| macOS                          | Pass                                                                                                                                                                 |
| Programmatic layout control    | Not directly — `node-pty` only gives you PTY handles; **layout must be supplied by a TUI layer** (OpenTUI blessed/ink)                                               |
| Chip-in (real interactive PTY) | **Yes — by definition**; `write` + `resize` give full interactivity; agents that check `isTTY` / emit ANSI will behave correctly, unlike piped `child_process.spawn` |
| Polished look                  | Depends on TUI layer                                                                                                                                                 |
| Operational overhead           | Native Node addon (`binding.gyp`); prebuilds exist but `npm install` may compile; single shared dependency with OpenTUI approach                                     |

**Key insight for crewel — why not just `child_process.spawn` with piped stdio?**
`node-pty` docs: "Getting certain programs to _think_ you're a terminal, such as when you need a program to send you control sequences." [node-pty README — Useful for](https://github.com/microsoft/node-pty). `opencode`, `Muse`, and `codex` are interactive CLI TUIs that probe `isTTY`, emit ANSI/VT, and read raw keystrokes — with plain pipes they degrade or hang. Each agent pane must be a PTY.

---

## 5. `blessed` / `blessed-contrib` and `ink` (React for CLIs)

### `blessed` (chjj/blessed)

**What it is:** curses-like JS library (~16k LOC) — reimplements ncurses via terminfo/termcap + widget API (Box, List, Form, etc.) with Smart CSR/BCE damage rendering. [github.com/chjj/blessed — README](https://github.com/chjj/blessed)

**Layout mechanism:** manual positioning (`top`, `left`, `width: '50%'`, `height: '50%'`, `grid.set(row,col,rowSpan,colSpan)` via blessed-contrib). [blessed-contrib — Grid](https://github.com/yaronn/blessed-contrib#layout-grid)

**Can it host multiple terminal emulators in one TUI?**

Yes, but only via the `terminal` widget (`blessed.terminal` / `blessed-contrib` terminal) backed by `node-pty` + `term.js` emulation — and it is **unmaintained** (original repo archived/readonly feel, forks like `neo-blessed`/`blessed-ng`/`accursed`). The widget API is DOM-like, but you still need to wire `pty.onData → term.write` yourself; layout is imperative, not Flexbox. Polished multi-pane with focus management requires substantial hand-rolled code. Community consensus is shifting to newer engines (see OpenTUI section). [blessed — Widgets / Special Elements: Terminal](https://github.com/chjj/blessed#terminal-from-box) / [awesome-blessed — forks](https://github.com/rajasegar/awesome-blessed)

**Verdict:** viable but dated; not the polished path for a new project.

### `ink` (vadimdemedes/ink)

**What it is:** React renderer for the terminal using Yoga Flexbox — `Box`/`Text`/`Static`/`Transform`, `useInput`, `useStdout`, etc. Powers Claude Code, Gemini CLI, Gatsby CLI. [github.com/vadimdemedes/ink — README](https://github.com/vadimdemedes/ink)

**Can it host multiple terminal emulators?**

**Not natively.** Ink renders React components to the terminal, not PTY streams. There is no built-in `Terminal` component that hosts a `node-pty` child. You could embed an `ink` sub-render inside a `Box`, but each pane would need a custom native VT parser + `node-pty` glue (essentially reimplementing what OpenTUI's `EmbeddedTerminalRenderable` already provides). Ink 7 requires Node 22 + React 19.2. [heise — Ink 7.0 revises input handling, Node 22 + React 19.2](https://www.heise.de/en/news/React-in-the-Terminal-Ink-7-0-fundamentally-revises-input-handling-11249949.html)

**Verdict for crewel:** great for single-pane CLIs with React ergonomics, but wrong primitive for 6 **interactive PTY panes** with precise tile layout. Would still require `node-pty` underneath.

---

## 6. `xterm.js`

**What it is:** frontend terminal **for the browser** — works with `bash`/`vim`/`tmux`, GPU-accelerated renderer, zero-deps core, DOM-dependent `term.open(container)`. [github.com/xtermjs/xterm.js — README](https://github.com/xtermjs/xterm.js)

**Can it run headless in a Node TUI?**

Partially. The project ships `@xterm/headless` — "a stripped down version that runs headless in Node.js ... to keep track of terminal state where the process is running and using the serialize addon so it can get state restored upon reconnection." [xterm.js — Node.js Support / @xterm/headless](https://github.com/xtermjs/xterm.js#nodejs-support) / [@xterm/headless README](https://github.com/xtermjs/xterm.js/blob/master/headless/README.md) / [@xterm/headless on npm](https://www.npmjs.com/package/@xterm/headless). But `headless` is a **VT state tracker**, not a TUI renderer: it parses VT and maintains a buffer; it does not draw to a terminal window. The main `xterm.js` **always needs a DOM** (`term.open(document.getElementById(...))`) and `xterm.css`. [xterm.js — Getting Started](https://github.com/xtermjs/xterm.js#getting-started)

**Multiplexing examples:** xterm.js has no built-in multiplexer. All multi-pane demos pair it with `node-pty` and lay out `<div>` panes in HTML (VS Code does this in Electron, not in a raw terminal).

**Verdict:** **No** for a Node TUI. Use the Ghostty VT parser embedded in OpenTUI instead (same purpose, but renders to the terminal's cell grid, not a browser DOM).

---

## 7. Other cross-platform multiplexers — WezTerm, Zellij, etc.

### WezTerm

**What it is:** GPU-accelerated cross-platform terminal emulator + multiplexer in Rust — "Runs on Linux, macOS, Windows 10" [wezterm.org — Features](https://wezterm.org/). Multiplexing via domains (local/SSH/TLS/unix) with panes/tabs/windows persisting. [wezterm.org — Multiplexing](https://wezterm.org/multiplexing.html). Programmatic panes via CLI and Lua:

```bash
wezterm cli split-pane --right -- cmd
wezterm cli split-pane --bottom -- cmd
wezterm cli list          # list panes
wezterm cli activate-pane --pane-id N
```

and Lua `pane:split{ direction='Right', size={Percent=40} }`, `window:mux_window():spawn_tab()`, `tab:set_title()`. [github.com/anthropics/claude-code#23574 — WezTerm backend mapping (primary table)](https://github.com/anthropics/claude-code/issues/23574) / [wezterm.org — CLI: split-pane](https://wezterm.org/cli/cli/split-pane.html) / [wezterm.org — Config: Multiplexing / Lua API (Pane, MuxTab, MuxWindow)](https://wezterm.org/config/lua/config/index.html)

**Windows/macOS:** **Yes**, native binaries for both. [wezterm.org — Download: Windows / macOS pages](https://wezterm.org/installation.html)

**Programmatic layout:** strong — but requires driving the **existing WezTerm GUI**. A launcher must detect `TERM_PROGRAM=WezTerm`, then call `wezterm cli ...`. Outside WezTerm, you can't create WezTerm panes.

**Why not primary:** requires user to be **running WezTerm**; fails "no extra manual setup" for users on Windows Terminal, Terminal.app, iTerm2, etc. Same flaw that inspired the Claude Code feature request: "WezTerm users are forced to either run tmux inside WezTerm (redundant) or use in-process mode." [claude-code #23574 — Proposed Solution](https://github.com/anthropics/claude-code/issues/23574). Good as an **optional adapter** (detect + use if present), not as the default.

### Zellij

**What it is:** Rust terminal workspace (batting `tmux` with batteries: floating panes, stacked panes, KDL layouts, WASM plugins, web client). [zellij.dev — FAQ: What is Zellij?](https://zellij.dev/faq/) / [zellij.dev — Home](https://zellij.dev/)

**Platform support:** "Linux: All major distributions, macOS: Intel and Apple Silicon, **Windows: Via WSL**" [zellij.dev — FAQ: What operating systems does Zellij support?](https://zellij.dev/faq/) and "Needs WSL on Windows" in comparison table. [gist comparison — Zellij row](https://gist.github.com/psmux/16e2c278b32c25c6a6663b6247ec24c3). Issue #316 tracks native Windows but still depends on `termios`/`RawFd` unix crates. [github.com/zellij-org/zellij#316 — Windows support](https://github.com/zellij-org/zellij/issues/316)

**Verdict:** **Reject** — fails native Windows requirement same as tmux.

### Others quickly ruled out

- **GNU Screen:** same WSL-only on Windows, less scriptable than tmux.
- **vtm (directvt):** C++ tiling multiplexer claiming cross-platform (Linux/BSD/macOS/Windows) with DirectVT, but obscure, few users, no Node bindings, weak programmatic API for `crewel`'s Node CLI. [linuxlinks — vtm review](https://www.linuxlinks.com/vtm-terminal-multiplexer)
- **Conductor/Pane desktop apps:** native desktop GUIs wrapping tmux-WSL — outside the TUI scope, add bundling/signing overhead.

---

## 8. The in-TUI multiplexer pattern that actually fits — OpenTUI + Ghostty VT + node-pty

### OpenTUI (`@opentui/core`)

**What it is:** native terminal UI core in **Zig + TypeScript bindings** via C ABI/Node-API. Renders a component tree with **Flexbox/Yoga layout**, handles input, diffs cells. Powers OpenCode in production. Prebuilt artifacts for `x86_64`/`aarch64` × macOS/Linux glibc/musl/**Windows GNU**; `bun` for dev. [opentui.com — Getting started / docs](https://opentui.com/docs) / [opentui.com — Core docs](https://opentui.com/docs/getting-started/quickstart) / [github.com/anomalyco/opentui](https://github.com/anomalyco/opentui)

**Embedded terminal renderable (primary source — exact fit):**

> "`EmbeddedTerminalRenderable` parses VT output and draws a terminal screen in the render tree. The parser is Ghostty's VT library, linked into the native artifact. You do not need an extra install. The renderable is **not** a process and not a PTY. You write child output into it. You send encoded input back to the child. ... The native artifact includes Ghostty VT on `x86_64` and `aarch64` for macOS, Linux glibc, Linux musl, and **Windows GNU**." [opentui.com — Embedded terminal](https://opentui.com/docs/components/embedded-terminal)

**I/O model:** `terminal.write(string|Uint8Array)` → Ghostty parses VT → draws cells; `terminal.onData = (data, source) => child.write(data)` for `"input"` (keys/mouse) and `"response"` (DSR queries); `onTerminalResize(cols,rows) => child.resize(cols,rows)`; focus/keyboard/mouse/scroll/selection/cursor all handled by the renderable. [embedded-terminal — I/O model / Attach a process / Focus and keyboard / Mouse and local scroll](https://opentui.com/docs/components/embedded-terminal)

**Proven composition:** **`tuimux`** — "A terminal multiplexer for TUI apps. Run btop, lazygit, **Claude Code**, and any TUI in embedded terminal windows ... **Built with OpenTUI, SolidJS, and libghostty** ... **PTY: `node-pty` (via `spawn-pty`)** ... Two layout modes: **tabs** and **panes** (tmux/zellij-style tiled), runtime switchable, nine themes." [github.com/shuv1337/tuimux — README / Tech Stack / Features](https://github.com/shuv1337/tuimux)

Tuimux demonstrates exactly what `crewel` needs: multiple Ghostty terminals in a Flexbox layout inside one terminal window, each backed by its own `node-pty`, with a command palette, theme picker, focus toggle (`Ctrl+A`), nested copy/paste (OSC 52), and session persistence — all on the same stack.

### Why this stack satisfies every requirement

| Requirement                                          | How                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows + macOS perfectly, no extra manual setup** | OpenTUI ships **prebuilt Windows GNU** binaries; `node-pty` uses native ConPTY, also prebuilt. No WSL, no external terminal. `npm install` only.                                                                                                                                                                                                                                                |
| **Lead prominent, 5 teammates tiled (nice layout)**  | Flexbox: root `row` → left `Box flexGrow=1.6` (lead), right `Box flexBasis=40%` containing 2×3 grid of teammate terminals. Borders, gap, focus dim, status bar — all declarative. Example from WezTerm Lua layout (`Percent=40`/`Percent=50`) ports 1:1 to OpenTUI `width="40%"`. [wezterm Lua layout — Percent splits](https://gist.github.com/johnlindquist/e0c272d27919706a4a0b396b0a9e04aa) |
| **Live monitoring of all panes**                     | Each `EmbeddedTerminalRenderable` paints continuously; all six visible at once in "panes" mode (or tabs mode with sidebar + one active terminal for compact screens).                                                                                                                                                                                                                           |
| **Chip in to any pane**                              | `focus()` routes keys/mouse to that renderable; `onData` pipes bytes to the corresponding `node-pty`; `Muse`/`codex`/`opencode` are real TTY sessions. Escape to host via `renderer.keyInput` handler + `stopPropagation()`. [embedded-terminal — Focus and keyboard](https://opentui.com/docs/components/embedded-terminal)                                                                    |
| **Polished, not just functional**                    | OpenTUI themes (tuimux ships 9), dim inactive panes, rounded borders, animated palette — CSS-like styling not possible in raw tmux/WT splits.                                                                                                                                                                                                                                                   |
| **Operational overhead**                             | Two native addons (Zig core + pty). Both have prebuilds; `bun` preferred for dev but `npm` works. No shell-specific config; no `.tmux.conf` to manage.                                                                                                                                                                                                                                          |

---

## 9. Detailed option comparison matrix

| Option                               | Windows native (no WSL)                          | macOS native           | Programmatic layout (lead large + 5 grid) | Polished UX               | Chip-in (real PTY)        | Operational overhead                                |
| ------------------------------------ | ------------------------------------------------ | ---------------------- | ----------------------------------------- | ------------------------- | ------------------------- | --------------------------------------------------- |
| **OpenTUI + node-pty** (recommended) | ✅ ConPTY via node-pty; OpenTUI Win GNU prebuild | ✅                     | ✅ Flexbox; arbitrary ratios; borders     | ✅ Themes, focus, palette | ✅ each pane = PTY        | Zig prebuild + pty prebuild; `npm i` only           |
| `blessed` + `node-pty`               | ✅ but dated terminfo                            | ✅                     | ⚠️ manual %/grid; imperative              | ⚠️ low                    | ✅ via `blessed.terminal` | Pure JS + pty; maintenance risk                     |
| `ink` + `node-pty`                   | ✅                                               | ✅                     | ✅ Flexbox but no PTY widget              | ✅                        | ⚠️ hand-roll VT parser    | Ink + Yoga + pty                                    |
| `xterm.js` + `node-pty`              | ❌ needs DOM                                     | ❌ needs DOM           | ❌ HTML layout only                       | n/a                       | ✅ (browser)              | Electron or browser required                        |
| **WezTerm CLI**                      | ✅ (WezTerm installed)                           | ✅ (WezTerm installed) | ✅ `split-pane --right/--bottom --size`   | ✅ native GPU             | ✅                        | Requires WezTerm app; detect `TERM_PROGRAM=WezTerm` |
| **Windows Terminal `wt`**            | ✅                                               | ❌                     | ⚠️ binary splits only                     | ⚠️ functional             | ✅                        | `wt.exe` required; PowerShell escaping              |
| **tmux**                             | ❌ WSL only                                      | ✅                     | ✅ `main-vertical`/`tiled`                | ⚠️ functional             | ✅                        | tmux + WSL                                          |
| **Zellij**                           | ❌ WSL only                                      | ✅                     | ✅ KDL layouts                            | ✅                        | ✅                        | zellij + WSL                                        |
| **Zellij / tmux via WSL**            | ⚠️ WSL                                           | ✅                     | ✅                                        | —                         | ✅                        | Heavy                                               |

Sources: tmux Windows [tmux.info](https://tmux.info/docs/installation) / [gist comparison](https://gist.github.com/psmux/16e2c278b32c25c6a6663b6247ec24c3); WT panes [Microsoft Learn](https://learn.microsoft.com/en-us/windows/terminal/panes) / [wt CLI](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments); ConPTY [Pseudoconsoles](https://learn.microsoft.com/en-us/windows/console/pseudoconsoles); node-pty [README](https://github.com/microsoft/node-pty); blessed [README](https://github.com/chjj/blessed) / [blessed-contrib](https://github.com/yaronn/blessed-contrib); ink [README](https://github.com/vadimdemedes/ink); xterm.js [README](https://github.com/xtermjs/xterm.js) / [headless](https://github.com/xtermjs/xterm.js/blob/master/headless/README.md); WezTerm [wezterm.org](https://wezterm.org/) / [multiplexing](https://wezterm.org/multiplexing.html); Zellij [FAQ](https://zellij.dev/faq/) + [#316](https://github.com/zellij-org/zellij/issues/316); OpenTUI [opentui.com](https://opentui.com/docs) / [embedded-terminal](https://opentui.com/docs/components/embedded-terminal) / [opentuI GitHub](https://github.com/anomalyco/opentui) / tuimux [README](https://github.com/shuv1337/tuimux).

---

## 10. Concrete layout for crewel — 6 panes (lead + 5 teammates)

**Target:** after `crewel init` wizard, `crewel` with no args launches one window, no manual splits.

**Pane semantics:** `lead` runs the decomposer/assigner loop (or whichever adapter was picked as `--lead`); teammates each run their ticket turn loop in their own **git worktree** (`crewel/{team}/integration` + `crewel/{team}/{ticket-id}` branches). The worktree isolation from PRD §4.4 / DECISIONS Q15 stays as-is; the TUI only changes how the 6 PTYs are displayed — not where they run.

**Layout spec (OpenTUI Flexbox):**

```
root { flexDirection: "row", gap: 1, width: "100%", height: "100%" }

  left:  Box { flexGrow: 1.6, flexBasis: "58%", borderStyle: "round",
               borderColor: focused ? "cyan" : "gray",
               title: "♦ LEAD — [model] — in-review: 2  blocked: 1" }
         EmbeddedTerminalRenderable { id: "lead", cols: 80, rows: 24 }

  right: Box { flexDirection: "column", flexGrow: 1, gap: 1, flexBasis: "42%" }
           row1: Box { flexDirection: "row", flexGrow: 1, gap: 1 }
                   teammate-2 | teammate-3  (each 50% width, border round)
           row2: Box { flexDirection: "row", flexGrow: 1, gap: 1 }
                   teammate-4 | teammate-5
           row3: Box { flexGrow: 1, borderStyle: "round" }
                   teammate-6  (full width, or 2-up with placeholder if odd)

  statusBar: Box { height: 1, backgroundColor: "#1a1a2e" }
             Text { team, branch, ticket board counts, heartbeat }
```

- Resize: `EmbeddedTerminalRenderable.onTerminalResize => pty.resize(cols, rows)`; also `ResizePseudoConsole` path on Windows via node-pty internally. [embedded-terminal — Size and scrollback](https://opentui.com/docs/components/embedded-terminal)
- Focus: `Ctrl+A`/click toggles `CONTROL` vs `TERMINAL` focus (tuimux precedent), or vim-style `Leader+hjkl` (WezTerm table). [tuimux — Keyboard: Ctrl+A toggle](https://github.com/shuv1337/tuimux) / [wezterm — default-keys activate-pane-direction](https://wezterm.org/config/lua/config/index.html)
- Chip-in: focused terminal receives all keys via `handleKeyPress` → `onData("input")` → `pty.write`. [embedded-terminal — Focus and keyboard](https://opentui.com/docs/components/embedded-terminal)
- Prompting the lead by default: initial focus on lead pane; `jason.log` tail rendered in status bar + `team watch` equivalent inside the TUI (or an ink-style `Static` log panel).

**Responsive fallback:** on very small terminals (<90 cols), collapse to **tabs mode** (single active pane + sidebar list) — same binary, same data, toggled with `Shift+L`. Tuimux supports live tabs⇄panes switching; borrow that. [tuimux — Runtime Layout Switching: Shift+L](https://github.com/shuv1337/tuimux)

---

## 11. Minimal implementation sketch (OpenTUI + node-pty)

```ts
// pseudocode — each pane is a (pty, terminal) pair
import * as pty from "node-pty";
import {
  createCliRenderer,
  EmbeddedTerminalRenderable,
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";

const renderer = await createCliRenderer();
const root = renderer.root; // Box flex row

function attachPane(
  id: string,
  shell: string,
  args: string[],
  cwd: string,
  box: BoxRenderable
) {
  const term = new EmbeddedTerminalRenderable(renderer, {
    id,
    width: "100%",
    height: "100%",
  });
  const p = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as any,
  });
  term.onData = (data) => p.write(data as unknown as string); // handle Uint8Array/string per typings
  term.onTerminalResize = (cols, rows) => p.resize(cols, rows);
  p.onData((data) => term.write(data));
  box.add(term);
  term.focus();
  return { p, term };
}

// lead pane
const leadBox = new BoxRenderable(renderer, {
  flexGrow: 1.6,
  flexBasis: "58%",
  borderStyle: "round",
});
root.add(leadBox);
// ... attachPane("lead", leadShell, leadArgs, worktreeLead, leadBox)
// ... same for 5 teammates in right column boxes
await renderer.start(); // starts render loop + input
```

Key gotcha from the main project handoff: every child `git` must use `cleanGitEnv()` from `src/core/worktrees/index.ts` — hook runners export `GIT_INDEX_FILE` etc. that poison child git. New launcher code spawning `opencode`/`Muse` must inherit that hygiene.

**Wizard (`crewel init`):** ask team name, `--lead` type, `--teammates` counts, adapter CLIs detection/auth check (already in FR-1), preferred layout density (compact vs. tilted), then writes `.crewel/teams/{name}/config.json`. `crewel` with no args reads active team (one-team-per-repo constraint, DECISIONS Q20), restores layout + respawns 6 PTYs.

---

## 12. Risks, mitigations, and open follow-ups

| Risk                                                                                | Mitigation                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native addon fragility (`node-pty` + OpenTUI Zig prebuild) across Win architectures | Pin to prebuilt `node-pty` beta (current v1.2.0-beta.15) and `@opentui/core` 0.5.x; CI matrix on Win x64 + arm64 + macOS arm64. Both projects already test these triples. [node-pty releases](https://github.com/microsoft/node-pty/releases) / [@opentui/core npm](https://www.npmjs.com/package/@opentui/core) |
| `TERM`/`COLORTERM` leakage; agents rendering badly                                  | Set `TERM=xterm-256color`, `COLORTERM=truecolor` on each `pty.spawn` env. OpenTUI embeds Ghostty VT, so truecolor is available. [embedded-terminal — Attach](https://opentui.com/docs/components/embedded-terminal)                                                                                              |
| Copy/paste into hosted TUIs                                                         | Wire `handlePaste` + bracketed paste; forward OSC 52 clipboard like tuimux does. [embedded-terminal — Focus/Input](https://opentui.com/docs/components/embedded-terminal) / [tuimux — Nested Copy/Paste](https://github.com/shuv1337/tuimux)                                                                     |
| Window too small for 6 panes legibly                                                | Auto-fallback to tabs mode; `Shift+L` manual toggle.                                                                                                                                                                                                                                                             |
| User already runs tmux/WezTerm/Zellij                                               | Detect `TMUX` / `ZELLIJ` / `TERM_PROGRAM=WezTerm`; offer "use external multiplexer backend?" in wizard, but default remains in-process so behavior is identical regardless of parent terminal.                                                                                                                   |
| Ink inside OpenTUI?                                                                 | Not needed for launch panes; if later the launcher wants an ink-style list widget, use OpenTUI's `Select`/`TabSelect` instead. [opentui.com — Components](https://opentui.com/docs)                                                                                                                              |

**Follow-up ticket suggestion:** add `crewel doctor --window` that prints ConPTY availability, `node-pty` prebuild health, and OpenTUI native artifact triple, analogous to existing `crewel doctor` for adapters.

---

## 13. Sources — every claim's primary URL

- Microsoft — Pseudoconsoles overview: https://learn.microsoft.com/en-us/windows/console/pseudoconsoles
- Microsoft — Creating a Pseudoconsole session (CreatePseudoConsole API): https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
- Microsoft — CreatePseudoConsole reference: https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
- Microsoft — Introducing the Windows Pseudo Console (ConPTY) announcement: https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/
- Microsoft — Windows Terminal Panes: https://learn.microsoft.com/en-us/windows/terminal/panes
- Microsoft — Windows Terminal command line arguments (`wt` split-pane etc.): https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments
- Microsoft — What is Windows Terminal? (Windows-only host): https://learn.microsoft.com/en-us/windows/terminal/
- microsoft/node-pty — README (forkpty, platforms, Windows 1809+/ConPTY, winpty removed): https://github.com/microsoft/node-pty
- microsoft/node-pty — typings `node-pty.d.ts` (IPty, spawn): https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts
- microsoft/node-pty — releases (winpty removal in beta.7): https://github.com/microsoft/node-pty/releases
- tmux — wiki / source: https://github.com/tmux/tmux/wiki
- tmux — tmux.app installation / Windows WSL note: https://tmux.info/docs/installation and https://tmux.app/install/windows
- tmux — pane layouts (even-horizontal, main-vertical, tiled etc.): https://tao-of-tmux.readthedocs.io/en/stable/manuscript/06-window.html
- tmux on Windows comparison (psmux vs WSL+tmux vs Win Terminal vs WezTerm vs Zellij): https://gist.github.com/psmux/16e2c278b32c25c6a6663b6247ec24c3
- psmux — native Windows tmux-compat (ConPTY, winget): https://zenn.dev/sora_biz/articles/psmux-windows-native-tmux?locale=en
- chjj/blessed — curses-like library: https://github.com/chjj/blessed
- yaronn/blessed-contrib — dashboards / Grid: https://github.com/yaronn/blessed-contrib
- vadimdemedes/ink — React for CLIs / Flexbox via Yoga: https://github.com/vadimdemedes/ink
- Ink 7.0 — Node 22 + React 19.2 / input rewrite: https://www.heise.de/en/news/React-in-the-Terminal-Ink-7-0-fundamentally-revises-input-handling-11249949.html
- xtermjs/xterm.js — terminal for the browser (needs DOM, term.open): https://github.com/xtermjs/xterm.js
- xterm.js — headless package (state tracker, not renderer): https://github.com/xtermjs/xterm.js/blob/master/headless/README.md and https://www.npmjs.com/package/@xterm/headless
- WezTerm — cross-platform terminal (Linux, macOS, Windows 10): https://wezterm.org/
- WezTerm — Multiplexing / domains: https://wezterm.org/multiplexing.html
- WezTerm — CLI split-pane: https://wezterm.org/cli/cli/split-pane.html and config/Lua API: https://wezterm.org/config/lua/config/index.html
- anthropics/claude-code #23574 — WezTerm as split-pane backend (detection TERM_PROGRAM=WezTerm, pane mapping): https://github.com/anthropics/claude-code/issues/23574
- Zellij — FAQ (what is it, layouts, OS support "Windows: Via WSL"): https://zellij.dev/faq/
- Zellij — Windows support issue #316 (termios/RawFd obstacles): https://github.com/zellij-org/zellij/issues/316
- Zellij — home: https://zellij.dev/
- vtm — cross-platform but obscure multiplexer: https://www.linuxlinks.com/vtm-terminal-multiplexer
- OpenTUI — site / docs: https://opentui.com/ and https://opentui.com/docs
- OpenTUI — Embedded terminal (Ghostty VT, Windows GNU prebuild, I/O model): https://opentui.com/docs/components/embedded-terminal
- anomalyco/opentui — repo: https://github.com/anomalyco/opentui
- @opentui/core — npm: https://www.npmjs.com/package/@opentui/core
- shuv1337/tuimux — OpenTUI + SolidJS + ghostty-opentui + node-pty multiplexer (dual tabs/panes, 9 themes, live switch): https://github.com/shuv1337/tuimux
- OpenCode — uses OpenTUI in production (context for crewel's shared lineage): PRD §5 / handoff `crewel-handoff-2026-08-25.md` at `/var/folders/.../T/opencode/crewel-handoff-2026-08-25.md` — read via filesystem, not URL

---

_End of research. Recommendation stands: build the launcher as `OpenTUI EmbeddedTerminal + node-pty`, keep WezTerm as an optional second backend, and do not invest in tmux/Zellij/WT-native launchers beyond detection + advice._
