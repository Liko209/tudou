'use client';

import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionBridge } from '../../lib/hooks/use-session-bridge';
import { useKeyboardShortcuts } from '../../lib/hooks/use-keyboard-shortcuts';
import { Sidebar } from './Sidebar';
import { SessionHeader } from './SessionHeader';
import { CenterPane } from './CenterPane';
import { Panel } from './Panel';
import { NewSessionModal } from './NewSessionModal';
import { ResumeBanner } from './ResumeBanner';
import { HookSetupModal } from './HookSetupModal';
import { SettingsModal } from './SettingsModal';
import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen);
  const rightPanelKind = useUIStore((s) => s.rightPanelKind);
  const bottomPanelKind = useUIStore((s) => s.bottomPanelKind);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const setRightPanelKind = useUIStore((s) => s.setRightPanelKind);
  const setBottomPanelOpen = useUIStore((s) => s.setBottomPanelOpen);
  const setBottomPanelKind = useUIStore((s) => s.setBottomPanelKind);

  useSessionBridge();
  useKeyboardShortcuts();

  const closeRight = (): void => {
    setRightPanelOpen(false);
    setRightPanelKind(null);
  };
  const closeBottom = (): void => {
    setBottomPanelOpen(false);
    setBottomPanelKind(null);
  };

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="titlebar-drag h-7 shrink-0 border-b border-edge/5 bg-surface" />
      <div className="flex flex-1 min-h-0">
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-r border-edge/10 bg-sunken transition-[width] duration-150 ease-out',
            leftCollapsed ? 'w-0' : 'w-[240px]',
          )}
        >
          <ErrorBoundary label="Sidebar">
            <Sidebar />
          </ErrorBoundary>
        </aside>
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          <ErrorBoundary label="Session header">
            <SessionHeader />
          </ErrorBoundary>
          <ResumeBanner />
          <div className="flex flex-1 min-w-0 min-h-0">
            <main className="flex-1 min-w-0 min-h-0">
              <ErrorBoundary label="Terminal">
                <CenterPane />
              </ErrorBoundary>
            </main>
            {rightPanelOpen && (
              <aside className="w-[360px] shrink-0 border-l border-edge/10 bg-canvas">
                <ErrorBoundary label="Right panel">
                  <Panel
                    position="right"
                    kind={rightPanelKind}
                    onPick={setRightPanelKind}
                    onClose={closeRight}
                  />
                </ErrorBoundary>
              </aside>
            )}
          </div>
          {bottomPanelOpen && (
            <section className="h-[260px] shrink-0 border-t border-edge/10 bg-canvas">
              <ErrorBoundary label="Bottom panel">
                <Panel
                  position="bottom"
                  kind={bottomPanelKind}
                  onPick={setBottomPanelKind}
                  onClose={closeBottom}
                />
              </ErrorBoundary>
            </section>
          )}
        </div>
      </div>
      <NewSessionModal />
      <HookSetupModal />
      <SettingsModal />
    </div>
  );
}
