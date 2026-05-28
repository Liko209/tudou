'use client';

import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionsStore } from '../../lib/stores/sessions-store';
import type { CliKind } from '../../../shared/ipc-contracts';

interface ToolbarProps {
  version: string;
}

export function Toolbar({ version }: ToolbarProps) {
  const toggleSides = useUIStore((s) => s.toggleSides);
  const sessionCount = useSessionsStore((s) => Object.keys(s.sessions).length);
  const [pending, setPending] = useState<CliKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // M4 temp UI — spawn directly into $HOME with no picker. The real New
  // Session modal arrives in M5 (F5.5).
  const spawn = useCallback(async (cli: CliKind) => {
    const api = window.agentDashboard?.sessions;
    const env = window.agentDashboard?.env;
    if (!api || !env) return;
    setPending(cli);
    setError(null);
    try {
      await api.spawn({
        cli,
        cwd: env.homedir(),
        cols: 120,
        rows: 32,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <>
      <header className="titlebar-drag flex h-11 items-center justify-between border-b border-edge/10 bg-surface pl-[80px] pr-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Agent Dashboard</span>
          <span className="text-xs text-subtle">v{version}</span>
          <span className="text-xs text-muted">·</span>
          <span className="text-xs text-muted">{sessionCount} sessions</span>
        </div>
        <div className="titlebar-no-drag flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleSides}
            title="Toggle sidebars (⌘\)"
          >
            ⇔
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void spawn('claude')}
            disabled={pending !== null}
          >
            {pending === 'claude' ? 'spawning…' : '+ Claude'}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void spawn('codex')}
            disabled={pending !== null}
          >
            {pending === 'codex' ? 'spawning…' : '+ Codex'}
          </Button>
        </div>
      </header>
      {error && (
        <div className="bg-danger/15 text-danger px-4 py-1.5 font-mono text-xs">
          {error}
        </div>
      )}
    </>
  );
}
