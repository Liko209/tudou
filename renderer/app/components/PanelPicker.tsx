'use client';

import { FileText, MessageSquare, TerminalSquare, X, type LucideIcon } from 'lucide-react';
import type { PanelKind } from '../../lib/stores/ui-store';
import { cn } from '../../lib/utils';

const OPTIONS: { kind: PanelKind; Icon: LucideIcon; label: string; description: string }[] = [
  { kind: 'files', Icon: FileText, label: 'Files', description: 'Browse the working directory' },
  { kind: 'sidechat', Icon: MessageSquare, label: 'Side chat', description: 'Start a side conversation' },
  { kind: 'terminal', Icon: TerminalSquare, label: 'Terminal', description: 'Start an interactive shell' },
];

interface PanelPickerProps {
  onPick: (kind: PanelKind) => void;
  onClose: () => void;
}

/**
 * Picker for an empty dock panel — Codex-style cards: a centred icon, a
 * title, and a one-line description. The auto-fit grid stacks the cards in
 * one column when the panel is narrow (right dock) and lays them out in a
 * row when it's wide (bottom dock).
 */
export function PanelPicker({ onPick, onClose }: PanelPickerProps) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <PickerHeader onClose={onClose} />
      <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] content-start gap-2 overflow-y-auto p-3">
        {OPTIONS.map(({ kind, Icon, label, description }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className={cn(
              'group flex flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-6 text-center',
              'border border-edge/10 bg-surface/40 transition-colors',
              'hover:border-accent/40 hover:bg-surface',
              'focus-visible:border-accent/40 focus-visible:bg-surface focus-visible:outline-none',
              'focus-visible:ring-1 focus-visible:ring-accent/40',
            )}
          >
            <Icon
              className="h-5 w-5 shrink-0 text-muted group-hover:text-ink"
              strokeWidth={1.75}
            />
            <span className="whitespace-nowrap text-sm font-medium text-ink">{label}</span>
            <span className="text-xs text-subtle">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge/5 bg-surface/60 px-3 text-[11px] uppercase tracking-wider text-subtle">
      <span>New panel</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
