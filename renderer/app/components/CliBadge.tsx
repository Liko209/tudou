import { cn } from '../../lib/utils';

type Cli = 'claude' | 'codex';

const META: Record<Cli, { bg: string; title: string }> = {
  claude: { bg: '#C96442', title: 'Claude Code' }, // Anthropic clay
  codex: { bg: '#10A37F', title: 'Codex' }, // OpenAI green
};

/**
 * Small colored badge identifying a session's CLI — a sparkle for Claude, a
 * hexagon for Codex. Simple original marks (not the vendors' logos), leaning on
 * each brand's color + shape so the sidebar reads at a glance instead of "CL/CX".
 */
export function CliBadge({ cli, className }: { cli: Cli; className?: string }) {
  const { bg, title } = META[cli];
  return (
    <span
      title={title}
      aria-label={title}
      className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]', className)}
      style={{ backgroundColor: bg }}
    >
      {cli === 'claude' ? (
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="#fff" aria-hidden="true">
          <path d="M8 1 L9.4 6.6 L15 8 L9.4 9.4 L8 15 L6.6 9.4 L1 8 L6.6 6.6 Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2 L13.2 5 L13.2 11 L8 14 L2.8 11 L2.8 5 Z" />
        </svg>
      )}
    </span>
  );
}
