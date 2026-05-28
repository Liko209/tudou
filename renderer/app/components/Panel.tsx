'use client';

import { useMemo } from 'react';
import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import type { PanelKind } from '../../lib/stores/ui-store';
import { PanelPicker } from './PanelPicker';
import { ShellTerminal } from './ShellTerminal';

interface PanelProps {
  kind: PanelKind | null;
  onPick: (kind: PanelKind) => void;
  onClose: () => void;
  position: 'right' | 'bottom';
}

/**
 * Generic dock panel slot. Empty → picker; with a kind → renders the
 * matching content component. Header has the panel label + a ✕ to
 * close the slot (which sets the slot to closed in ui-store).
 */
export function Panel({ kind, onPick, onClose, position }: PanelProps) {
  const activeCwd = useSessionsStore((s) => selectActiveSession(s)?.cwd ?? null);
  const cwd = useMemo(() => activeCwd ?? undefined, [activeCwd]);

  if (kind === null) {
    return <PanelPicker onPick={onPick} onClose={onClose} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader label={LABEL[kind]} onClose={onClose} position={position} />
      <div className="min-h-0 flex-1">
        {kind === 'terminal' && <ShellTerminal cwd={cwd} />}
        {kind === 'files' && (
          <PlaceholderBody name="Files" hint="File-tree browser arrives in P3." />
        )}
        {kind === 'sidechat' && (
          <PlaceholderBody name="Side chat" hint="Docked AI chat arrives in P3." />
        )}
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
}: {
  label: string;
  onClose: () => void;
  position: 'right' | 'bottom';
}) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge/5 bg-surface px-2 text-[10px] uppercase tracking-wider text-subtle">
      <span>{label}</span>
      <button
        type="button"
        onClick={onClose}
        className="text-subtle hover:text-ink"
        title="Close panel"
      >
        ✕
      </button>
    </div>
  );
}

function PlaceholderBody({ name, hint }: { name: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted">
      <div className="text-sm">{name}</div>
      <div className="text-xs">{hint}</div>
    </div>
  );
}
