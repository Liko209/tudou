'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionBridge } from '../../lib/hooks/use-session-bridge';
import { Toolbar } from './Toolbar';
import { SessionList } from './SessionList';
import { SidePanel } from './SidePanel';
import { CenterPane } from './CenterPane';

export function AppShell() {
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const rightCollapsed = useUIStore((s) => s.rightCollapsed);
  const toggleSides = useUIStore((s) => s.toggleSides);
  const [version, setVersion] = useState('—');

  // Live wire: keep the Zustand store in sync with SessionRegistry over IPC.
  useSessionBridge();

  useEffect(() => {
    setVersion(window.agentDashboard?.version ?? '—');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === '\\') {
        e.preventDefault();
        toggleSides();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSides]);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar version={version} />
      <div className="flex flex-1 min-h-0">
        <aside
          className={cn(
            'shrink-0 overflow-y-auto border-r border-edge/10 bg-sunken transition-[width] duration-150 ease-out',
            leftCollapsed ? 'w-0' : 'w-[220px]',
          )}
        >
          <SessionList />
        </aside>
        <main className="flex-1 min-w-0 min-h-0 bg-canvas">
          <CenterPane />
        </main>
        <aside
          className={cn(
            'shrink-0 overflow-y-auto border-l border-edge/10 bg-sunken transition-[width] duration-150 ease-out',
            rightCollapsed ? 'w-0' : 'w-[260px]',
          )}
        >
          <SidePanel />
        </aside>
      </div>
    </div>
  );
}
