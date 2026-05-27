'use client';

import { useCallback, useEffect, useState } from 'react';
import { Terminal } from './components/Terminal';

interface SpawnSpec {
  label: string;
  shell: string;
  args: string[];
}

const SPAWN_OPTIONS: SpawnSpec[] = [
  { label: 'Spawn /bin/bash', shell: '/bin/bash', args: ['-l'] },
  { label: 'Spawn claude', shell: '/Users/leecoor/.local/bin/claude', args: [] },
  { label: 'Spawn codex', shell: '/Users/leecoor/.nvm/versions/node/v24.12.0/bin/codex', args: [] },
];

export default function HomePage() {
  const [version, setVersion] = useState<string>('—');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVersion(window.agentDashboard?.version ?? '—');
  }, []);

  const spawn = useCallback(async (spec: SpawnSpec) => {
    if (!window.agentDashboard) return;
    setPending(true);
    setError(null);
    try {
      const id = await window.agentDashboard.pty.spawn({
        shell: spec.shell,
        args: spec.args,
        cwd: process.env.HOME ?? '/Users/leecoor',
        cols: 120,
        rows: 32,
      });
      setSessionId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  const closeSession = useCallback(async () => {
    if (!sessionId || !window.agentDashboard) return;
    await window.agentDashboard.pty.kill(sessionId);
    setSessionId(null);
  }, [sessionId]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          Agent Dashboard <span className="version">v{version}</span>
        </div>
        <div className="buttons">
          {SPAWN_OPTIONS.map((spec) => (
            <button
              key={spec.label}
              onClick={() => void spawn(spec)}
              disabled={pending || sessionId !== null}
            >
              {spec.label}
            </button>
          ))}
          {sessionId && (
            <button className="danger" onClick={() => void closeSession()}>
              Kill session
            </button>
          )}
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      <main className="terminal-area">
        {sessionId ? (
          <Terminal sessionId={sessionId} />
        ) : (
          <div className="placeholder">
            <p>No session.</p>
            <p className="hint-text">
              Click a Spawn button above. M1 success = Claude / Codex render correctly,
              accept input, and exit cleanly.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
