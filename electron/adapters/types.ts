import type { CliKind } from '../../shared/ipc-contracts';
import type { ResumableSession, SessionUpdate } from '../../shared/session-types';

/**
 * Inputs to buildSpawnArgs — what the user asked the dashboard to launch.
 * Adapters translate this to a CLI-specific argv.
 */
export interface SpawnArgsInput {
  /** Resume a specific CLI-native session id. */
  resume?: string;
  /** Claude: -c flag (continue most recent in cwd). Mutually exclusive with `resume`. */
  continueLast?: boolean;
  /** Optional display name. Only meaningful for CLIs that support it (Claude --name). */
  name?: string;
  /** Optional model override (Claude --model). */
  model?: string;
  /** Optional effort level (Claude --effort: low/medium/high/xhigh/max). */
  effort?: string;
}

/**
 * Per-CLI adapter contract. One concrete adapter per CLI (claude, codex).
 *
 * All methods are pure with respect to their inputs and the filesystem —
 * adapters do not own the PTY, the SessionRegistry does. Adapters only:
 * - construct argv for spawn
 * - find where the CLI writes its session JSONL
 * - parse JSONL into SessionUpdate streams
 * - enumerate resumable sessions
 */
export interface CliAdapter {
  readonly cli: CliKind;

  /** Build the argv to pass to the CLI binary (excluding the binary path itself). */
  buildSpawnArgs(input: SpawnArgsInput): string[];

  /**
   * Wait for the CLI to materialize its JSONL session file under cwd after `after`.
   * Returns absolute path to the file, or null if it didn't appear within the
   * caller's signal (typically a 5–10s timeout enforced upstream).
   */
  locateSessionFile(cwd: string, after: Date, signal?: AbortSignal): Promise<string | null>;

  /**
   * Tail a JSONL session file and emit SessionUpdate snapshots as it grows.
   * Yields until `signal` aborts. Errors propagate.
   */
  watch(file: string, signal?: AbortSignal): AsyncIterable<SessionUpdate>;

  /**
   * List sessions resumable in the given cwd. Reads the CLI's own session
   * index; does not touch any dashboard-owned state.
   */
  listResumable(cwd: string): Promise<ResumableSession[]>;
}
