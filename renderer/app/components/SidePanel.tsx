'use client';

import { tildify, basename } from '../../lib/path-helpers';
import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { StatusDot } from './StatusDot';

export function SidePanel() {
  const session = useSessionsStore(selectActiveSession);

  if (!session) {
    return (
      <div className="p-4 text-xs text-muted">
        Select a session to see status, tokens, and recent activity here.
      </div>
    );
  }

  const m = session.metrics;

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <StatusDot status={session.status} confidence={session.statusConfidence} />
          <span className="text-ink font-medium">{session.displayName}</span>
        </div>
        <div className="text-xs text-muted truncate" title={session.cwd}>
          {tildify(session.cwd, '/Users/fixture')}
        </div>
      </div>

      <Field label="branch" value={session.gitBranch ?? '—'} mono />
      <Field label="cli" value={session.cli} />
      <Field
        label="status"
        value={`${session.status}${session.statusConfidence === 'low' ? ' (polling)' : ''}`}
      />

      <div>
        <FieldLabel>tokens</FieldLabel>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs font-mono">
          <dt className="text-muted">input</dt>
          <dd className="text-ink">{m.tokensInput.toLocaleString()}</dd>
          <dt className="text-muted">cached</dt>
          <dd className="text-ink">{m.tokensCached.toLocaleString()}</dd>
          <dt className="text-muted">output</dt>
          <dd className="text-ink">{m.tokensOutput.toLocaleString()}</dd>
          <dt className="text-muted">cost</dt>
          <dd className="text-ink">
            {m.estimatedCostUSD === null ? '—' : `$${m.estimatedCostUSD.toFixed(3)}`}
          </dd>
          <dt className="text-muted">messages</dt>
          <dd className="text-ink">{m.messageCount}</dd>
        </dl>
      </div>

      {session.currentTool && (
        <div>
          <FieldLabel>tool in progress</FieldLabel>
          <div className="mt-1 rounded-md border border-edge/10 bg-sunken p-2 text-xs">
            <div className="font-medium text-ink">{session.currentTool.name}</div>
            {session.currentTool.description && (
              <div className="mt-0.5 text-muted font-mono truncate">
                {session.currentTool.description}
              </div>
            )}
          </div>
        </div>
      )}

      {session.latestMessage && (
        <div>
          <FieldLabel>latest message ({session.latestMessage.role})</FieldLabel>
          <div className="mt-1 rounded-md border border-edge/10 bg-sunken p-2 text-xs text-ink/90">
            {session.latestMessage.preview}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-subtle">{children}</div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <FieldLabel>{label}</FieldLabel>
      <span className={mono ? 'font-mono text-xs text-ink' : 'text-xs text-ink'}>{value}</span>
    </div>
  );
}

// silence unused import in case basename is consumed elsewhere later
void basename;
