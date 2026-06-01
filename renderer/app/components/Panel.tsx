'use client';

import { useMemo } from 'react';
import { LayoutGrid, PanelBottomClose, PanelRightClose } from 'lucide-react';
import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import type { PanelKind } from '../../lib/stores/ui-store';
import { PanelPicker } from './PanelPicker';
import { ShellTerminal } from './ShellTerminal';
import { FilesPanel } from './FilesPanel';
import { SideChatPanel } from './SideChatPanel';

interface PanelProps {
  kind: PanelKind | null;
  onPick: (kind: PanelKind) => void;
  /** Hide the panel but keep it (and any running process) alive. */
  onClose: () => void;
  /** Tear down the panel and return to the picker (ends a running terminal). */
  onSwitch: () => void;
  position: 'right' | 'bottom';
}

/**
 * Generic dock panel slot. Empty → picker; with a kind → renders the matching
 * content component. The header's "hide" button only collapses the panel —
 * the slot stays mounted (see AppShell) so a terminal's process survives — and
 * a separate "change panel" button returns to the picker.
 */
export function Panel({ kind, onPick, onClose, onSwitch, position }: PanelProps) {
  const activeCwd = useSessionsStore((s) => selectActiveSession(s)?.cwd ?? null);
  const cwd = useMemo(() => activeCwd ?? undefined, [activeCwd]);

  if (kind === null) {
    return <PanelPicker onPick={onPick} onClose={onClose} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader label={LABEL[kind]} onClose={onClose} onSwitch={onSwitch} position={position} />
      <div className="min-h-0 flex-1">
        {kind === 'terminal' && <ShellTerminal cwd={cwd} />}
        {kind === 'files' && <FilesPanel />}
        {kind === 'sidechat' && <SideChatPanel />}
      </div>
    </div>
  );
}

const LABEL: Record<PanelKind, string> = {
  files: 'Files',
  sidechat: 'Side chat',
  terminal: 'Terminal',
};

function PanelHeader({
  label,
  onClose,
  onSwitch,
  position,
}: {
  label: string;
  onClose: () => void;
  onSwitch: () => void;
  position: 'right' | 'bottom';
}) {
  const HideIcon = position === 'bottom' ? PanelBottomClose : PanelRightClose;
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge/5 bg-surface/60 px-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
      <span>{label}</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onSwitch}
          aria-label="Change panel"
          title="Change panel (ends a running terminal)"
          className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
        >
          <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide panel"
          title="Hide panel — keeps it running"
          className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
        >
          <HideIcon className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

