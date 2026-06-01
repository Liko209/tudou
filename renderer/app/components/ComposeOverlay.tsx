'use client';

import type { KeyboardEvent, RefObject } from 'react';
import { CornerDownLeft, MessageSquarePlus, X } from 'lucide-react';
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
}

/**
 * Floating "reply scratch" box that hovers over the bottom of a session
 * terminal. It appears when the user scrolls up off the bottom (so they can
 * jot a reply while reading), and on insert pastes the whole draft into the
 * CLI's own input line — without pressing Enter, so the user confirms and
 * sends. Purely presentational; the owning Terminal drives visibility, the
 * draft store, and the actual PTY write.
 */
export function ComposeOverlay({
  visible,
  draft,
  onChange,
  onInsert,
  onClose,
  onKeyDown,
  textareaRef,
}: ComposeOverlayProps) {
  const canInsert = draft.trim().length > 0;
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4',
        'transition-all duration-200 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
      aria-hidden={!visible}
    >
      <div
        className={cn(
          'w-full max-w-2xl overflow-hidden rounded-xl border border-edge/15 bg-surface/95 shadow-xl backdrop-blur',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        <div className="flex items-center justify-between px-3 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
          <span className="flex items-center gap-1.5">
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            回应草稿
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="清空并关闭"
            title="清空并关闭"
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
          placeholder="边读边攒你想回应的点…  ⌘↵ 插入到输入行"
          className="max-h-48 min-h-[3.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-subtle focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-edge/10 px-3 py-2">
          <span className="text-[11px] text-subtle">插入后焦点回终端，确认无误再按 Enter 发送</span>
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
            插入到输入行
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
