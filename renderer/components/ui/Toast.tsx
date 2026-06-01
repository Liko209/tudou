'use client';

import { useEffect } from 'react';
import { useUIStore } from '../../lib/stores/ui-store';

const AUTO_DISMISS_MS = 5000;

/**
 * Single global toast pinned bottom-right of the window. Trigger by
 * calling `useUIStore.getState().showToast(msg)` from anywhere. Auto
 * dismisses; user can dismiss earlier by clicking the message.
 */
export function Toast() {
  const message = useUIStore((s) => s.toast);
  const clear = useUIStore((s) => s.clearToast);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [message, clear]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={clear}
      className="fixed bottom-4 right-4 z-50 max-w-sm cursor-pointer rounded-md border border-edge/10 bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_8px_24px_rgb(0_0_0/0.25)]"
    >
      {message}
    </div>
  );
}
