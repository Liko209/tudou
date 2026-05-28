'use client';

import { useCallback } from 'react';
import { cn } from '../../lib/utils';

interface DragHandleProps {
  /** 'vertical' = a vertical divider you drag horizontally to change width.
   *  'horizontal' = a horizontal divider you drag vertically to change height. */
  orientation: 'vertical' | 'horizontal';
  /** Current size in px (used to compute the new value during drag). */
  current: number;
  /** Apply a new clamped size. */
  onChange: (next: number) => void;
  /** Drag direction sign for width: 1 = drag-right grows. */
  sign?: 1 | -1;
  className?: string;
}

/**
 * 3-pixel-wide draggable splitter. No external dep — direct mousedown +
 * window-level move/up listeners while the drag is active.
 */
export function DragHandle({
  orientation,
  current,
  onChange,
  sign = 1,
  className,
}: DragHandleProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const start = orientation === 'vertical' ? e.clientX : e.clientY;
      const startSize = current;
      const onMove = (ev: MouseEvent): void => {
        const now = orientation === 'vertical' ? ev.clientX : ev.clientY;
        const delta = (now - start) * sign;
        onChange(startSize + delta);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    },
    [orientation, current, onChange, sign],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'group relative shrink-0 bg-edge/5 transition-colors hover:bg-accent/40',
        orientation === 'vertical' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
        className,
      )}
    >
      {/* Wider invisible hit area for easier targeting */}
      <div
        className={cn(
          'absolute',
          orientation === 'vertical'
            ? '-left-1 -right-1 inset-y-0'
            : '-top-1 -bottom-1 inset-x-0',
        )}
      />
    </div>
  );
}
