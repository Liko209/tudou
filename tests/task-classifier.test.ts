import { describe, expect, it } from 'vitest';
import { classifyTask } from '../electron/task-classifier';

const base = { tools: [] as string[], bash: '', userText: '' };

describe('classifyTask', () => {
  it('bash signals win: testing / git / build', () => {
    expect(classifyTask({ ...base, tools: ['Bash'], bash: 'npx vitest run' })).toBe('Testing');
    expect(classifyTask({ ...base, tools: ['Bash'], bash: 'git commit -m wip' })).toBe('Git Ops');
    expect(classifyTask({ ...base, tools: ['Bash'], bash: 'npm run build' })).toBe('Build/Deploy');
  });

  it('Task tool → Delegation; TodoWrite (no edits) → Planning', () => {
    expect(classifyTask({ ...base, tools: ['Task'] })).toBe('Delegation');
    expect(classifyTask({ ...base, tools: ['TodoWrite'] })).toBe('Planning');
  });

  it('edits refined by prompt intent', () => {
    expect(classifyTask({ ...base, tools: ['Edit'], userText: 'add a new export button' })).toBe('Feature Dev');
    expect(classifyTask({ ...base, tools: ['Write'], userText: 'refactor the parser' })).toBe('Refactoring');
    expect(classifyTask({ ...base, tools: ['Edit'], userText: 'fix the crash on startup' })).toBe('Debugging');
    expect(classifyTask({ ...base, tools: ['Edit'], userText: 'tweak the spacing' })).toBe('Coding');
  });

  it('read-only tools → Exploration', () => {
    expect(classifyTask({ ...base, tools: ['Read', 'Grep'] })).toBe('Exploration');
  });

  it('text-only turns by prompt', () => {
    expect(classifyTask({ ...base, userText: 'how should we design the schema?' })).toBe('Planning');
    expect(classifyTask({ ...base, userText: 'what are the options here?' })).toBe('Brainstorming');
    expect(classifyTask({ ...base, userText: 'thanks, looks good' })).toBe('Conversation');
    expect(classifyTask({ ...base })).toBe('General');
  });

  it('testing bash beats an edit in the same turn', () => {
    expect(classifyTask({ tools: ['Edit', 'Bash'], bash: 'pytest -q', userText: 'fix tests' })).toBe('Testing');
  });
});
