'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';

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

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const api = window.agentDashboard?.preferences;
    if (!api) return;
    void api.get().then(setPrefs);
  }, [open]);

  const save = useCallback(
    async (next: Preferences) => {
      const api = window.agentDashboard?.preferences;
      if (!api) return;
      setSaving(true);
      try {
        const stored = await api.set(next);
        setPrefs(stored);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const reset = useCallback(async () => {
    if (!window.confirm('Reset all preferences to defaults?')) return;
    const api = window.agentDashboard?.preferences;
    if (!api) return;
    const next = await api.reset();
    setPrefs(next);
  }, []);

  const clearSessions = useCallback(async () => {
    if (
      !window.confirm(
        'Drop all persisted session records? Currently-running sessions are unaffected; you just lose the "Last time you had X sessions" prompt on next launch.',
      )
    ) {
      return;
    }
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
        <Section title="Notifications">
          <CheckRow
            checked={prefs.notifications.systemNotification}
            onToggle={(v) =>
              void save({
                ...prefs,
                notifications: { ...prefs.notifications, systemNotification: v },
              })
            }
            label="macOS system notification"
            hint="Banner pops when a session enters 'waiting for input'."
          />
          <CheckRow
            checked={prefs.notifications.dockBadge}
            onToggle={(v) =>
              void save({
                ...prefs,
                notifications: { ...prefs.notifications, dockBadge: v },
              })
            }
            label="Dock badge"
            hint="Red number on the Dock icon = how many sessions are waiting."
          />
          <CheckRow
            checked={prefs.notifications.tray}
            onToggle={(v) =>
              void save({
                ...prefs,
                notifications: { ...prefs.notifications, tray: v },
              })
            }
            label="Menubar (tray) badge"
            hint="Live count next to the tray icon. The menu itself stays available either way."
          />
          <CheckRow
            checked={prefs.notifications.sound}
            onToggle={(v) =>
              void save({
                ...prefs,
                notifications: { ...prefs.notifications, sound: v },
              })
            }
            label="Notification sound"
            hint="Plays only when the dashboard is in the background."
          />
        </Section>

        <Section title="Quiet hours">
          <CheckRow
            checked={prefs.quietHours.enabled}
            onToggle={(v) =>
              void save({ ...prefs, quietHours: { ...prefs.quietHours, enabled: v } })
            }
            label="Suppress system notifications during a daily window"
          />
          <div className="flex items-center gap-3 pl-6 text-xs text-muted">
            <span>From</span>
            <TimeInput
              value={prefs.quietHours.start}
              disabled={!prefs.quietHours.enabled}
              onChange={(v) =>
                void save({ ...prefs, quietHours: { ...prefs.quietHours, start: v } })
              }
            />
            <span>to</span>
            <TimeInput
              value={prefs.quietHours.end}
              disabled={!prefs.quietHours.enabled}
              onChange={(v) =>
                void save({ ...prefs, quietHours: { ...prefs.quietHours, end: v } })
              }
            />
            <span className="text-subtle">(24h, local time; overnight windows OK)</span>
          </div>
        </Section>

        <Section title="CLI binary overrides">
          <p className="text-xs text-muted">
            Leave blank to auto-detect via your login shell's <span className="font-mono">PATH</span>.
            Set an absolute path here only if you want to pin a specific version.
          </p>
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

        <Section title="Hook">
          <p className="text-xs text-muted">
            Hook gives waiting-state notifications a sub-3s SLA. Open the dedicated dialog to
            install, uninstall, or view manual setup.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              setOpen(false);
              openHookModal(true);
            }}
          >
            Open Hook setup…
          </Button>
        </Section>

        <Section title="Data">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => void reset()}>
              Reset preferences
            </Button>
            <Button size="sm" variant="danger" onClick={() => void clearSessions()}>
              Clear session history
            </Button>
          </div>
        </Section>

        <div className="flex justify-end">
          <Button size="md" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{title}</div>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 accent-accent"
      />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      </span>
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
