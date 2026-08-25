import { spawn } from "node:child_process";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { teamDir } from "../team/store.js";

/**
 * Kinds crewel emits itself. Open union: any other string is accepted so
 * adapters and future call sites can extend without touching core.
 */
export type NotificationKind =
  | "assignment"
  | "done"
  | "blocked"
  | "clarification"
  | "rate-limited"
  | "system"
  | (string & {});

export interface NotifyJasonInput {
  repoRoot: string;
  team: string;
  kind: NotificationKind;
  body: string;
}

export function jasonLogPath(repoRoot: string, team: string): string {
  return path.join(teamDir(repoRoot, team), "notifications", "jason.log");
}

// The log is a line-oriented human surface: flatten embedded newlines so
// every notification stays exactly one readable line.
function toSingleLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}

export async function notifyJason(input: NotifyJasonInput): Promise<void> {
  const logPath = jasonLogPath(input.repoRoot, input.team);
  await mkdir(path.dirname(logPath), { recursive: true });
  const line = `[${new Date().toISOString()}] [${input.kind}] ${toSingleLine(
    input.body
  )}\n`;
  await appendFile(logPath, line, "utf8");
}

export async function tailJasonLog(input: {
  repoRoot: string;
  team: string;
  sinceBytes?: number;
}): Promise<string> {
  let raw: Buffer;
  try {
    raw = await readFile(jasonLogPath(input.repoRoot, input.team));
  } catch {
    return ""; // No log yet — nothing to tail.
  }
  const start = Math.max(0, Math.floor(input.sinceBytes ?? 0));
  return raw.subarray(start).toString("utf8");
}

export type TeamWatchEvent =
  | { source: "mail"; participant: string }
  | { source: "tickets" }
  | { source: "jason" };

export interface TeamWatcher {
  /** Close every underlying fs.watch handle; idempotent and await-able. */
  stop(): Promise<void>;
}

const DEBOUNCE_MS = 50;

function firstSegment(filename: string): string {
  return filename.split(/[\\/]/)[0] ?? "";
}

export async function watchTeam(
  target: { repoRoot: string; team: string },
  onEvent: (event: TeamWatchEvent) => void
): Promise<TeamWatcher> {
  const root = teamDir(target.repoRoot, target.team);
  const messagesDir = path.join(root, "messages");
  const ticketsDir = path.join(root, "tickets");
  const logFile = jasonLogPath(target.repoRoot, target.team);

  // fs.watch refuses paths that do not exist yet: materialize the watched
  // tree up front so starting a watch never fails on a fresh team.
  await mkdir(messagesDir, { recursive: true });
  await mkdir(ticketsDir, { recursive: true });
  await mkdir(path.dirname(logFile), { recursive: true });
  try {
    await appendFile(logFile, "", "utf8"); // Touch so the file watch attaches.
  } catch {
    // Best effort only; the log may appear later via notifyJason.
  }

  const watchers: FSWatcher[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pendingMail = new Set<string>();
  let pendingTickets = false;
  let pendingJason = false;

  function deliver(event: TeamWatchEvent): void {
    try {
      onEvent(event);
    } catch {
      // A misbehaving consumer must not kill the watcher.
    }
  }

  function flush(): void {
    timer = undefined;
    if (stopped) return;
    const mail = [...pendingMail].sort();
    pendingMail.clear();
    const tickets = pendingTickets;
    pendingTickets = false;
    const jason = pendingJason;
    pendingJason = false;
    for (const participant of mail) {
      deliver({ source: "mail", participant });
    }
    if (tickets) deliver({ source: "tickets" });
    if (jason) deliver({ source: "jason" });
  }

  function schedule(): void {
    if (stopped || timer !== undefined) return; // Fixed window: coalesce all.
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function queueMail(participant: string): void {
    if (!participant) return;
    pendingMail.add(participant);
    schedule();
  }

  function queueMailFromFilename(filename: string | null): void {
    if (!filename) {
      // macOS hands us a name almost always; when it doesn't, surface every
      // participant currently on disk rather than dropping the signal.
      readdir(messagesDir)
        .then((entries) => {
          for (const entry of entries) queueMail(entry);
        })
        .catch(() => {
          // Directory vanished — nothing to report.
        });
      return;
    }
    queueMail(firstSegment(filename));
  }

  function attach(
    targetPath: string,
    options: { recursive?: boolean },
    onFilename: (filename: string | null) => void
  ): boolean {
    try {
      const watcher = watch(targetPath, options, (_eventType, filename) => {
        onFilename(filename ?? null);
      });
      watcher.on("error", () => {
        // e.g. directory removed underneath us — degrade quietly.
      });
      watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  }

  const recursiveOk = attach(
    messagesDir,
    { recursive: true },
    queueMailFromFilename
  );
  // Some platforms refuse recursive watches: fall back to the top level of
  // messages/ only (participant-dir events still carry their name).
  if (!recursiveOk) {
    attach(messagesDir, {}, queueMailFromFilename);
  }
  attach(ticketsDir, {}, () => {
    pendingTickets = true;
    schedule();
  });
  attach(logFile, {}, () => {
    pendingJason = true;
    schedule();
  });

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pendingMail.clear();
      pendingTickets = false;
      pendingJason = false;
      for (const watcher of watchers.splice(0, watchers.length)) {
        try {
          watcher.close();
        } catch {
          // Already closed — nothing to do.
        }
      }
    },
  };
}

/**
 * Best-effort macOS desktop ping (FR-12, behind a flag at the CLI layer).
 * Fire-and-forget: never throws into the caller, no-ops off darwin.
 */
export function pingDesktop(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  try {
    const sanitize = (text: string): string => text.replace(/["\\]/g, "");
    const script =
      `display notification "${sanitize(body)}" ` +
      `with title "${sanitize(title)}"`;
    const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
    child.on("error", () => {
      // No osascript / headless environment — stay silent.
    });
  } catch {
    // A desktop nicety must never break its caller.
  }
}
