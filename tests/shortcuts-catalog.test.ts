import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from '../renderer/lib/shortcuts-catalog';

describe('SHORTCUT_GROUPS', () => {
  it('has at least the audited groups', () => {
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Global', 'Terminal', 'Compose draft']),
    );
  });

  it('every group has a non-empty title and at least one item', () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title.trim()).not.toBe('');
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it('every item is well-formed (≥1 non-blank key chip + a description)', () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const item of g.items) {
        expect(item.keys.length).toBeGreaterThan(0);
        expect(item.keys.every((k) => k.trim() !== '')).toBe(true);
        expect(item.description.trim()).not.toBe('');
      }
    }
  });

  it('documents its own ⌘/ toggle so the panel is discoverable', () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items);
    const hasSelf = all.some(
      (i) => i.keys.includes('⌘') && i.keys.includes('/'),
    );
    expect(hasSelf).toBe(true);
  });
});
