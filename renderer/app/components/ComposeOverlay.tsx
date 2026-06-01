'use client';

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { CornerDownLeft, GripHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ComposeOverlayProps {
  /** Whether the box is shown (scrolled up, has a draft, or summoned). */
  visible: boolean;
  draft: string;
  onChange: (text: string) => void;
  /** Insert the draft into the CLI input line (no Enter). */
  onInsert: () => void;
  /** Clear the draft and dismiss. */
  onClose: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Drag offset from the default bottom-center spot, and its setter. */
  offset: { x: number; y: number };
  onOffsetChange: (pos: { x: number; y: number }) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Floating "reply draft" box that hovers over the bottom of a session
 * terminal. It appears when the user scrolls up off the bottom (so they can
 * jot a reply while reading), and on insert pastes the whole draft into the
 * CLI's own input line — without pressing Enter, so the user confirms and
 * sends. Draggable by its header. Purely presentational; the owning Terminal
 * drives visibility, the draft store, and the actual PTY write.
 */
export function ComposeOverlay({
  visible,
  draft,
  onChange,
  onInsert,
  onClose,
  onKeyDown,
  textareaRef,
  offset,
  onOffsetChange,
}: ComposeOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number; maxX: number; maxYUp: number } | null>(null);
  const canInsert = draft.trim().length > 0;

  const onHeaderPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    // Left button only, and never start a drag from the close button.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const card = cardRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const parentRect = parent?.getBoundingClientRect();
    const margin = 8;
    // Default spot is bottom-center, so it can slide up and sideways within the
    // terminal pane but never below the bottom edge.
    const maxX = parentRect ? Math.max(0, (parentRect.width - cardRect.width) / 2 - margin) : 0;
    const maxYUp = parentRect ? Math.max(0, parentRect.height - cardRect.height - margin * 2) : 0;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
      maxX,
      maxYUp,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onHeaderPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const x = clamp(d.baseX + (e.clientX - d.startX), -d.maxX, d.maxX);
    const y = clamp(d.baseY + (e.clientY - d.startY), -d.maxYUp, 0);
    onOffsetChange({ x, y });
  };

  const onHeaderPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4',
        'transition-[opacity,transform] duration-200 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
      aria-hidden={!visible}
    >
      <div
        ref={cardRef}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className={cn(
          'w-full max-w-2xl overflow-hidden rounded-xl border border-edge/15 bg-surface/95 shadow-xl backdrop-blur',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          className="flex cursor-move touch-none select-none items-center justify-between px-3 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle"
        >
          <span className="flex items-center gap-1.5">
            <GripHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reply draft
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Clear and close"
            title="Clear and close"
            className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          tabIndex={visible ? 0 : -1}
          placeholder="Jot your reply while you read…  ⌘↵ to insert into the input line"
          className="max-h-48 min-h-[3.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-subtle focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-edge/10 px-3 py-2">
          <span className="text-[11px] text-subtle">
            Inserts into the CLI input — review, then press Enter to send
          </span>
          <button
            type="button"
            onClick={onInsert}
            disabled={!canInsert}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              canInsert
                ? 'bg-accent/15 text-ink hover:bg-accent/25'
                : 'cursor-not-allowed text-subtle opacity-50',
            )}
          >
            Insert into input
            <kbd className="flex items-center gap-0.5 rounded border border-edge/15 bg-canvas px-1 py-0.5 font-mono text-[10px]">
              ⌘
              <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
