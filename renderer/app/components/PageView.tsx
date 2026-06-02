'use client';

import { type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Shared chrome for the full-screen overlay pages (Usage, Settings) so they
 * stay visually consistent: a slim header bar and a single content max-width.
 * Keep the container width here — both pages import {@link PAGE_WIDTH} so they
 * never drift apart.
 */
export const PAGE_WIDTH = 'mx-auto w-full max-w-6xl px-6';

export function PageHeader({
  title,
  subtitle,
  onClose,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-edge/10 px-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-sm font-medium text-ink">{title}</h1>
        {subtitle != null && <span className="text-xs text-subtle">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-surface/60 hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
