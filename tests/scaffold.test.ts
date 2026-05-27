import { describe, expect, it } from 'vitest';
import type { CliKind } from '@shared/types';

describe('scaffold sanity', () => {
  it('CliKind union compiles and accepts expected values', () => {
    const a: CliKind = 'claude';
    const b: CliKind = 'codex';
    expect([a, b]).toEqual(['claude', 'codex']);
  });
});
