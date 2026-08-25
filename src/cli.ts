#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const pkg = require("../package.json") as { version: string };

export function getVersion(): string {
  return pkg.version;
}

export function main(argv: string[]): number {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(getVersion());
    return 0;
  }
  console.log(
    `crewel ${getVersion()} — a mixed crew of coding agents, stitched together on one ticket board.`
  );
  console.log("");
  console.log("Usage: crewel <command> [options]");
  console.log("");
  console.log("The command surface arrives with the team engine. For now:");
  console.log("  --version, -v   Print the version");
  return 0;
}

let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = process.argv[1] ?? "";
}
if (invoked === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
