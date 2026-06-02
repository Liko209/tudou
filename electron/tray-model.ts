import { basename } from 'node:path';
import type { Session, SessionStatus } from '../shared/session-types';

/**
 * Pure model for the menu-bar tray: turns the live session list into the
 * icon variant, the badge/title count, a tooltip, and grouped menu items.
 * Kept free of Electron so it's unit-tested; LifecycleManager translates the
 * result into a native Menu + nativeImage.
 *
 * Key product rule: the urgent count (dock badge + tray number + amber icon)
 * is the number of sessions NEEDING HUMAN INTERVENTION — i.e. `blocked` (a
 * permission/choice is stuck on you) — NOT every idle/`waiting` session. A
 * finished-its-turn session still shows in the list, it just doesn't inflate
 * the "someone needs you" signal.
 */

export type TrayIconVariant = 'idle' | 'attention';

export type TrayGroupKey = 'blocked' | 'errored' | 'working' | 'idle';

export interface TrayItem {
  id: string;
  /** Primary label — the session's title or auto name. */
  name: string;
  /** Secondary detail — project, and current tool / idle hint. */
  sublabel: string;
  status: SessionStatus;
}

export interface TrayGroup {
  key: TrayGroupKey;
  title: string;
  items: TrayItem[];
}

export interface TrayModel {
  iconVariant: TrayIconVariant;
  /** Sessions needing intervention (blocked). Drives the badge + tray number. */
  interventionCount: number;
  tooltip: string;
  counts: { blocked: number; errored: number; working: number; waiting: number; total: number };
  groups: TrayGroup[];
}

/** Count of sessions that need the user to step in right now (blocked). */
export function interventionCount(sessions: Session[]): number {
  return sessions.reduce((n, s) => (s.status === 'blocked' ? n + 1 : n), 0);
}

function projectName(cwd: string): string {
  return basename(cwd) || cwd;
}

function itemOf(s: Session): TrayItem {
  const name = s.title?.trim() || s.displayName;
  const project = projectName(s.cwd);
  let detail = project;
  if (s.status === 'blocked') detail = `${project} · waiting on you`;
  else if (s.status === 'working' && s.currentTool?.name) detail = `${project} · ${s.currentTool.name}`;
  else if (s.status === 'errored') detail = `${project} · error`;
  return { id: s.id, name, sublabel: detail, status: s.status };
}

export function buildTrayModel(sessions: Session[]): TrayModel {
  const blocked = sessions.filter((s) => s.status === 'blocked');
  const errored = sessions.filter((s) => s.status === 'errored');
  const working = sessions.filter((s) => s.status === 'working');
  // 'waiting' = finished its turn (your turn); 'starting' counts as in-flight.
  const waiting = sessions.filter((s) => s.status === 'waiting');
  const starting = sessions.filter((s) => s.status === 'starting');

  const counts = {
    blocked: blocked.length,
    errored: errored.length,
    working: working.length,
    waiting: waiting.length,
    total: sessions.length,
  };

  const groups: TrayGroup[] = [];
  if (blocked.length) groups.push({ key: 'blocked', title: `Needs you (${blocked.length})`, items: blocked.map(itemOf) });
  if (errored.length) groups.push({ key: 'errored', title: `Errored (${errored.length})`, items: errored.map(itemOf) });
  const inFlight = [...working, ...starting];
  if (inFlight.length) groups.push({ key: 'working', title: `Working (${inFlight.length})`, items: inFlight.map(itemOf) });
  if (waiting.length) groups.push({ key: 'idle', title: `Idle (${waiting.length})`, items: waiting.map(itemOf) });

  // Tooltip — lead with the urgent thing.
  const parts: string[] = [];
  if (blocked.length) parts.push(`${blocked.length} need${blocked.length === 1 ? 's' : ''} you`);
  if (inFlight.length) parts.push(`${inFlight.length} working`);
  if (waiting.length) parts.push(`${waiting.length} idle`);
  const tooltip = parts.length ? `Tudou — ${parts.join(' · ')}` : 'Tudou — no sessions';

  return {
    iconVariant: blocked.length > 0 ? 'attention' : 'idle',
    interventionCount: blocked.length,
    tooltip,
    counts,
    groups,
  };
}
