import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RateLimitTracker,
  buildStatusLineWrapper,
  withStatusLine,
  withoutStatusLine,
} from '../electron/statusline-installer';

describe('statusLine transforms (pure)', () => {
  it('wrapper embeds the rate-limit file and delegates to the previous command', () => {
    const s = buildStatusLineWrapper('npx -y ccstatusline@latest');
    expect(s).toContain('tudou-rate-limits.json');
    expect(s).toContain("DELEGATE='npx -y ccstatusline@latest'");
    expect(s).toContain('rate_limits');
  });

  it('wrapper with no delegate leaves DELEGATE empty', () => {
    expect(buildStatusLineWrapper(null)).toContain("DELEGATE=''");
  });

  it('withStatusLine / withoutStatusLine round-trip', () => {
    const orig = { statusLine: { type: 'command', command: 'ccstatusline' }, other: 1 };
    const installed = withStatusLine(orig, '/x/tudou.sh');
    expect((installed.statusLine as { command: string }).command).toBe('/x/tudou.sh');
    expect(installed.other).toBe(1);
    const restored = withoutStatusLine(installed, 'ccstatusline');
    expect((restored.statusLine as { command: string }).command).toBe('ccstatusline');
    expect(withoutStatusLine(installed, null).statusLine).toBeUndefined();
  });
});

describe('RateLimitTracker (fs)', () => {
  async function makeHome(statusLine?: unknown): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'tudou-rl-'));
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'settings.json'), JSON.stringify(statusLine ? { statusLine } : {}));
    return home;
  }

  it('enable preserves the existing statusLine as the delegate; disable restores it', async () => {
    const home = await makeHome({ type: 'command', command: 'npx -y ccstatusline@latest' });
    const t = new RateLimitTracker({ claudeHome: home });

    expect(t.getStatus().enabled).toBe(false);
    t.enable();
    const st = t.getStatus();
    expect(st.enabled).toBe(true);

    const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(settings.statusLine.command).toBe(join(home, 'tudou-statusline.sh'));
    const wrapper = await readFile(join(home, 'tudou-statusline.sh'), 'utf8');
    expect(wrapper).toContain("DELEGATE='npx -y ccstatusline@latest'");

    t.disable();
    expect(t.getStatus().enabled).toBe(false);
    const restored = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(restored.statusLine.command).toBe('npx -y ccstatusline@latest');
  });

  it('enable is idempotent (does not chain its own wrapper as the delegate)', async () => {
    const home = await makeHome({ type: 'command', command: 'orig-cmd' });
    const t = new RateLimitTracker({ claudeHome: home });
    t.enable();
    t.enable();
    const wrapper = await readFile(join(home, 'tudou-statusline.sh'), 'utf8');
    expect(wrapper).toContain("DELEGATE='orig-cmd'");
    t.disable();
    const restored = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(restored.statusLine.command).toBe('orig-cmd');
  });

  it('read returns the parsed snapshot when present', async () => {
    const home = await makeHome();
    const t = new RateLimitTracker({ claudeHome: home });
    await writeFile(
      join(home, 'tudou-rate-limits.json'),
      JSON.stringify({ source: 'claude', updatedAt: 1, fiveHour: { usedPercentage: 25, resetsAt: 9 } }),
    );
    expect(t.read()!.fiveHour).toEqual({ usedPercentage: 25, resetsAt: 9 });
  });
});
