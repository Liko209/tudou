// Historical usage aggregates, scanned from CLI JSONL transcripts on disk.
// Shared between Electron main (the scanner) and the renderer (Usage view).

export interface UsageTotals {
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  costUSD: number;
  /** Assistant messages counted. */
  messages: number;
}

export interface DailyUsage extends UsageTotals {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
}

export interface ModelUsage extends UsageTotals {
  model: string;
}

export interface ProjectUsage extends UsageTotals {
  /** Project working directory. */
  project: string;
}

export interface RateLimitWindow {
  /** Percent of the window consumed, 0–100. */
  usedPercentage: number;
  /** Unix epoch seconds when the window resets (0 if unknown). */
  resetsAt: number;
}

/**
 * Rate-limit snapshot, captured from Claude Code's statusLine payload
 * (`rate_limits.{five_hour,seven_day}`) by an opt-in Tudou statusLine wrapper.
 */
export interface RateLimits {
  source: string;
  /** Unix epoch seconds the snapshot was written. */
  updatedAt: number;
  fiveHour?: RateLimitWindow;
  sevenDay?: RateLimitWindow;
}

export interface UsageHistory {
  /** ISO timestamp the scan finished. */
  generatedAt: string;
  totals: UsageTotals;
  /** Per calendar day, ascending. */
  byDay: DailyUsage[];
  /** Per model, by cost descending. */
  byModel: ModelUsage[];
  /** Per project, by cost descending (top N). */
  byProject: ProjectUsage[];
}
