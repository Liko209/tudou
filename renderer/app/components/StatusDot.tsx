import { cn } from '../../lib/utils';
import type { SessionStatus, StatusConfidence } from '../../../shared/session-types';

const STATUS_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-subtle',
  working: 'bg-success',
  waiting: 'bg-warning',
  idle: 'bg-subtle/80',
  errored: 'bg-danger',
  exited: 'bg-subtle/40',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: 'starting',
  working: 'working',
  waiting: 'waiting for input',
  idle: 'idle',
  errored: 'errored',
  exited: 'exited',
};

interface StatusDotProps {
  status: SessionStatus;
  confidence?: StatusConfidence;
  className?: string;
}

export function StatusDot({ status, confidence = 'high', className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full shrink-0',
        STATUS_CLASS[status],
        confidence === 'low' && 'ring-1 ring-dashed ring-current/60 opacity-80',
        className,
      )}
      title={`${STATUS_LABEL[status]}${confidence === 'low' ? ' (polling mode)' : ''}`}
    />
  );
}
