// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NetworkSection } from '../renderer/app/components/SettingsView';

afterEach(cleanup);

// Minimal Preferences stub — only `network` matters for this component.
function prefsWith(customEnv: Array<{ key: string; value: string; enabled: boolean }>) {
  return { network: { customEnv } } as never;
}

describe('NetworkSection (draft + explicit Save)', () => {
  it('persists edits only on Save, with the full row payload', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkSection prefs={prefsWith([{ key: 'HTTPS_PROXY', value: '', enabled: true }])} save={save} />);

    // Type a value into the (only) value input — the KEY input is the first
    // textbox, the value input is the second.
    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[1], { target: { value: 'http://127.0.0.1:7890' } });

    // Nothing persisted yet — this was the old bug (auto-commit never fired).
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].network.customEnv).toEqual([
      { key: 'HTTPS_PROXY', value: 'http://127.0.0.1:7890', enabled: true },
    ]);
  });

  it('Save is disabled until there is an unsaved change', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkSection prefs={prefsWith([{ key: 'HTTP_PROXY', value: 'x', enabled: true }])} save={save} />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'y' } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('Cancel reverts the draft without calling save', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkSection prefs={prefsWith([{ key: 'HTTP_PROXY', value: 'orig', enabled: true }])} save={save} />);

    const value = () => screen.getAllByRole('textbox')[1] as HTMLInputElement;
    fireEvent.change(value(), { target: { value: 'edited' } });
    expect(value().value).toBe('edited');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(value().value).toBe('orig');
    expect(save).not.toHaveBeenCalled();
  });

  it('a suggestion chip adds a row for a missing key', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NetworkSection prefs={prefsWith([])} save={save} />);

    // Empty list → all suggested keys offered as chips. Add ALL_PROXY.
    fireEvent.click(screen.getByRole('button', { name: /ALL_PROXY/ }));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'socks5://h:1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(save.mock.calls[0][0].network.customEnv).toEqual([
      { key: 'ALL_PROXY', value: 'socks5://h:1', enabled: true },
    ]);
  });
});
