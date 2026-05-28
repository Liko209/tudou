import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HookInstaller, buildHookScript } from '../electron/hook-installer';

const ROOT = join(tmpdir(), `hook-installer-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

function freshHome(name: string): string {
  return join(ROOT, name);
}

describe('HookInstaller.getStatus', () => {
  it('reports not installed for a fresh claude home', async () => {
    const home = freshHome('fresh');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    const status = inst.getStatus();
    expect(status.scriptInstalled).toBe(false);
    expect(status.registeredEvents).toEqual([]);
    expect(status.fullyInstalled).toBe(false);
  });

  it('reports installed after install() runs', async () => {
    const home = freshHome('installed');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/instance.json'));
    const status = inst.getStatus();
    expect(status.scriptInstalled).toBe(true);
    expect(status.registeredEvents.sort()).toEqual(['Notification', 'Stop', 'UserPromptSubmit']);
    expect(status.fullyInstalled).toBe(true);
  });

  it('reports partial when only some events are registered', async () => {
    const home = freshHome('partial');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    // Manually corrupt: drop UserPromptSubmit + Notification
    const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    delete settings.hooks.UserPromptSubmit;
    delete settings.hooks.Notification;
    await writeFile(join(home, 'settings.json'), JSON.stringify(settings));
    const status = inst.getStatus();
    expect(status.registeredEvents).toEqual(['Stop']);
    expect(status.fullyInstalled).toBe(false);
  });
});

describe('HookInstaller.install', () => {
  it('writes an executable shell script', async () => {
    const home = freshHome('script');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/instance.json'));

    const path = join(home, 'hooks', 'agent-dashboard.sh');
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode & 0o100).not.toBe(0); // owner executable
  });

  it('preserves the user other settings', async () => {
    const home = freshHome('preserve');
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({
        statusLine: { type: 'command', command: 'ccstatus' },
        agentPushNotifEnabled: true,
        enabledPlugins: { 'foo@bar': true },
      }),
    );
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    const after = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(after.statusLine).toEqual({ type: 'command', command: 'ccstatus' });
    expect(after.agentPushNotifEnabled).toBe(true);
    expect(after.enabledPlugins).toEqual({ 'foo@bar': true });
    expect(after.hooks.Stop).toBeDefined();
  });

  it('preserves the user existing unrelated hooks', async () => {
    const home = freshHome('coexist');
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/users/x/log.sh' }] }],
          Stop: [{ hooks: [{ type: 'command', command: '/users/x/other.sh' }] }],
        },
      }),
    );
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    const after = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    // Pre-existing Stop hook still there
    const stopEntries = after.hooks.Stop;
    expect(stopEntries).toHaveLength(2);
    const cmds = stopEntries.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command),
    );
    expect(cmds).toContain('/users/x/other.sh');
    expect(cmds.some((c: string) => c.includes('agent-dashboard.sh'))).toBe(true);
    // Pre-existing PreToolUse hook still there
    expect(after.hooks.PreToolUse).toHaveLength(1);
  });

  it('is idempotent — re-install does not duplicate our entry', async () => {
    const home = freshHome('idempotent');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    inst.install(buildHookScript('/tmp/x'));
    inst.install(buildHookScript('/tmp/x'));
    const after = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(after.hooks.Stop).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit).toHaveLength(1);
    expect(after.hooks.Notification).toHaveLength(1);
  });

  it('writes a .bak.<stamp> backup of pre-existing settings.json', async () => {
    const home = freshHome('backup');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'settings.json'), JSON.stringify({ statusLine: 'orig' }));
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    const files = (await import('node:fs/promises')).readdir(home);
    const list = await files;
    expect(list.some((f) => f.startsWith('settings.json.bak.'))).toBe(true);
  });
});

describe('HookInstaller.uninstall', () => {
  it('removes script + our settings entries, keeps everything else', async () => {
    const home = freshHome('uninstall');
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({
        statusLine: { type: 'command', command: 'ccstatus' },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/users/x/log.sh' }] }],
        },
      }),
    );
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    inst.uninstall();
    expect(existsSync(join(home, 'hooks', 'agent-dashboard.sh'))).toBe(false);
    const after = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(after.statusLine).toEqual({ type: 'command', command: 'ccstatus' });
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.Stop).toBeUndefined();
    expect(after.hooks.UserPromptSubmit).toBeUndefined();
    expect(after.hooks.Notification).toBeUndefined();
  });

  it('is safe to run without anything installed', async () => {
    const home = freshHome('uninstall-clean');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    expect(() => inst.uninstall()).not.toThrow();
  });

  it('drops the hooks key entirely when our entries were the only ones', async () => {
    const home = freshHome('uninstall-empty');
    await mkdir(home, { recursive: true });
    const inst = new HookInstaller({ claudeHome: home });
    inst.install(buildHookScript('/tmp/x'));
    inst.uninstall();
    const after = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    expect(after.hooks).toBeUndefined();
  });
});

describe('buildHookScript', () => {
  it('embeds the instance path literally and forwards stdin via curl', () => {
    const script = buildHookScript('/Users/x/.app/instance.json');
    expect(script).toMatch(/^#!\/bin\/sh/);
    expect(script).toContain("INSTANCE_FILE='/Users/x/.app/instance.json'");
    expect(script).toContain('curl');
    expect(script).toContain('http://127.0.0.1:$PORT/hook');
    expect(script).toContain('-H "Authorization: Bearer $TOKEN"');
  });

  it('shell-escapes a path containing single quotes', () => {
    const script = buildHookScript("/tmp/it's-weird/instance.json");
    expect(script).toContain("INSTANCE_FILE='/tmp/it'\\''s-weird/instance.json'");
  });
});
