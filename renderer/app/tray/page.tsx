'use client';

import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import type { Session } from '../../../shared/session-types';
import type { RateLimits } from '../../../shared/usage-types';
import { cn } from '../../lib/utils';
import { StatusDot } from '../components/StatusDot';

/**
 * Menu-bar companion popover — a compact, live, read+navigate panel rendered in
 * its own frameless window (positioned under the tray icon by the main process).
 * Reuses the shared preload API; drives the main window via `window.agentDashboard.tray`.
 */
const THEME_KEY = 'agent-dashboard.theme';

function upsert(list: Session[], s: Session): Session[] {
  const i = list.findIndex((x) => x.id === s.id);
  if (i === -1) return [...list, s];
  const next = list.slice();
  next[i] = s;
  return next;
}

const ORDER: Record<string, number> = { blocked: 0, errored: 1, working: 2, starting: 2, waiting: 3, exited: 4 };

function projectOf(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() || cwd;
}

function detailOf(s: Session): string {
  const project = projectOf(s.cwd);
  if (s.status === 'blocked') return `${project} · waiting on you`;
  if (s.status === 'working' && s.currentTool?.name) return `${project} · ${s.currentTool.name}`;
  if (s.status === 'errored') return `${project} · error`;
  return project;
}

function resetsIn(epochSec: number): string {
  if (!epochSec) return '';
  const ms = epochSec * 1000 - Date.now();
  if (ms <= 0) return 'now';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

export default function TrayPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rate, setRate] = useState<RateLimits | null>(null);

  // Match the main window's theme + let the rounded card float on transparency.
  useEffect(() => {
    const theme = window.localStorage?.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    const html = document.documentElement;
    html.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    const api = window.agentDashboard;
    if (!api) return;
    void api.sessions.list().then(setSessions);
    const offAdd = api.sessions.onAdd((s) => setSessions((prev) => upsert(prev, s)));
    const offUpd = api.sessions.onUpdate((s) => setSessions((prev) => upsert(prev, s)));
    const offRem = api.sessions.onRemove(({ id }) => setSessions((prev) => prev.filter((x) => x.id !== id)));
    const loadRate = (): void => void api.usage.getRateLimits().then((r) => setRate(r.data));
    loadRate();
    const t = window.setInterval(loadRate, 5000);
    return () => {
      offAdd();
      offUpd();
      offRem();
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.agentDashboard?.tray?.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(
    () => sessions.filter((s) => !s.panelOnly).sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)),
    [sessions],
  );
  const blockedN = visible.filter((s) => s.status === 'blocked').length;
  const workingN = visible.filter((s) => s.status === 'working' || s.status === 'starting').length;

  const summary = [
    blockedN ? `${blockedN} need${blockedN === 1 ? 's' : ''} you` : null,
    workingN ? `${workingN} working` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="h-screen w-screen overflow-hidden p-2 text-sm">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-edge/15 bg-surface shadow-2xl">
        {/* header */}
        <div className="flex items-baseline justify-between border-b border-edge/10 px-3 py-2">
          <span className="font-medium text-ink">Tudou</span>
          <span className="text-xs text-subtle">{summary || `${visible.length} sessions`}</span>
        </div>

        {/* rate limits */}
        {rate && (rate.fiveHour || rate.sevenDay) && (
          <div className="flex flex-col gap-1.5 border-b border-edge/10 px-3 py-2">
            {rate.fiveHour && <RateBar label="5-hour" pct={rate.fiveHour.usedPercentage} resetsAt={rate.fiveHour.resetsAt} />}
            {rate.sevenDay && <RateBar label="Weekly" pct={rate.sevenDay.usedPercentage} resetsAt={rate.sevenDay.resetsAt} />}
          </div>
        )}

        {/* sessions */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted">No running sessions.</div>
          ) : (
            visible.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void window.agentDashboard?.tray?.focusSession(s.id)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-canvas/60"
                title={s.cwd}
              >
                <StatusDot status={s.status} confidence={s.statusConfidence} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ink">{s.title?.trim() || s.displayName}</span>
                  <span className="truncate text-xs text-subtle">{detailOf(s)}</span>
                </span>
              </button>
            ))
          )}
        </div>

        {/* actions */}
        <div className="flex items-center gap-1 border-t border-edge/10 px-2 py-1.5">
          <Action icon={FolderPlus} label="New" onClick={() => void window.agentDashboard?.tray?.openView('newSession')} />
          <Action icon={BarChart3} label="Usage" onClick={() => void window.agentDashboard?.tray?.openView('usage')} />
          <Action icon={SettingsIcon} label="Settings" onClick={() => void window.agentDashboard?.tray?.openView('settings')} />
        </div>
      </div>
    </div>
  );
}

function RateBar({ label, pct, resetsAt }: { label: string; pct: number; resetsAt: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const reset = resetsIn(resetsAt);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-subtle">
          {clamped}%{reset ? ` · ${reset}` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className={cn('h-full rounded-full', clamped >= 85 ? 'bg-warning' : 'bg-success/70')}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FolderPlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-canvas/60 hover:text-ink"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
    </button>
  );
}
