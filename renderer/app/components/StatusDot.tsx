import { cn } from '../../lib/utils';
import type { SessionStatus, StatusConfidence } from '../../../shared/session-types';

/**
 * Session status. The two healthy states share a colour (green) and are told
 * apart by MOTION; the rest use distinct colours:
 *   working  — green dot, gently pulsing    → "healthy, busy right now"
 *   waiting  — green dot, static            → "healthy, free / your turn"
 *   blocked  — amber dot with a ping ring    → "stuck, needs you" (eye-catching)
 *   errored  — red dot, static               → "something broke"
 *   starting — grey dot, pulsing             → "booting"
 *   exited   — faint grey dot, static        → "process gone"
 */
interface StatusSpec {
  dot: string;
  label: string;
  /** Continuous breathing — the session is actively doing something. */
  pulse?: boolean;
  /** Expanding ring colour — urgent, the session is stuck on you. */
  ping?: string;
}

const STATUS: Record<SessionStatus, StatusSpec> = {
  working: { dot: 'bg-success', pulse: true, label: 'working' },
  blocked: { dot: 'bg-warning', ping: 'bg-warning', label: 'needs your input' },
  waiting: { dot: 'bg-success', label: 'idle — waiting for you' },
  errored: { dot: 'bg-danger', label: 'errored' },
  starting: { dot: 'bg-subtle', pulse: true, label: 'starting' },
  exited: { dot: 'bg-subtle/40', label: 'exited' },
};

interface StatusDotProps {
  status: SessionStatus;
  confidence?: StatusConfidence;
  className?: string;
}

export function StatusDot({ status, confidence = 'high', className }: StatusDotProps) {
  const spec = STATUS[status];
  return (
    <span
      className={cn(
        'relative inline-flex h-2.5 w-2.5 shrink-0',
        // Low confidence (polling, no hook) — dim slightly as a soft hint.
        confidence === 'low' && 'opacity-70',
        className,
      )}
      title={`${spec.label}${confidence === 'low' ? ' (polling mode)' : ''}`}
    >
      {spec.ping && (
        <span
          className={cn(
            'absolute inset-0 inline-flex animate-ping rounded-full opacity-75',
            spec.ping,
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex h-2.5 w-2.5 rounded-full',
          spec.dot,
          spec.pulse && 'animate-pulse',
        )}
      />
    </span>
  );
}
