'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { useUIStore, type ThemeChoice } from '../../lib/stores/ui-store';

interface HookStatus {
  scriptInstalled: boolean;
  registeredEvents: string[];
  fullyInstalled: boolean;
}

interface Preferences {
  notifications: {
    systemNotification: boolean;
    dockBadge: boolean;
    tray: boolean;
    sound: boolean;
  };
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  cliPaths: {
    claude: string | null;
    codex: string | null;
  };
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const openHookModal = useUIStore((s) => s.setHookModalOpen);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const api = window.agentDashboard?.preferences;
    if (api) void api.get().then(setPrefs);
    void window.agentDashboard?.hooks?.getStatus().then(setHookStatus);
  }, [open]);

  const reinstallHook = useCallback(async () => {
    const hooks = window.agentDashboard?.hooks;
    if (!hooks) return;
    setHookBusy(true);
    try {
      setHookStatus(await hooks.install());
    } finally {
      setHookBusy(false);
    }
  }, []);

  const save = useCallback(async (next: Preferences) => {
    const api = window.agentDashboard?.preferences;
    if (!api) return;
    setSaving(true);
    try {
      const stored = await api.set(next);
      setPrefs(stored);
    } finally {
      setSaving(false);
    }
  }, []);

  const doReset = useCallback(async () => {
    setConfirmReset(false);
    const api = window.agentDashboard?.preferences;
    if (!api) return;
    const next = await api.reset();
    setPrefs(next);
  }, []);

  const doClearSessions = useCallback(async () => {
    setConfirmClear(false);
    await window.agentDashboard?.preferences.clearSessions();
  }, []);

  if (!prefs) {
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="Settings" maxWidth="max-w-2xl">
        <div className="text-sm text-muted">Loading…</div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Settings" maxWidth="max-w-2xl">
      <div className="flex flex-col gap-6">
        <Section title="Appearance">
          <div className="grid grid-cols-3 gap-1.5">
            {(['dark', 'light', 'system'] as ThemeChoice[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm capitalize',
                  theme === t
                    ? 'border-accent/60 bg-accent/10 text-ink'
                    : 'border-edge/10 bg-sunken text-muted hover:border-edge/30',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Notifications">
          <CheckRow
            checked={prefs.notifications.systemNotification}
            onToggle={(v) =>
              void save({
                ...prefs,
                notifications: { ...prefs.notifications, systemNotification: v },
              })
            }
            label="System notification"
          />
          <CheckRow
            checked={prefs.notifications.dockBadge}
            onToggle={(v) =>
              void save({ ...prefs, notifications: { ...prefs.notifications, dockBadge: v } })
            }
            label="Dock badge"
          />
          <CheckRow
            checked={prefs.notifications.tray}
            onToggle={(v) =>
              void save({ ...prefs, notifications: { ...prefs.notifications, tray: v } })
            }
            label="Menubar badge"
          />
          <CheckRow
            checked={prefs.notifications.sound}
            onToggle={(v) =>
              void save({ ...prefs, notifications: { ...prefs.notifications, sound: v } })
            }
            label="Sound when in background"
          />
        </Section>

        <Section title="Quiet hours">
          <CheckRow
            checked={prefs.quietHours.enabled}
            onToggle={(v) =>
              void save({ ...prefs, quietHours: { ...prefs.quietHours, enabled: v } })
            }
            label="Mute notifications during a daily window"
          />
          <div className="flex items-center gap-2 pl-6 text-xs text-muted">
            <TimeInput
              value={prefs.quietHours.start}
              disabled={!prefs.quietHours.enabled}
              onChange={(v) =>
                void save({ ...prefs, quietHours: { ...prefs.quietHours, start: v } })
              }
            />
            <span>→</span>
            <TimeInput
              value={prefs.quietHours.end}
              disabled={!prefs.quietHours.enabled}
              onChange={(v) => void save({ ...prefs, quietHours: { ...prefs.quietHours, end: v } })}
            />
          </div>
        </Section>

        <Section title="CLI paths">
          <p className="text-xs text-muted">Leave blank to auto-detect.</p>
          <PathRow
            label="claude"
            value={prefs.cliPaths.claude ?? ''}
            onChange={(v) =>
              void save({
                ...prefs,
                cliPaths: { ...prefs.cliPaths, claude: v.trim() || null },
              })
            }
          />
          <PathRow
            label="codex"
            value={prefs.cliPaths.codex ?? ''}
            onChange={(v) =>
              void save({
                ...prefs,
                cliPaths: { ...prefs.cliPaths, codex: v.trim() || null },
              })
            }
          />
        </Section>

        <Section title="Hook" aside={<HookBadge status={hookStatus} />}>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={hookBusy}
              onClick={() => void reinstallHook()}
            >
              {hookBusy
                ? 'Installing…'
                : hookStatus?.fullyInstalled
                  ? 'Reinstall / update hook'
                  : 'Install hook'}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setOpen(false);
                openHookModal(true);
              }}
            >
              Open hook setup…
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-subtle">
            Lets Claude push turn-end / needs-input events to the dashboard for accurate status and
            notifications. Reinstall after a Claude update or if status looks stuck.
          </p>
        </Section>

        <Section title="Updates">
          <UpdatesSection />
        </Section>

        <Section title="Data">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={() => setConfirmReset(true)}>
              Reset preferences
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
              Clear session history
            </Button>
          </div>
        </Section>

        <div className="flex justify-end">
          <Button size="md" variant="default" disabled={saving} onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Reset preferences?"
        description="All notification, quiet hours, and CLI path settings revert to defaults."
        confirmLabel="Reset"
        destructive
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear session history?"
        description="Drops every persisted session record. Running sessions stay alive; the resume banner won't appear next launch."
        confirmLabel="Clear history"
        destructive
        onConfirm={() => void doClearSessions()}
        onCancel={() => setConfirmClear(false)}
      />
    </Modal>
  );
}

type UpdaterState =
  | { phase: 'idle'; currentVersion: string }
  | { phase: 'checking' }
  | { phase: 'up-to-date'; currentVersion: string }
  | { phase: 'available'; info: { version: string } }
  | { phase: 'downloading'; info: { version: string }; percent: number }
  | { phase: 'ready'; info: { version: string }; canAutoInstall: boolean }
  | { phase: 'error'; message: string };

function UpdatesSection() {
  const [st, setSt] = useState<UpdaterState | null>(null);
  const [busy, setBusy] = useState(false);
  const api = typeof window !== 'undefined' ? window.agentDashboard?.updates : undefined;

  useEffect(() => {
    if (!api) return;
    void api.getState().then((s) => setSt(s as UpdaterState));
    return api.onState((s) => setSt(s as UpdaterState));
  }, [api]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (!api) return <p className="text-xs text-subtle">Updates run in the packaged app.</p>;

  const phase = st?.phase ?? 'idle';
  return (
    <div className="flex flex-col gap-2">
      {st && 'currentVersion' in st && st.currentVersion && (
        <div className="font-mono text-xs text-subtle">Current version v{st.currentVersion}</div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {phase === 'checking' && <span>Checking for updates…</span>}
        {phase === 'up-to-date' && (
          <span>
            You’re on the latest version
            {st && 'currentVersion' in st && st.currentVersion ? ` (v${st.currentVersion})` : ''}.
          </span>
        )}
        {phase === 'available' && st && 'info' in st && (
          <>
            <span className="text-ink">Update available — v{st.info.version}</span>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => api.download())}>
              Download
            </Button>
          </>
        )}
        {phase === 'downloading' && st && 'percent' in st && (
          <span>Downloading… {Math.round(st.percent)}%</span>
        )}
        {phase === 'ready' && st && 'info' in st && (
          <>
            <span className="text-ink">v{st.info.version} ready</span>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => api.install())}>
              Restart &amp; install
            </Button>
          </>
        )}
        {phase === 'error' && <span className="text-danger">Update failed</span>}
        {(phase === 'idle' || phase === 'up-to-date' || phase === 'error') && (
          <Button size="sm" variant="default" disabled={busy} onClick={() => void run(() => api.check())}>
            Check for updates
          </Button>
        )}
      </div>
      {phase === 'downloading' && st && 'percent' in st && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/10">
          <div className="h-full rounded-full bg-accent" style={{ width: `${st.percent}%` }} />
        </div>
      )}
      {phase === 'error' && st && 'message' in st && (
        <div className="max-h-24 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-danger/30 bg-danger/5 p-2 font-mono text-[11px] leading-snug text-danger">
          {st.message}
        </div>
      )}
    </div>
  );
}

function HookBadge({ status }: { status: HookStatus | null }) {
  if (!status) return <span className="text-xs text-subtle">Checking…</span>;
  const ok = status.fullyInstalled;
  const partial = !ok && (status.scriptInstalled || status.registeredEvents.length > 0);
  const label = ok ? 'Installed' : partial ? 'Partial' : 'Not installed';
  const dot = ok ? 'bg-success' : partial ? 'bg-warning' : 'bg-subtle';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={
        ok
          ? `Hook installed (${status.registeredEvents.join(', ')})`
          : partial
            ? `Partially installed — registered: ${status.registeredEvents.join(', ') || 'none'}`
            : 'Hook not installed'
      }
    >
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} />
      {label}
    </span>
  );
}

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-subtle">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="accent-accent"
      />
      <span className="text-ink">{label}</span>
    </label>
  );
}

function TimeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'rounded-md border border-edge/10 bg-sunken px-2 py-1 font-mono text-xs text-ink',
        'focus:border-accent/60 focus:outline-none',
        disabled && 'opacity-40',
      )}
    />
  );
}

function PathRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 font-mono text-xs text-muted">{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onChange(draft);
        }}
        placeholder="(auto)"
        className="flex-1 rounded-md border border-edge/10 bg-sunken px-2 py-1.5 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
      />
    </div>
  );
}
