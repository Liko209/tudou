'use client';

import { useState } from 'react';
import { Info, PanelBottom, PanelLeft, PanelRight, SquarePen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import { selectActiveSession, useSessionsStore } from '../../lib/stores/sessions-store';
import { tildify } from '../../lib/path-helpers';
import { StatusDot } from './StatusDot';
import { InfoSheet } from './InfoSheet';

export function SessionHeader() {
  const active = useSessionsStore(selectActiveSession);
  const [infoOpen, setInfoOpen] = useState(false);
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const toggleLeft = useUIStore((s) => s.toggleLeft);
  const openNewSession = useUIStore((s) => s.openNewSession);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const setBottomPanelOpen = useUIStore((s) => s.setBottomPanelOpen);

  const homeDir =
    typeof window !== 'undefined' ? (window.agentDashboard?.env.homedir() ?? null) : null;

  return (
    <header
      className={cn(
        // When the sidebar is collapsed, macOS traffic lights overlay
        // the header's top-left and would otherwise sit on top of the
        // session info. Push content right to clear them (~14px x +
        // 3 × 12px buttons + 2 × 8px gaps + breathing room ≈ 80px).
        // Transition matches the sidebar's width animation so the
        // shift feels continuous, not a jump.
        'titlebar-drag flex h-12 shrink-0 items-center gap-2 border-b border-edge/10 bg-canvas pr-1.5 text-sm',
        'transition-[padding] duration-200 ease-out',
        leftCollapsed ? 'pl-20' : 'pl-3',
      )}
    >
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <IconButton onClick={toggleLeft} label={leftCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
          <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
        {leftCollapsed && (
          <IconButton onClick={() => openNewSession()} label="New chat">
            <SquarePen className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        )}
      </div>

      {active ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusDot status={active.status} confidence={active.statusConfidence} />
          <span
            className="min-w-0 max-w-[16rem] truncate font-medium text-ink"
            title={active.title || active.displayName}
          >
            {active.title || active.displayName}
          </span>
          <span className="shrink-0 text-subtle">·</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted text-xs" title={active.cwd}>
            {tildify(active.cwd, homeDir)}
          </span>
        </div>
      ) : (
        <span className="flex-1 text-muted">No session selected</span>
      )}

      <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
        <IconButton
          active={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          label="Session details"
          disabled={!active}
        >
          <Info className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton
          active={bottomPanelOpen}
          onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
          label="Toggle bottom panel"
        >
          <PanelBottom className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton
          active={rightPanelOpen}
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          label="Toggle right panel"
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
      </div>

      {active && <InfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} session={active} />}
    </header>
  );
}

interface IconButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

function IconButton({ children, onClick, label, active, disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded text-muted',
        'hover:bg-canvas hover:text-ink',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
        active && 'bg-accent/10 text-accent',
        disabled && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}
