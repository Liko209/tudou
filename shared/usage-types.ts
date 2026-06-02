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
