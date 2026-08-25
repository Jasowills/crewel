import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createMockAdapter } from "./mock.js";
import { createOpencodeAdapter } from "./opencode.js";
import type { AgentAdapter } from "./types.js";

const registry = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function knownAdapterIds(): string[] {
  return [...registry.keys()].sort();
}

registerAdapter(createMockAdapter());
registerAdapter(createOpencodeAdapter());
registerAdapter(createClaudeAdapter());
registerAdapter(createCodexAdapter());
