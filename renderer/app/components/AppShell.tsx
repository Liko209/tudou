'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionBridge } from '../../lib/hooks/use-session-bridge';
import { useKeyboardShortcuts } from '../../lib/hooks/use-keyboard-shortcuts';
import { Toolbar } from './Toolbar';
import { SessionList } from './SessionList';
import { SidePanel } from './SidePanel';
import { CenterPane } from './CenterPane';
import { NewSessionModal } from './NewSessionModal';
import { ResumeBanner } from './ResumeBanner';
import { HookSetupModal } from './HookSetupModal';
import { SettingsModal } from './SettingsModal';
import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const rightCollapsed = useUIStore((s) => s.rightCollapsed);
  const [version, setVersion] = useState('—');

  useSessionBridge();
  useKeyboardShortcuts();

  useEffect(() => {
    setVersion(window.agentDashboard?.version ?? '—');
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar version={version} />
      <ResumeBanner />
      <div className="flex flex-1 min-h-0">
        <aside
          className={cn(
            'shrink-0 overflow-y-auto border-r border-edge/10 bg-sunken transition-[width] duration-150 ease-out',
            leftCollapsed ? 'w-0' : 'w-[220px]',
          )}
        >
          <ErrorBoundary label="Session list">
            <SessionList />
          </ErrorBoundary>
        </aside>
        <main className="flex-1 min-w-0 min-h-0 bg-canvas">
          <ErrorBoundary label="Terminal">
            <CenterPane />
          </ErrorBoundary>
        </main>
        <aside
          className={cn(
            'shrink-0 overflow-y-auto border-l border-edge/10 bg-sunken transition-[width] duration-150 ease-out',
            rightCollapsed ? 'w-0' : 'w-[260px]',
          )}
        >
          <ErrorBoundary label="Side panel">
            <SidePanel />
          </ErrorBoundary>
        </aside>
      </div>
      <NewSessionModal />
      <HookSetupModal />
      <SettingsModal />
    </div>
  );
}
