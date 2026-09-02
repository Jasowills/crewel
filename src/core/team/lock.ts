import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Simple file-based lock using exclusive create (O_EXCL).
 * Not as robust as proper flock, but works for single-host file-based coordination
 * as used by Claude Agent Teams (file locking) and crewel's .crewel store.
 * Each lock is a file <target>.lock with random content and advisory expiry.
 */
export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; retryMs?: number } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retryMs = opts.retryMs ?? 20;
  const lockPath = `${targetPath}.lock`;
  const start = Date.now();
  let fd: Awaited<ReturnType<typeof open>> | null = null;

  // Ensure parent dir exists for lock file
  await mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      fd = await open(lockPath, "wx", 0o600);
      await fd.writeFile(
        `${process.pid}-${randomBytes(4).toString("hex")}\n`,
        "utf8"
      );
      break;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timeout acquiring lock for ${targetPath}`);
      }
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      if (fd) await fd.close();
    } catch {}
    try {
      await unlink(lockPath);
    } catch {}
  }
}

export async function atomicWriteFile(
  targetPath: string,
  content: string,
  encoding: BufferEncoding = "utf8"
): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, encoding);
  await rename(tmp, targetPath);
}
