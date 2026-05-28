'use client';

import type { PanelKind } from '../../lib/stores/ui-store';

const OPTIONS: { kind: PanelKind; icon: string; label: string; description: string }[] = [
  { kind: 'files', icon: '📁', label: 'Files', description: 'Browse project files' },
  { kind: 'sidechat', icon: '💬', label: 'Side chat', description: 'Start a side conversation' },
  { kind: 'terminal', icon: '▦', label: 'Terminal', description: 'Open a shell here' },
];

interface PanelPickerProps {
  onPick: (kind: PanelKind) => void;
  onClose: () => void;
}

export function PanelPicker({ onPick, onClose }: PanelPickerProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge/5 bg-surface px-2 text-[10px] uppercase tracking-wider text-subtle">
        <span>New panel</span>
        <button
          type="button"
          onClick={onClose}
          className="text-subtle hover:text-ink"
          title="Close panel"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="grid w-full max-w-sm grid-cols-1 gap-2 sm:grid-cols-3">
          {OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              type="button"
              onClick={() => onPick(opt.kind)}
              className="flex flex-col items-center gap-1 rounded-md border border-edge/10 bg-sunken px-3 py-4 text-center transition-colors hover:border-accent/60 hover:bg-surface"
            >
              <span className="text-xl">{opt.icon}</span>
              <span className="text-xs font-medium text-ink">{opt.label}</span>
              <span className="text-[10px] text-muted">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
