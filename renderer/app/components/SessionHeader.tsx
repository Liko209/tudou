'use client';

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { StatusDot } from './StatusDot';
import { InfoSheet } from './InfoSheet';

/**
 * Top bar over the main pane. Shows the active session's status / name /
 * cwd at the left and panel-toggle / info-toggle actions at the right.
 *
 * Panel toggles are wired in P2 (right + bottom dock); ⓘ already works.
 */
export function SessionHeader() {
  const active = useSessionsStore(selectActiveSession);
  const [infoOpen, setInfoOpen] = useState(false);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const setBottomPanelOpen = useUIStore((s) => s.setBottomPanelOpen);

  return (
    <header className="titlebar-drag flex h-9 shrink-0 items-center gap-2 border-b border-edge/10 bg-surface pl-3 pr-2 text-xs">
      {active ? (
        <>
          <StatusDot status={active.status} confidence={active.statusConfidence} />
          <span className="text-ink font-medium">{active.displayName}</span>
          <span className="text-subtle">·</span>
          <span className="truncate font-mono text-muted">{active.cwd}</span>
        </>
      ) : (
        <span className="text-muted">No session selected</span>
      )}

      <div className="titlebar-no-drag ml-auto flex items-center gap-1">
        <HeaderIconButton
          active={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          title="Session details"
          disabled={!active}
        >
          ⓘ
        </HeaderIconButton>
        <HeaderIconButton
          active={bottomPanelOpen}
          onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
          title="Toggle bottom panel"
        >
          ▭
        </HeaderIconButton>
        <HeaderIconButton
          active={rightPanelOpen}
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          title="Toggle right panel"
        >
          ▣
        </HeaderIconButton>
      </div>

      {active && <InfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} session={active} />}
    </header>
  );
}

function HeaderIconButton({
  children,
  onClick,
  title,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded text-sm text-muted',
        'hover:bg-canvas hover:text-ink',
        active && 'bg-canvas text-ink',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}
