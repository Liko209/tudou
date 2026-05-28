'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    innerRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={innerRef}
        tabIndex={-1}
        className={cn(
          'mx-4 w-full rounded-lg border border-edge/10 bg-surface shadow-2xl outline-none',
          maxWidth,
        )}
      >
        <div className="border-b border-edge/5 px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
