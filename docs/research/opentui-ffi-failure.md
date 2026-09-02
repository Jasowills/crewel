# OpenTUI FFI Failure — Why `crewel` Falls Back to Console

**Date:** 2026-08-28
**Repo:** `/Users/jasonamadi/crewel`
**Error:** `Failed to initialize OpenTUI render library: OpenTUI native FFI is not available for this runtime yet`

## Summary

`crewel` on **Node.js v24.16.0** (no Bun, no `--experimental-ffi`) cannot load the native Zig library that `@opentui/core@0.5.8` requires. The library's FFI backend resolves to an `unsupported` stub that throws `FFI_UNAVAILABLE`, which is then wrapped as `Failed to initialize OpenTUI render library: …`. The `try/catch` in `src/cli/launcher.ts:194` logs that message and enters the console fallback.

## 1. Crewel usage

| Location                    | Evidence                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/cli/launcher.ts:25-31` | `const { createCliRenderer } = await import("@opentui/core");` then `const renderer = await createCliRenderer();`   |
| `package.json:7-8`          | `"engines": { "node": ">=20" }`                                                                                     |
| `package.json:56`           | `"@opentui/core": "^0.5.8"` — crewel pins `0.5.8` (resolved `0.5.8` in `node_modules/@opentui/core/package.json:8`) |
| `package.json:57`           | `"node-pty": "^1.1.0"` — terminal panes, unrelated to render failure                                                |

## 2. Error origin — exact source

### 2.1 Inner error: `FFI_UNAVAILABLE`

Defined in the bundled Node build and declared in the platform d.ts:

> `node_modules/@opentui/core/chunk-node-mfda59vq.js:189`:
>
> ```js
> var FFI_UNAVAILABLE =
>   "OpenTUI native FFI is not available for this runtime yet";
> ```
>
> `node_modules/@opentui/core/platform/ffi.d.ts:107`:
>
> ```ts
> export declare const FFI_UNAVAILABLE =
>   "OpenTUI native FFI is not available for this runtime yet";
> ```
>
> Same string exists in the Bun chunk (`chunk-bun-2956gvaq.js:154`).

Implementation that throws it — the **unsupported backend** stub:

> `node_modules/@opentui/core/chunk-node-mfda59vq.js:212-224`:
>
> ```js
> function unavailable(cause) {
>   throw new Error(FFI_UNAVAILABLE, { cause });
> }
> function createUnsupportedBackend(cause) {
>   return {
>     dlopen() {
>       return unavailable(cause);
>     },
>     ptr() {
>       return unavailable(cause);
>     },
>     suffix: "",
>     toArrayBuffer() {
>       return unavailable(cause);
>     },
>   };
> }
> ```

### 2.2 Backend selection

> `node_modules/@opentui/core/chunk-node-mfda59vq.js:231-243`:
>
> ```js
> var isBun =
>   typeof process !== "undefined" &&
>   typeof process.versions === "object" &&
>   process.versions !== null &&
>   typeof process.versions.bun === "string";
> var usesBunFFI = isBun;
> // …
> function loadBackend() {
>   if (isBun) {
>     return createBunBackend(requireModule("bun:ffi"));
>   }
>   try {
>     const nodeFfi = requireModule("node:ffi");
>     return createNodeBackend(nodeFfi.default ?? nodeFfi);
>   } catch (error) {
>     return createUnsupportedBackend(error); // ← Node v24 hits this branch
>   }
> }
> ```

Verification on this machine:

```
$ node --version
v24.16.0                                              # primary: bash check 2026-08-28
$ node -e "require('node:ffi')"
No such built-in module: node:ffi                    # primary: bash check 2026-08-28
$ bun --version
command not found: bun                                 # primary: bash check 2026-08-28
```

Bun and `node:ffi` are both absent → `loadBackend()` returns the unsupported stub → any `dlopen` throws `FFI_UNAVAILABLE`.

### 2.3 Outer wrapper: `Failed to initialize OpenTUI render library`

The Zig library loader wraps the inner error:

> `node_modules/@opentui/core/chunk-node-mfda59vq.js:17618-17624`:
>
> ```js
> function resolveRenderLib() {
>   if (!opentuiLib) {
>     try {
>       opentuiLib = new FFIRenderLib(opentuiLibPath);
>     } catch (error) {
>       throw new Error(
>         `Failed to initialize OpenTUI render library: ${error instanceof Error ? error.message : "Unknown error"}`
>       );
>     }
>   }
>   renderLibResolved = true;
>   return opentuiLib;
> }
> ```

When the inner `error.message` is `FFI_UNAVAILABLE`, the resulting message observed by crewel is exactly:

```
Failed to initialize OpenTUI render library: OpenTUI native FFI is not available for this runtime yet
```

`chunk-node-kr27pp2p.js:7317` / `7333` and similar paths also throw `Failed to create renderer` / `Failed to allocate NativeSpanFeed` if the render path is entered differently, but the reproducer path for crewel is via `resolveRenderLib` above (`createCliRenderer` → `FFIRenderLib` → `dlopen`).

## 3. Supported runtimes — primary sources only

### OpenTUI README (authoritative)

> `node_modules/@opentui/core/README.md:52-53` (mirrors `https://github.com/anomalyco/opentui` README and `https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/README.md:52-53`):
>
> ```
> `@opentui/core` runs on Bun 1.3.0 or later, or on Node.js 26.4.0 or later
> with ECMAScript modules (ESM) and `--experimental-ffi`.
> ```

Full upstream files:

- `https://github.com/anomalyco/opentui` (repo root README) — same Runtime paragraph.
- `https://raw.githubusercontent.com/anomalyco/opentui/main/README.md` — Development requires `Bun 1.3.0 or later and Zig 0.16.0`.
- `https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/README.md:52-53` — canonical package README.

### Node.js `node:ffi` documentation

> `https://nodejs.org/api/ffi.html` (Node.js v26.8.1 docs, fetched 2026-08-28):
>
> - `Source Code: lib/ffi.js Added in: v26.1.0`
> - `Stability: 1 - Experimental`
> - `This module is only available under the node: scheme in builds with FFI support and is gated by the --experimental-ffi flag.`
> - `When using the Permission Model, FFI APIs are restricted unless the --allow-ffi flag is provided.`
> - Also notes: s390x, some mips/ppc64 targets are unsupported by bundled libffi.

Therefore:

| Runtime                                                                                     | Supported?                        | Evidence                                                                                                   |
| ------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Bun >= 1.3.0**                                                                            | ✅ Yes — uses `bun:ffi`           | `README.md:52`, `chunk-node-mfda59vq.js:236` (`createBunBackend(requireModule("bun:ffi"))`)                |
| **Node >= 26.4.0 with ESM + `--experimental-ffi` (+ `--allow-ffi` under Permission Model)** | ✅ Yes — uses `node:ffi`          | `README.md:52`, `nodejs.org/api/ffi.html` (`Added in: v26.1.0`, gated by `--experimental-ffi`)             |
| **Node 24.x (crewel's current runtime: v24.16.0)**                                          | ❌ No — `node:ffi` does not exist | `bash: node -e "require('node:ffi')" → No such built-in module: node:ffi`; `ffi.html` says added in 26.1.0 |
| **Node 26.x without `--experimental-ffi`**                                                  | ❌ No — module gated by flag      | `ffi.html: This module is only available … gated by the --experimental-ffi flag`                           |
| **Deno / other runtimes**                                                                   | ❌ No                             | `loadBackend()` only handles Bun and `node:ffi`; otherwise `createUnsupportedBackend`                      |

A secondary in-repo hint: `node_modules/@opentui/core/chunk-node-mfda59vq.js:11743` contains the string literal `bun-ffi-structs pointer operations require Bun or Node.js 26.1+ with node:ffi enabled (--experimental-ffi)` — consistent with the README floor of 26.4.0 for `@opentui/core` specifically.

### Platform / architecture distribution

Native binaries are shipped as **optionalDependencies** (internal distribution surfaces, not app APIs):

> `node_modules/@opentui/core/package.json:36-44`:
>
> ```json
> "optionalDependencies": {
>   "@opentui/core-darwin-x64": "0.5.8",
>   "@opentui/core-darwin-arm64": "0.5.8",
>   "@opentui/core-linux-x64": "0.5.8",
>   "@opentui/core-linux-arm64": "0.5.8",
>   "@opentui/core-win32-x64": "0.5.8",
>   "@opentui/core-win32-arm64": "0.5.8",
>   "@opentui/core-linux-x64-musl": "0.5.8",
>   "@opentui/core-linux-arm64-musl": "0.5.8"
> }
> ```
>
> `node_modules/@opentui/core/README.md:55-56`: `The native ABI and the generated platform packages, such as @opentui/core-linux-x64, are internal distribution surfaces`

This machine is `darwin arm64` (`@opentui/core-darwin-arm64`), which is a supported platform **once the runtime requirement is met** — but the prebuild is never reached because FFI initialization fails before `dlopen` of the `.dylib/.so/.dll`.

Module format requirements:

> `node_modules/@opentui/core/package.json:6`: `"type": "module"` and `README.md:52`: `with ECMAScript modules (ESM)`
> `crewel/package.json:6`: `"type": "module"` — crewel already satisfies ESM.

## 4. Why the fallback triggers in `src/cli/launcher.ts:194`

> `src/cli/launcher.ts:25-31`: imports are **dynamic** inside the `try`:
>
> ```ts
> const { createCliRenderer } = await import("@opentui/core");
> // …
> const renderer = await createCliRenderer();
> ```

> `src/cli/launcher.ts:15-23`: early non-TTY short-circuit (no TUI attempted).

> `src/cli/launcher.ts:194-228`: `catch (e)` wraps the entire TUI path:
>
> ```ts
> } catch (e) {
>   console.error(
>     "TUI launch failed, falling back to console:",
>     (e as Error).message
>   );
>   // … console fallback, keepAlive interval, SIGINT wait …
>   return 0;
> }
> ```

Call chain:

1. `await createCliRenderer()` (`src/cli/launcher.ts:31`) → `chirp` → `FFIRenderLib` constructor → `backend.dlopen(...)`.
2. On Node 24, `backend` is the unsupported stub → `throw new Error(FFI_UNAVAILABLE)` → wrapped at `chunk-node-mfda59vq.js:17623` as `Failed to initialize OpenTUI …: FFI_UNAVAILABLE`.
3. That error propagates to the `catch` at `src/cli/launcher.ts:194`, which logs `TUI launch failed, falling back to console: Failed to initialize OpenTUI render library: OpenTUI native FFI is not available for this runtime yet` and enters the fallback branch.

No bug in crewel's code — the fallback is **working as designed**. The TUI is unavailable because the runtime does not meet OpenTUI's prerequisites. The fallback's `keepAlive` + `process.stdin.resume()` keeps the process alive for a headless demo, but provides no interactive panes.

Related: `node_modules/@opentui/core/package.json:14-22` `exports` maps `"." : { "bun": "./index.bun.js", "node": "./index.node.js" }` — crewel on Node resolves `index.node.js` → `chunk-node-mfda59vq.js` (Node FFI path), not the Bun path, confirming the `node:ffi` branch is the relevant one.

## 5. Is `@opentui/core@0.5.8` Bun-only?

**No.** `0.5.8` ships both paths:

- `index.bun.js` / `chunk-bun-*.js` → `bun:ffi`
- `index.node.js` / `chunk-node-*.js` → `node:ffi`

> Evidence: `node_modules/@opentui/core/package.json:14-22` exports, and file listing (`ls node_modules/@opentui/core/*.js`) contains both `index.bun.js` and `index.node.js` plus `yoga.bun.js` / `yoga.js`.

The Node path is real but requires Node 26.4+ + flag. On Node 24 without the flag the Node path still loads but immediately hits the unsupported backend. Upgrading or downgrading `@opentui/core` within the `0.5.x` series would not change this runtime floor — the README floor has been Bun 1.3 / Node 26.4 since the `node:ffi` backend was introduced.

## 6. Actionable options for crewel

### Option A — Switch execution to Bun (recommended, least friction)

**Why:** Matches OpenTUI's primary supported runtime; no flags, no version mismatch.

- Install Bun 1.3.0+ (upstream: `https://bun.sh` — OpenTUI README `README.md:52` pins `Bun 1.3.0 or later`).
- Change launch to `bun run crewel` or `bunx crewel` or `bun --bun crewel` (shebang already via `dist/cli.js` ESM, Bun can run it directly).
- Alternatively document `bun add @opentui/core` expectation (upstream README `bun add @opentui/core`) and add `engines.bun >=1.3` alongside `engines.node`.
- Verify: `bun --version && bun -e "import {createCliRenderer} from '@opentui/core'; console.log(typeof createCliRenderer)"` should not throw `FFI_UNAVAILABLE`.

**Trade-off:** Requires contributors/CI to have Bun; dual-runtime CI matrix if crewel still supports `node` for non-TUI commands.

### Option B — Stay on Node but require Node ≥ 26.4 and `--experimental-ffi`

**Why:** Keeps crewel as a Node CLI while satisfying the only supported Node path.

1. Bump `package.json:7` `engines.node` to `" >=26.4.0"` (currently `>=20` is inaccurate for the TUI feature; keep `>=20` for non-TUI subcommands if you detect and degrade, but document the TUI floor).
2. Require the TUI launch to use:
   ```
   node --experimental-ffi --allow-ffi dist/cli.js
   ```
   or via `NODE_OPTIONS="--experimental-ffi --allow-ffi"` (Node docs `ffi.html` flags). Under Permission Model, `--allow-ffi` is mandatory.
3. Ensure ESM (already `type: module` — ok).
4. Test darwin arm64/x64 prebuild resolution: `npm ls @opentui/core-darwin-arm64` should resolve; if missing, `npm install --include=optional` (optionalDeps are not guaranteed if `npm install --omit=optional` was used).

**Trade-off:** Node FFI is **experimental** (stability 1) and may change/break; requires every user to pass flags or set `NODE_OPTIONS`; still unsupported on Node 24/25 even with the flag.

### Option C — Keep robust fallback and make TUI explicitly optional

**Why:** Best UX if crewel must support Node 20-24 (LTS) and not force Bun or bleeding-edge Node.

- Keep current `try/catch` fallback (`src/cli/launcher.ts:194-228`) as the non-negotiable safety net.
- Add **pre-flight detection** before `createCliRenderer()`:
  ```ts
  const isBun = typeof process.versions.bun === "string"; // same check as opentui chunk-node-mfda59vq.js:231
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  const hasNodeFFI = (() => {
    try {
      require("node:ffi");
      return true;
    } catch {
      return false;
    }
  })();
  if (!isBun && (!hasNodeFFI || nodeMajor < 26)) {
    // warn and go directly to fallback or offer `node --experimental-ffi` hint
  }
  ```
  This avoids the noisy `Failed to initialize` stack and gives a tailored message.
- Surface a flag: `crewel --no-tui` / `CREWEL_NO_TUI=1` and `crewel --tui` (strict) that fails fast with the runtime hint instead of silent fallback.
- Optionally gate `@opentui/core` as an **optional peer** and lazy-import only when TUI is requested, so `crewel` installs/runs without native prebuilds on unsupported platforms.
- CI: matrix of `[bun 1.3, node 26 --experimental-ffi, node 24]` where TUI tests are skipped with `FFI_UNAVAILABLE` detection.

**Trade-off:** TUI remains unavailable on Node 24 without action; requires extra UX code but avoids forcing a runtime upgrade.

---

## Appendix — Sources checklist

- Crewel repo: `src/cli/launcher.ts:6-31`, `src/cli/launcher.ts:194-228`, `package.json:7`, `package.json:56-58`, `node_modules/@opentui/core/package.json:6`, `package.json:8`, `package.json:14-44`
- OpenTUI source (installed): `node_modules/@opentui/core/README.md:52-56`, `node_modules/@opentui/core/chunk-node-mfda59vq.js:189`, `:212-224`, `:231-243`, `:17618-17624`, `node_modules/@opentui/core/platform/ffi.d.ts:107`, `node_modules/@opentui/core/chunk-node-mfda59vq.js:11743`
- Upstream primary: `https://github.com/anomalyco/opentui` (README Runtime paragraph), `https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/README.md:52-53`, `https://raw.githubusercontent.com/anomalyco/opentui/main/README.md`
- Node.js primary: `https://nodejs.org/api/ffi.html` (`Added in: v26.1.0`, gated by `--experimental-ffi`, `--allow-ffi`, platform exclusions)
- Live verification: `node --version → v24.16.0`, `node -e "require('node:ffi')" → No such built-in module: node:ffi`, `bun --version → not found` (bash, 2026-08-28)

## Appendix — GitHub issues / discussions

No issue fetch was needed for the root cause — the upstream README and source already state the runtime floor. For follow-up, search the canonical repo for existing Node FFI reports:

- `https://github.com/anomalyco/opentui/issues?q=FFI+OR+%22native+FFI+is+not+available%22+OR+%22experimental-ffi%22`
- `https://github.com/anomalyco/opentui/discussions`

If crewel files a tracking issue, link this doc and cite `README.md:52` + `nodejs.org/api/ffi.html` so the constraint is traceable to primary sources.
