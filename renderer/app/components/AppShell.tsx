'use client';

import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { useSessionBridge } from '../../lib/hooks/use-session-bridge';
import { useKeyboardShortcuts } from '../../lib/hooks/use-keyboard-shortcuts';
import { useTheme } from '../../lib/hooks/use-theme';
import { useAnimatedMount } from '../../lib/hooks/use-animated-mount';
import { Sidebar } from './Sidebar';
import { SessionHeader } from './SessionHeader';
import { CenterPane } from './CenterPane';
import { Panel } from './Panel';
import { StatusBar } from './StatusBar';
import { DragHandle } from './DragHandle';
import { NewSessionModal } from './NewSessionModal';
import { HookSetupModal } from './HookSetupModal';
import { Toast } from '../../components/ui/Toast';
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
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const bottomPanelHeight = useUIStore((s) => s.bottomPanelHeight);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const setBottomPanelHeight = useUIStore((s) => s.setBottomPanelHeight);

  useSessionBridge();
  useKeyboardShortcuts();
  useTheme();

  // Keep children mounted during the close transition so the panel
  // visibly shrinks instead of snapping out — see use-animated-mount.
  // Dock panels additionally stay mounted whenever a kind is selected, even
  // while hidden: that keeps the terminal's PTY (and any process running in
  // it) alive so hiding → reopening restores the exact same session instead
  // of killing it and dropping back to the picker.
  const leftMounted = useAnimatedMount(!leftCollapsed);
  const rightMounted = useAnimatedMount(rightPanelOpen) || rightPanelKind !== null;
  const bottomMounted = useAnimatedMount(bottomPanelOpen) || bottomPanelKind !== null;

  // Hide = collapse but keep the panel (and its running process) alive.
  const closeRight = (): void => setRightPanelOpen(false);
  const closeBottom = (): void => setBottomPanelOpen(false);
  // Switch = tear down the current panel and return to the picker. This is the
  // explicit, destructive action (it ends a running terminal).
  const switchRight = (): void => setRightPanelKind(null);
  const switchBottom = (): void => setBottomPanelKind(null);

  return (
    <>
      <div className="flex h-screen bg-canvas">
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-r border-edge/10 bg-sunken',
            'transition-[width] duration-200 ease-out',
          )}
          style={{ width: leftCollapsed ? 0 : sidebarWidth }}
        >
          {leftMounted && (
            <ErrorBoundary label="Sidebar">
              <Sidebar />
            </ErrorBoundary>
          )}
        </aside>
        {leftMounted && !leftCollapsed && (
          <DragHandle orientation="vertical" current={sidebarWidth} onChange={setSidebarWidth} />
        )}
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          <ErrorBoundary label="Session header">
            <SessionHeader />
          </ErrorBoundary>
          <div className="flex flex-1 min-w-0 min-h-0">
            <main className="flex-1 min-w-0 min-h-0">
              <ErrorBoundary label="Terminal">
                <CenterPane />
              </ErrorBoundary>
            </main>
            {rightMounted && rightPanelOpen && (
              <DragHandle
                orientation="vertical"
                current={rightPanelWidth}
                onChange={setRightPanelWidth}
                sign={-1}
              />
            )}
            <aside
              className={cn(
                'shrink-0 overflow-hidden border-l border-edge/10 bg-canvas',
                'transition-[width] duration-200 ease-out',
                !rightPanelOpen && 'border-l-0',
              )}
              style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
            >
              {rightMounted && (
                <ErrorBoundary label="Right panel">
                  <Panel
                    position="right"
                    kind={rightPanelKind}
                    onPick={setRightPanelKind}
                    onClose={closeRight}
                    onSwitch={switchRight}
                  />
                </ErrorBoundary>
              )}
            </aside>
          </div>
          {bottomMounted && bottomPanelOpen && (
            <DragHandle
              orientation="horizontal"
              current={bottomPanelHeight}
              onChange={setBottomPanelHeight}
              sign={-1}
            />
          )}
          <section
            className={cn(
              'shrink-0 overflow-hidden border-t border-edge/10 bg-canvas',
              'transition-[height] duration-200 ease-out',
              !bottomPanelOpen && 'border-t-0',
            )}
            style={{ height: bottomPanelOpen ? bottomPanelHeight : 0 }}
          >
            {bottomMounted && (
              <ErrorBoundary label="Bottom panel">
                <Panel
                  position="bottom"
                  kind={bottomPanelKind}
                  onPick={setBottomPanelKind}
                  onClose={closeBottom}
                  onSwitch={switchBottom}
                />
              </ErrorBoundary>
            )}
          </section>
          <StatusBar />
        </div>
      </div>
      <NewSessionModal />
      <HookSetupModal />
      <SettingsModal />
      <Toast />
    </>
  );
}
