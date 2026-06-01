'use client';

import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirm replacing `window.confirm`. Keeps the design system
 * (Modal + Button) intact instead of dropping to a native browser dialog
 * that visually exits the app.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="max-w-sm">
      {description && <p className="text-sm text-muted">{description}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button size="md" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          size="md"
          variant={destructive ? 'danger' : 'primary'}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
