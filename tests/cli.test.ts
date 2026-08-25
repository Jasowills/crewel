import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getVersion, main } from "../src/cli.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

describe("crewel CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports its version on --version", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--version"])).toBe(0);
    expect(log).toHaveBeenCalledWith(pkg.version);
  });

  it("reports its version on -v", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["-v"])).toBe(0);
    expect(log).toHaveBeenCalledWith(pkg.version);
  });

  it("prints help by default", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([])).toBe(0);
    expect(log.mock.calls.length).toBeGreaterThan(0);
  });

  it("exposes the manifest version programmatically", () => {
    expect(getVersion()).toBe(pkg.version);
  });
});
