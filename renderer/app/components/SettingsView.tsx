'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Loader2, Plus, Trash2, Volume2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { useUIStore, type ThemeChoice } from '../../lib/stores/ui-store';
import { playCue } from '../../lib/sound';
import type { SoundKind } from '../../../shared/ipc-contracts';
import { SOUND_OPTIONS, SOUND_OFF } from '../../../shared/sound-catalog';
import { pickProxyUrl, SUGGESTED_ENV_KEYS } from '../../../shared/network-env';
import { PageHeader, PAGE_WIDTH } from './PageView';

interface HookStatus {
  scriptInstalled: boolean;
  registeredEvents: string[];
  fullyInstalled: boolean;
}

type SectionId =
  | 'general'
  | 'notifications'
  | 'integrations'
  | 'network'
  | 'updates'
  | 'data';
const NAV: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'CLI & Hooks' },
  { id: 'network', label: 'Network' },
  { id: 'updates', label: 'Updates' },
  { id: 'data', label: 'Data' },
];

interface CustomEnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

interface Preferences {
  notifications: {
    systemNotification: boolean;
    dockBadge: boolean;
    tray: boolean;
    soundCompleteId: string;
    soundAlertId: string;
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
  network: {
    customEnv: CustomEnvVar[];
  };
}

/**
 * Full-screen Settings page (sibling of the Usage view), rendered over the
 * center pane. The left column is an anchor nav: clicking a section scrolls it
 * into view and the active item tracks the scroll position. Everything lives on
 * one scrollable page rather than behind tab swaps, so the user can see the
 * whole config at a glance.
 */
export function SettingsView() {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const openHookModal = useUIStore((s) => s.setHookModalOpen);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [hookBusy, setHookBusy] = useState(false);
  const [active, setActive] = useState<SectionId>('general');

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement>>>({});

  // Switching theme updates the chrome immediately, but the terminal palette is
  // fixed at launch — so prompt for a restart (the user can defer).
  const pickTheme = (t: ThemeChoice): void => {
    if (t === theme) return;
    setTheme(t);
    setConfirmRestart(true);
  };

  useEffect(() => {
    const api = window.agentDashboard?.preferences;
    if (api) void api.get().then(setPrefs);
    void window.agentDashboard?.hooks?.getStatus().then(setHookStatus);
  }, []);

  // Scrollspy: highlight the nav item whose section is nearest the top of the
  // scroll viewport. IntersectionObserver rooted on the scroll container.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const visible = new Map<SectionId, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.getAttribute('data-section') as SectionId | null;
          if (!id) continue;
          if (e.isIntersecting) visible.set(id, e.intersectionRatio);
          else visible.delete(id);
        }
        let best: SectionId | null = null;
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        if (best) setActive(best);
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const el of Object.values(sectionRefs.current)) if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [prefs]);

  const scrollTo = useCallback((id: SectionId) => {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const registerSection = useCallback(
    (id: SectionId) => (el: HTMLElement | null) => {
      if (el) sectionRefs.current[id] = el;
      else delete sectionRefs.current[id];
    },
    [],
  );

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
    const stored = await api.set(next);
    setPrefs(stored);
  }, []);

  const doReset = useCallback(async () => {
    setConfirmReset(false);
    const api = window.agentDashboard?.preferences;
    if (!api) return;
    setPrefs(await api.reset());
  }, []);

  const doClearSessions = useCallback(async () => {
    setConfirmClear(false);
    await window.agentDashboard?.preferences.clearSessions();
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-canvas">
      <PageHeader title="Settings" onClose={() => setOpen(false)} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className={cn(PAGE_WIDTH, 'flex gap-8')}>
          <nav className="sticky top-0 hidden h-fit w-44 shrink-0 flex-col gap-0.5 sm:flex">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => scrollTo(n.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                  active === n.id
                    ? 'bg-accent/10 font-medium text-ink'
                    : 'text-muted hover:bg-surface/60 hover:text-ink',
                )}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {!prefs ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : (
              <>
                <Group id="general" title="Appearance" register={registerSection('general')}>
                  <p className="text-xs text-subtle">
                    Pick a theme. Restart to fully apply — running terminals keep their colors
                    until then.
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-2 sm:max-w-sm">
                    {(['dark', 'light'] as ThemeChoice[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => pickTheme(t)}
                        className={cn(
                          'rounded-md border px-3 py-2 text-sm capitalize transition-colors',
                          theme === t
                            ? 'border-accent/60 bg-accent/10 text-ink'
                            : 'border-edge/10 bg-sunken text-muted hover:border-edge/30',
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </Group>

                <Group
                  id="notifications"
                  title="Notifications"
                  register={registerSection('notifications')}
                >
                  <div className="flex flex-col gap-0.5">
                    <CheckRow
                      checked={prefs.notifications.systemNotification}
                      onToggle={(v) =>
                        void save({
                          ...prefs,
                          notifications: { ...prefs.notifications, systemNotification: v },
                        })
                      }
                      label="System notification"
                      hint="OS banner when a session needs you."
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
                      hint="Unread count on the app icon."
                    />
                    <CheckRow
                      checked={prefs.notifications.tray}
                      onToggle={(v) =>
                        void save({ ...prefs, notifications: { ...prefs.notifications, tray: v } })
                      }
                      label="Menubar badge"
                      hint="Status dot in the macOS menubar."
                    />
                  </div>

                  <Divider />

                  <div className="flex flex-col gap-3">
                    <SoundRow
                      kind="complete"
                      value={prefs.notifications.soundCompleteId}
                      onChange={(v) =>
                        void save({
                          ...prefs,
                          notifications: { ...prefs.notifications, soundCompleteId: v },
                        })
                      }
                      label="Completion sound"
                      hint="When a session finishes and it's your turn."
                    />
                    <SoundRow
                      kind="alert"
                      value={prefs.notifications.soundAlertId}
                      onChange={(v) =>
                        void save({
                          ...prefs,
                          notifications: { ...prefs.notifications, soundAlertId: v },
                        })
                      }
                      label="Attention sound"
                      hint="When a session needs you to authorize or make a choice."
                    />
                    <p className="text-xs text-subtle">
                      Plays when Tudou is in the background, or for any session other than the one
                      you're viewing.
                    </p>
                  </div>

                  <Divider />

                  <CheckRow
                    checked={prefs.quietHours.enabled}
                    onToggle={(v) =>
                      void save({ ...prefs, quietHours: { ...prefs.quietHours, enabled: v } })
                    }
                    label="Quiet hours"
                    hint="Mute notifications during a daily window."
                  />
                  <div
                    className={cn(
                      'flex items-center gap-2 pl-6 text-xs text-muted',
                      !prefs.quietHours.enabled && 'opacity-50',
                    )}
                  >
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
                      onChange={(v) =>
                        void save({ ...prefs, quietHours: { ...prefs.quietHours, end: v } })
                      }
                    />
                  </div>
                </Group>

                <Group
                  id="integrations"
                  title="CLI & Hooks"
                  register={registerSection('integrations')}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                    CLI paths
                  </div>
                  <p className="-mt-1 text-xs text-subtle">Leave blank to auto-detect.</p>
                  <PathRow
                    label="claude"
                    value={prefs.cliPaths.claude ?? ''}
                    onChange={(v) =>
                      void save({ ...prefs, cliPaths: { ...prefs.cliPaths, claude: v.trim() || null } })
                    }
                  />
                  <PathRow
                    label="codex"
                    value={prefs.cliPaths.codex ?? ''}
                    onChange={(v) =>
                      void save({ ...prefs, cliPaths: { ...prefs.cliPaths, codex: v.trim() || null } })
                    }
                  />

                  <Divider />

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                      Hook
                    </span>
                    <HookBadge status={hookStatus} />
                  </div>
                  <p className="-mt-1 text-xs text-subtle">
                    Lets Claude push turn-end / needs-input events to the dashboard for accurate
                    status and notifications. Reinstall after a Claude update or if status looks
                    stuck.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={hookBusy}
                      onClick={() => void reinstallHook()}
                    >
                      {hookBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {hookBusy
                        ? 'Installing…'
                        : hookStatus?.fullyInstalled
                          ? 'Reinstall / update hook'
                          : 'Install hook'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setOpen(false);
                        openHookModal(true);
                      }}
                    >
                      Open hook setup…
                    </Button>
                  </div>
                </Group>

                <Group id="network" title="Network" register={registerSection('network')}>
                  <NetworkSection prefs={prefs} save={save} />
                </Group>

                <Group id="updates" title="Updates" register={registerSection('updates')}>
                  <UpdatesSection />
                </Group>

                <Group id="data" title="Data" register={registerSection('data')}>
                  <p className="text-xs text-subtle">
                    Reset reverts notification, quiet-hours, CLI-path, and network settings to
                    defaults. Clearing history drops persisted session records — running sessions
                    stay alive.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="default" onClick={() => setConfirmReset(true)}>
                      Reset preferences
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                      Clear session history
                    </Button>
                  </div>
                </Group>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset preferences?"
        description="All notification, quiet hours, CLI path, and network settings revert to defaults."
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
      <ConfirmDialog
        open={confirmRestart}
        title="Restart to apply the theme?"
        description="Running terminals keep their current colors until the app restarts, so some UI may look inconsistent until then. You can restart now or later yourself."
        confirmLabel="Restart now"
        cancelLabel="Later"
        onConfirm={() => void window.agentDashboard?.app?.relaunch()}
        onCancel={() => setConfirmRestart(false)}
      />
    </div>
  );
}

type ProxyTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; status: number; ms: number }
  | { phase: 'error'; message: string };

/**
 * Environment variables injected into every spawned CLI — the GUI equivalent of
 * `export HTTPS_PROXY=… && claude`. The dashboard spawns claude/codex as child
 * processes that inherit only its own env, so a user's shell proxy never reaches
 * them otherwise.
 *
 * Edits build up in a local draft; nothing is persisted until the user clicks
 * Save (explicit so it's obvious whether a change took effect). Cancel reverts
 * the draft to what's saved.
 */
export function NetworkSection({
  prefs,
  save,
}: {
  prefs: Preferences;
  save: (next: Preferences) => Promise<void>;
}) {
  const savedKey = JSON.stringify(prefs.network.customEnv);
  const [rows, setRows] = useState<CustomEnvVar[]>(() => JSON.parse(savedKey));
  const [test, setTest] = useState<ProxyTestState>({ phase: 'idle' });
  const [justSaved, setJustSaved] = useState(false);

  // Re-sync the draft whenever the persisted list changes (our own Save, or a
  // global Reset). Keyed on the serialized list so identity churn never wipes an
  // in-progress edit.
  useEffect(() => {
    setRows(JSON.parse(savedKey));
  }, [savedKey]);

  const dirty = JSON.stringify(rows) !== savedKey;

  // Drop the "Saved" confirmation the moment the user edits again.
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  const update = (i: number, patch: Partial<CustomEnvVar>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = (key = '') => setRows((rs) => [...rs, { key, value: '', enabled: true }]);

  // Suggested keys not already in the draft → one-click chips to add them.
  const missing = SUGGESTED_ENV_KEYS.filter(
    (k) => !rows.some((r) => r.key.trim().toUpperCase() === k),
  );

  const onSave = async () => {
    await save({ ...prefs, network: { ...prefs.network, customEnv: rows } });
    setJustSaved(true);
    setTest({ phase: 'idle' });
  };
  const onCancel = () => setRows(JSON.parse(savedKey));

  const proxyUrl = pickProxyUrl(rows);
  const runTest = async () => {
    const api = window.agentDashboard?.network;
    if (!api || !proxyUrl) return;
    setTest({ phase: 'testing' });
    try {
      const r = await api.testProxy({ url: proxyUrl });
      setTest(
        r.ok
          ? { phase: 'ok', status: r.status ?? 0, ms: r.ms ?? 0 }
          : { phase: 'error', message: r.error ?? 'Unreachable' },
      );
    } catch (e) {
      setTest({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-subtle">
        Variables exported into every Claude / Codex session this app launches. Fill in a value to
        apply it — e.g. <code className="text-ink">HTTPS_PROXY</code> ={' '}
        <code className="text-ink">http://127.0.0.1:7890</code>. Empty ones are ignored.
      </p>

      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((v, i) => (
            <EnvVarRow
              key={i}
              entry={v}
              onChange={(patch) => update(i, patch)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {missing.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="inline-flex items-center gap-1 rounded-md border border-edge/10 bg-sunken px-2 py-1 font-mono text-[11px] text-muted hover:border-accent/60 hover:text-ink"
          >
            <Plus className="h-3 w-3" />
            {k}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => add()}>
          <Plus className="h-3.5 w-3.5" />
          Add variable
        </Button>
      </div>

      <Divider />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void onSave()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={onCancel}>
          Cancel
        </Button>
        {dirty ? (
          <span className="text-xs text-warning">Unsaved changes</span>
        ) : justSaved ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" />
            Saved
          </span>
        ) : null}

        <span className="flex-1" />

        <Button
          size="sm"
          variant="default"
          disabled={!proxyUrl || test.phase === 'testing'}
          onClick={() => void runTest()}
          title={proxyUrl ? undefined : 'Fill in an HTTPS_PROXY / HTTP_PROXY value to test'}
        >
          {test.phase === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {test.phase === 'testing' ? 'Testing…' : 'Test proxy'}
        </Button>
        {test.phase === 'ok' && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" />
            {test.status} · {(test.ms / 1000).toFixed(1)}s
          </span>
        )}
        {test.phase === 'error' && (
          <span className="inline-flex items-center gap-1 text-xs text-danger" title={test.message}>
            <X className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[16rem] truncate">{test.message}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** One custom env var: [enabled][KEY]=[value][remove]. Edits the parent draft
 *  directly (no blur commit) — persistence happens on the section's Save. */
function EnvVarRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: CustomEnvVar;
  onChange: (patch: Partial<CustomEnvVar>) => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn('flex items-center gap-2', !entry.enabled && 'opacity-50')}>
      <input
        type="checkbox"
        checked={entry.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        className="accent-accent"
        aria-label="Enable variable"
      />
      <input
        type="text"
        value={entry.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder="KEY"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-40 shrink-0 rounded-md border border-edge/10 bg-sunken px-2 py-1.5 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
      />
      <span className="font-mono text-xs text-subtle">=</span>
      <input
        type="text"
        value={entry.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="value"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="flex-1 rounded-md border border-edge/10 bg-sunken px-2 py-1.5 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove variable"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
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

type UpdateAction = 'check' | 'download' | 'install';

function UpdatesSection() {
  const [st, setSt] = useState<UpdaterState | null>(null);
  // What the user just kicked off — drives an immediate spinner so the button
  // reacts on click instead of waiting for the main process to emit progress
  // (download/install can take a few seconds to actually start).
  const [pending, setPending] = useState<UpdateAction | null>(null);
  const api = typeof window !== 'undefined' ? window.agentDashboard?.updates : undefined;

  useEffect(() => {
    if (!api) return;
    void api.getState().then((s) => setSt(s as UpdaterState));
    return api.onState((s) => setSt(s as UpdaterState));
  }, [api]);

  // Clear the optimistic spinner once the main process reports a phase that
  // makes the kicked-off action's outcome visible on its own.
  useEffect(() => {
    if (!st || !pending) return;
    const phase = st.phase;
    const done =
      (pending === 'check' && phase !== 'checking') ||
      (pending === 'download' && (phase === 'downloading' || phase === 'ready' || phase === 'error')) ||
      (pending === 'install' && phase === 'error');
    if (done) setPending(null);
  }, [st, pending]);

  // Remember the last resolved current version. The transient 'checking' state
  // carries no version, so without this the sub line would vanish mid-check and
  // collapse the box — keeping it holds the layout perfectly still.
  const versionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const v = st && 'currentVersion' in st ? st.currentVersion : undefined;
    if (v) versionRef.current = v;
  }, [st]);

  const trigger = useCallback((action: UpdateAction, fn: () => Promise<void>) => {
    setPending(action);
    void fn().catch(() => setPending(null));
  }, []);

  if (!api) return <p className="text-xs text-subtle">Updates run in the packaged app.</p>;

  const phase = st?.phase ?? 'idle';
  const currentVersion = st && 'currentVersion' in st ? st.currentVersion : undefined;
  const targetVersion = st && 'info' in st ? st.info.version : undefined;
  // Persisted across the version-less 'checking' state (see versionRef above).
  const knownVersion = currentVersion ?? versionRef.current;

  // Headline + sub line. CRUCIAL: title, sub, and the button row are ALWAYS
  // rendered (sub falls back to a non-breaking space) so the card never changes
  // height between idle / checking / up-to-date — only the text + a button
  // spinner change. No layout jitter on "Check for updates".
  const versionLine = knownVersion ? `Current version v${knownVersion}` : ' ';
  let title = '';
  let sub = versionLine;
  if (phase === 'idle') title = knownVersion ? `Tudou v${knownVersion}` : 'Tudou';
  else if (phase === 'checking') title = 'Checking for updates…';
  else if (phase === 'up-to-date') title = "You're on the latest version";
  else if (phase === 'available') {
    title = `Update available — v${targetVersion}`;
    sub = knownVersion ? `You're on v${knownVersion}` : ' ';
  } else if (phase === 'downloading') {
    title = `Downloading v${targetVersion}…`;
    sub = ' ';
  } else if (phase === 'ready') {
    title = `v${targetVersion} ready to install`;
    sub = 'Restart to finish updating.';
  } else if (phase === 'error') {
    title = 'Update failed';
  }

  const percent = st && 'percent' in st ? Math.round(st.percent) : 0;
  const startingDownload = pending === 'download' && phase !== 'downloading';
  const checking = phase === 'checking' || pending === 'check';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <div className={cn('text-sm', phase === 'error' ? 'text-danger' : 'text-ink')}>{title}</div>
        <div className="font-mono text-xs text-subtle">{sub}</div>
      </div>

      {phase === 'downloading' && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between font-mono text-[11px] text-subtle">
            <span>Downloading…</span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {phase === 'error' && st && 'message' in st && (
        <div className="max-h-24 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-danger/30 bg-danger/5 p-2 font-mono text-[11px] leading-snug text-danger">
          {st.message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {phase === 'available' && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending !== null}
            onClick={() => trigger('download', () => api.download())}
          >
            {startingDownload && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {startingDownload ? 'Starting download…' : 'Download update'}
          </Button>
        )}
        {phase === 'ready' && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending !== null}
            onClick={() => trigger('install', () => api.install())}
          >
            {pending === 'install' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending === 'install' ? 'Restarting…' : 'Restart & install'}
          </Button>
        )}
        {(phase === 'idle' || phase === 'up-to-date' || phase === 'error' || phase === 'checking') && (
          <Button
            size="sm"
            variant="default"
            disabled={pending !== null || phase === 'checking'}
            onClick={() => trigger('check', () => api.check())}
          >
            {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        )}
      </div>
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

/** A titled card section with an anchor target for the left nav. */
function Group({
  id,
  title,
  register,
  children,
}: {
  id: SectionId;
  title: string;
  register: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={register}
      data-section={id}
      className="scroll-mt-4 rounded-lg border border-edge/10 bg-surface p-5"
    >
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Divider() {
  return <div className="my-1 h-px w-full bg-edge/10" />;
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
    <label className="flex cursor-pointer items-start gap-2.5 py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 accent-accent"
      />
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

/** Per-cue sound picker: a labeled dropdown (with an Off option) + Preview. */
function SoundRow({
  kind,
  value,
  onChange,
  label,
  hint,
}: {
  kind: SoundKind;
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: string;
}) {
  const isOff = value === SOUND_OFF;
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 shrink-0 rounded-md border border-edge/10 bg-sunken px-2 text-sm text-ink focus:border-accent/60 focus:outline-none"
      >
        <option value={SOUND_OFF}>Off</option>
        {SOUND_OPTIONS[kind].map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => playCue(kind, value)}
        disabled={isOff}
        aria-label={`Preview ${label}`}
        title={isOff ? 'Turned off' : 'Preview'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge/10 text-muted hover:border-accent/60 hover:text-ink disabled:opacity-40 disabled:hover:border-edge/10 disabled:hover:text-muted"
      >
        <Volume2 className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
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
