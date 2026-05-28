import { describe, expect, it } from 'vitest';
import { maskSecrets } from '../electron/secret-masker';

describe('maskSecrets', () => {
  it('passes through ordinary text untouched', () => {
    expect(maskSecrets('hello world, nothing to hide')).toBe('hello world, nothing to hide');
    expect(maskSecrets('')).toBe('');
  });

  it('masks OpenAI / Anthropic API keys', () => {
    expect(maskSecrets('my key sk-abcdef1234567890ABCDEFGH123')).toBe('my key [OPENAI_KEY]');
    expect(maskSecrets('sk-ant-api03-abcdef1234567890XYZ')).toBe('[ANTHROPIC_KEY]');
  });

  it('masks GitHub tokens', () => {
    const ghp = 'ghp_' + 'A'.repeat(36);
    expect(maskSecrets(`Auth: ${ghp}`)).toBe('Auth: [GITHUB_TOKEN]');
    const ghs = 'ghs_' + 'B'.repeat(36);
    expect(maskSecrets(ghs)).toBe('[GITHUB_APP]');
  });

  it('masks AWS access keys', () => {
    expect(maskSecrets('AKIAIOSFODNN7EXAMPLE found')).toBe('[AWS_KEY_ID] found');
    expect(maskSecrets('ASIAQQQQQQQQQQQQQQQQ temp')).toBe('[AWS_TEMP_KEY] temp');
  });

  it('masks Slack tokens (bot, oauth, refresh, etc.)', () => {
    expect(maskSecrets('token=xoxb-12345-67890-aaaaaaaaaaaa')).toBe('token=[SLACK_TOKEN]');
  });

  it('masks Stripe live secret keys', () => {
    expect(maskSecrets('sk_live_abcdefghijklmnopqrst')).toBe('[STRIPE_KEY]');
  });

  it('masks Google API keys', () => {
    const key = 'AIza' + 'A'.repeat(35);
    expect(maskSecrets(`url?key=${key}&v=1`)).toBe('url?key=[GOOGLE_API_KEY]&v=1');
  });

  it('masks JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOi0123456789.eyJzdWIiOi0123456789.SflKxwRJSMeKKF2QT4f0123456789';
    expect(maskSecrets(`Bearer ${jwt}`)).toBe('Bearer [JWT]');
  });

  it('masks multiple secrets in the same string', () => {
    const input = 'use sk-aaaaaaaaaaaaaaaaaaaaaaaa and AKIAIOSFODNN7EXAMPLE together';
    expect(maskSecrets(input)).toBe('use [OPENAI_KEY] and [AWS_KEY_ID] together');
  });

  it('does not mistake normal words for tokens', () => {
    expect(maskSecrets('the function sk_test_helper is fine')).toBe(
      'the function sk_test_helper is fine',
    );
    expect(maskSecrets('AKIA_THIS_IS_SHORT')).toBe('AKIA_THIS_IS_SHORT');
  });
});
