'use client';

import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { EMPTY_PANEL, useActivePanel, useUIStore } from '../../lib/stores/ui-store';
import { useSessionsStore } from '../../lib/stores/sessions-store';
import { useSessionBridge } from '../../lib/hooks/use-session-bridge';
import { useKeyboardShortcuts } from '../../lib/hooks/use-keyboard-shortcuts';
import { useSoundEffects } from '../../lib/hooks/use-sound-effects';
import { useTheme } from '../../lib/hooks/use-theme';
import { useAnimatedMount } from '../../lib/hooks/use-animated-mount';
import { Sidebar } from './Sidebar';
import { SessionHeader } from './SessionHeader';
import { CenterPane } from './CenterPane';
import { UsageView } from './UsageView';
import { Panel } from './Panel';
import { StatusBar } from './StatusBar';
import { DragHandle } from './DragHandle';
import { NewSessionModal } from './NewSessionModal';
import { HookSetupModal } from './HookSetupModal';
import { Toast } from '../../components/ui/Toast';
import { SettingsView } from './SettingsView';
import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const usageOpen = useUIStore((s) => s.usageOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const panels = useUIStore((s) => s.panels);
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

  // Dock panels are per-session. The active session's panel drives the
  // open/close + sizing of the docks; every other session's panel stays
  // mounted but hidden so its content (notably a terminal's live process)
  // survives a switch-away-and-back.
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const activePanel = useActivePanel();

  useSessionBridge();
  useKeyboardShortcuts();
  useSoundEffects();
  useTheme();

  // Tell main which session the user is viewing, so it can stay silent for the
  // session you're already watching (sound only for background / other sessions).
  useEffect(() => {
    void window.agentDashboard?.sessions?.setActive(activeId);
  }, [activeId]);

  // Forget panel state for sessions that no longer exist (their <Panel> also
  // unmounts below, tearing down any PTY).
  useEffect(() => {
    useUIStore.getState().prunePanels(Object.keys(sessions));
  }, [sessions]);

  // Keep the sidebar mounted during its close transition so it shrinks
  // instead of snapping out — see use-animated-mount.
  const leftMounted = useAnimatedMount(!leftCollapsed);

  // Hide = collapse but keep the active session's panel (and its running
  // process) alive. Switch = tear down its content and return to the picker.
  // Both act on the active session via the store.
  const closeRight = (): void => setRightPanelOpen(false);
  const closeBottom = (): void => setBottomPanelOpen(false);
  const switchRight = (): void => setRightPanelKind(null);
  const switchBottom = (): void => setBottomPanelKind(null);

  // Sessions whose panel must be in the DOM: anyone with a chosen kind (keep it
  // alive), plus the active session when its panel is open but empty (so the
  // picker shows). Only the active session's panel is ever visible.
  const sessionIds = Object.keys(sessions);
  const rightIds = sessionIds.filter(
    (id) => panels[id]?.rightKind != null || (id === activeId && activePanel.rightOpen),
  );
  const bottomIds = sessionIds.filter(
    (id) => panels[id]?.bottomKind != null || (id === activeId && activePanel.bottomOpen),
  );

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
            <main className="relative flex-1 min-w-0 min-h-0">
              <ErrorBoundary label="Terminal">
                <CenterPane />
              </ErrorBoundary>
              {usageOpen && (
                <ErrorBoundary label="Usage">
                  <UsageView />
                </ErrorBoundary>
              )}
              {settingsOpen && (
                <ErrorBoundary label="Settings">
                  <SettingsView />
                </ErrorBoundary>
              )}
            </main>
            {activePanel.rightOpen && (
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
                !activePanel.rightOpen && 'border-l-0',
              )}
              style={{ width: activePanel.rightOpen ? rightPanelWidth : 0 }}
            >
              {rightIds.map((id) => {
                const isActive = id === activeId;
                const kind = (panels[id] ?? EMPTY_PANEL).rightKind;
                return (
                  <div
                    key={id}
                    className="h-full w-full"
                    style={{ display: isActive ? undefined : 'none' }}
                  >
                    <ErrorBoundary label="Right panel">
                      <Panel
                        position="right"
                        kind={kind}
                        cwd={sessions[id]?.cwd}
                        visible={isActive && activePanel.rightOpen}
                        onPick={setRightPanelKind}
                        onClose={closeRight}
                        onSwitch={switchRight}
                      />
                    </ErrorBoundary>
                  </div>
                );
              })}
            </aside>
          </div>
          {activePanel.bottomOpen && (
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
              !activePanel.bottomOpen && 'border-t-0',
            )}
            style={{ height: activePanel.bottomOpen ? bottomPanelHeight : 0 }}
          >
            {bottomIds.map((id) => {
              const isActive = id === activeId;
              const kind = (panels[id] ?? EMPTY_PANEL).bottomKind;
              return (
                <div
                  key={id}
                  className="h-full w-full"
                  style={{ display: isActive ? undefined : 'none' }}
                >
                  <ErrorBoundary label="Bottom panel">
                    <Panel
                      position="bottom"
                      kind={kind}
                      cwd={sessions[id]?.cwd}
                      visible={isActive && activePanel.bottomOpen}
                      onPick={setBottomPanelKind}
                      onClose={closeBottom}
                      onSwitch={switchBottom}
                    />
                  </ErrorBoundary>
                </div>
              );
            })}
          </section>
          <StatusBar />
        </div>
      </div>
      <NewSessionModal />
      <HookSetupModal />
      <Toast />
    </>
  );
}
