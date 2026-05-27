'use client';

import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';

export function CenterPane() {
  const session = useSessionsStore(selectActiveSession);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center text-muted">
          <p className="text-sm">No session selected.</p>
          <p className="mt-2 text-xs">
            Click a session card on the left, or hit{' '}
            <kbd className="font-mono text-ink">⌘T</kbd> to start a new one.
          </p>
        </div>
      </div>
    );
  }

  // M3 placeholder — the real xterm terminal mounts here in M5.
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted">
      <div className="font-mono text-xs">
        terminal mount for{' '}
        <span className="text-ink">{session.displayName}</span> →
      </div>
      <div className="mt-1 text-[11px]">wired in M5</div>
    </div>
  );
}
