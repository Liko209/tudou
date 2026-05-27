// Session and SessionUpdate contracts, shared between Electron main and renderer.

import type { CliKind } from './ipc-contracts';

export type SessionStatus =
  | 'starting'
  | 'working'
  | 'waiting'
  | 'idle'
  | 'errored'
  | 'exited';

export type StatusConfidence = 'high' | 'low';

export interface SessionMetrics {
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  estimatedCostUSD: number | null;
  messageCount: number;
}

export interface LatestMessage {
  role: 'user' | 'assistant' | 'tool';
  preview: string;
  timestamp: string;
}

export interface CurrentTool {
  name: string;
  description: string;
  startedAt: string;
}

export interface Session {
  id: string;
  cli: CliKind;
  cliSessionId: string | null;
  cwd: string;
  gitBranch: string | null;
  displayName: string;
  status: SessionStatus;
  statusConfidence: StatusConfidence;
  startedAt: string;
  lastActivityAt: string;
  metrics: SessionMetrics;
  latestMessage: LatestMessage | null;
  currentTool: CurrentTool | null;
  ptyExitCode: number | null;
}

/**
 * Snapshot update emitted by an adapter as the CLI's JSONL grows.
 * Fields not present mean "no change since last update".
 * `metrics` is always a full snapshot (absolute values), never a delta.
 */
export interface SessionUpdate {
  status?: SessionStatus;
  cliSessionId?: string;
  metrics?: SessionMetrics;
  latestMessage?: LatestMessage | null;
  currentTool?: CurrentTool | null;
  gitBranch?: string | null;
}

export interface ResumableSession {
  cli: CliKind;
  cliSessionId: string;
  firstPrompt: string;
  summary: string | null;
  messageCount: number;
  modified: string;
  gitBranch: string | null;
  cwd: string;
}
