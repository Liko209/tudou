'use client';

import { Button } from '../../components/ui/Button';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionsStore } from '../../lib/stores/sessions-store';

interface ToolbarProps {
  version: string;
}

export function Toolbar({ version }: ToolbarProps) {
  const toggleSides = useUIStore((s) => s.toggleSides);
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);
  const sessionCount = useSessionsStore((s) => Object.keys(s.sessions).length);

  return (
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
          onClick={() => useUIStore.getState().setHookModalOpen(true)}
          title="Hook setup"
        >
          Hook
        </Button>
        <Button size="sm" variant="ghost" onClick={toggleSides} title="Toggle sidebars (⌘\)">
          ⇔
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setNewSessionOpen(true)}
          title="New session (⌘T)"
        >
          + New
        </Button>
      </div>
    </header>
  );
}
