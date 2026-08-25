export interface AgentAdapter {
  readonly id: string;
  checkAvailable(): Promise<boolean>;
}
