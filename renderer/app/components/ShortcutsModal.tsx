'use client';

import { Modal } from '../../components/ui/Modal';
import { useUIStore } from '../../lib/stores/ui-store';
import { SHORTCUT_GROUPS } from '../../lib/shortcuts-catalog';

/**
 * Keyboard cheat sheet (⌘/). Reads the shared SHORTCUT_GROUPS catalog so it
 * stays in sync with the actual bindings. Esc-to-close is handled by Modal.
 */
export function ShortcutsModal() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      maxWidth="max-w-2xl"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
              {group.title}
            </div>
            <div className="flex flex-col gap-1.5">
              {group.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-xs text-muted">{item.description}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((k, j) => (
                      <Kbd key={j}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-5 border-t border-edge/5 pt-3 text-[11px] text-subtle">
        Press <Kbd>⌘</Kbd> <Kbd>/</Kbd> any time to toggle this sheet, or{' '}
        <Kbd>Esc</Kbd> to close.
      </p>
    </Modal>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-edge/15 bg-sunken px-1.5 font-mono text-[11px] text-ink shadow-sm">
      {children}
    </kbd>
  );
}
