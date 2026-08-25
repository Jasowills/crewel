import { mockAdapter } from "./mock.js";
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

registerAdapter(mockAdapter);
