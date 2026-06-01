'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';

interface Props {
  children: ReactNode;
  /** Optional label used in the fallback message. */
  label?: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches render-time errors so a single broken component doesn't blank
 * the whole window. Falls back to a small inline panel with the message
 * and a Reload button. The user can keep using other parts of the UI
 * (e.g. spawn or kill sessions from the toolbar).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
     
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info);
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private reload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas p-8">
        <div className="max-w-lg w-full rounded-lg border border-danger/30 bg-sunken p-5">
          <div className="text-sm font-semibold text-danger">
            {this.props.label ? `${this.props.label} crashed` : 'Something went wrong'}
          </div>
          <div className="mt-2 font-mono text-xs text-ink/80 break-words">
            {this.state.error.message}
          </div>
          {this.state.componentStack && (
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">Stack</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px]">
                {this.state.componentStack}
              </pre>
            </details>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="default" onClick={this.reset}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={this.reload}>
              Reload window
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
