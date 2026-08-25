import type { AgentAdapter } from "./types.js";

export const mockAdapter: AgentAdapter = {
  id: "mock",
  async checkAvailable() {
    return true;
  },
};
