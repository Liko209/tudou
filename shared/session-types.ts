// Session and SessionUpdate contracts, shared between Electron main and renderer.

import type { CliKind } from './ipc-contracts';

export type SessionStatus =
  /** Spawned, CLI still booting. */
  | 'starting'
  /** Model is thinking or a tool is running. */
  | 'working'
  /** Turn finished — the session is free, waiting for your next input. */
  | 'waiting'
  /** Stuck mid-turn: needs you to authorize a tool or make a choice. */
  | 'blocked'
  /** Hit an error (crash, login required, …). */
  | 'errored'
  /** CLI process has exited. */
  | 'exited';

export type StatusConfidence = 'high' | 'low';

export interface SessionMetrics {
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  estimatedCostUSD: number | null;
  messageCount: number;
  /**
   * Tokens occupying the context window on the most recent request
   * (prompt + cache), i.e. a snapshot of current context usage — NOT the
   * cumulative tokensInput. Undefined until the CLI reports usage.
   */
  contextTokens?: number;
  /** The active model's context window size, for computing % used. */
  contextLimit?: number;
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
  /** Auto-generated base name: `<project> · HH:MM`. Stable fallback. */
  displayName: string;
  /**
   * User-meaningful name shown in the sidebar/tabs in preference to
   * `displayName`. Auto-seeded from the first user prompt, then editable
   * by the user (rename). null until seeded.
   */
  title: string | null;
  /** Active model id reported by the CLI (e.g. claude-sonnet-4-5-…, gpt-5). */
  model?: string | null;
  status: SessionStatus;
  statusConfidence: StatusConfidence;
  startedAt: string;
  lastActivityAt: string;
  metrics: SessionMetrics;
  latestMessage: LatestMessage | null;
  currentTool: CurrentTool | null;
  ptyExitCode: number | null;
  /**
   * True for sessions owned by a dock panel (Side chat). Filtered out
   * of the main sidebar so the panel's session doesn't accumulate as
   * a regular tab.
   */
  panelOnly?: boolean;
}

/**
 * Snapshot update emitted by an adapter as the CLI's JSONL grows.
 * Fields not present mean "no change since last update".
 * `metrics` is always a full snapshot (absolute values), never a delta.
 */
export interface SessionUpdate {
  status?: SessionStatus;
  statusConfidence?: StatusConfidence;
  cliSessionId?: string;
  metrics?: SessionMetrics;
  latestMessage?: LatestMessage | null;
  currentTool?: CurrentTool | null;
  gitBranch?: string | null;
  model?: string | null;
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

/**
 * One entry in the "previous sessions" banner shown on dashboard startup.
 * Built by reconciling the persistence store against each CLI's on-disk
 * session files.
 */
export interface PreviousSession {
  /** Dashboard-internal id from the persisted record. */
  id: string;
  cli: CliKind;
  cliSessionId: string | null;
  cwd: string;
  displayName: string;
  /** User/auto title, carried across restarts. null if never seeded. */
  title: string | null;
  startedAt: string;
  /** Is the underlying CLI session file still present and resumable? */
  resumable: boolean;
}
