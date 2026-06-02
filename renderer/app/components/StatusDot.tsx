import { BellRing, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SessionStatus, StatusConfidence } from '../../../shared/session-types';

/**
 * Session status indicator. Three live states are now visually distinct by
 * SHAPE + MOTION, not just colour:
 *   working  — green spinner (animated)        → "busy right now"
 *   waiting  — green dot, static               → "free / your turn"
 *   blocked  — amber bell, gentle shake        → "needs you" (decision/auth)
 *   errored  — red dot, static
 *   starting — grey dot, pulsing
 *   exited   — faint grey dot, static
 */
const LABEL: Record<SessionStatus, string> = {
  working: 'working',
  waiting: 'idle — waiting for you',
  blocked: 'needs your input',
  errored: 'errored',
  starting: 'starting',
  exited: 'exited',
};

const DOT: Record<Exclude<SessionStatus, 'working' | 'blocked'>, { cls: string; pulse?: boolean }> = {
  waiting: { cls: 'bg-success' },
  errored: { cls: 'bg-danger' },
  starting: { cls: 'bg-subtle', pulse: true },
  exited: { cls: 'bg-subtle/40' },
};

interface StatusDotProps {
  status: SessionStatus;
  confidence?: StatusConfidence;
  className?: string;
}

export function StatusDot({ status, confidence = 'high', className }: StatusDotProps) {
  const title = `${LABEL[status]}${confidence === 'low' ? ' (polling mode)' : ''}`;
  const wrapper = cn(
    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center',
    // Low confidence (polling, no hook) — dim slightly as a soft hint.
    confidence === 'low' && 'opacity-70',
    className,
  );

  if (status === 'working') {
    return (
      <span className={wrapper} title={title}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-success" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className={wrapper} title={title}>
        <BellRing className="h-3.5 w-3.5 animate-shake text-warning" strokeWidth={2.25} />
      </span>
    );
  }

  const spec = DOT[status];
  return (
    <span className={wrapper} title={title}>
      <span className={cn('inline-flex h-2.5 w-2.5 rounded-full', spec.cls, spec.pulse && 'animate-pulse')} />
    </span>
  );
}
