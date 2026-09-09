import { describe, expect, it } from 'vitest';
import {
  assertStrategyMode,
  sanitizeStorageState,
  validateSessionScope,
} from '../src/core/session-policy';
import type { StorageState, WebPostStrategy } from '../src/core/types';

const state: StorageState = {
  cookies: [
    {
      name: 'allowed',
      value: 'secret-a',
      domain: '.example.com',
      path: '/',
      expires: 1e12,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'subdomain',
      value: 'secret-b',
      domain: 'app.example.com',
      path: '/',
      expires: 1e12,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'unrelated',
      value: 'secret-c',
      domain: 'accounts.example.net',
      path: '/',
      expires: 1e12,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: 'https://app.example.com',
      localStorage: [{ name: 'session', value: 'secret-d' }],
    },
    {
      origin: 'https://unrelated.example.net',
      localStorage: [{ name: 'session', value: 'secret-e' }],
    },
  ],
};

describe('session policy', () => {
  it('keeps only allowed cookie domains and exact origins', () => {
    const sanitized = sanitizeStorageState(state, {
      cookieDomains: ['example.com'],
      origins: ['https://app.example.com/path'],
    });
    expect(sanitized.cookies.map((cookie) => cookie.name)).toEqual([
      'allowed',
      'subdomain',
    ]);
    expect(sanitized.origins.map((origin) => origin.origin)).toEqual([
      'https://app.example.com',
    ]);
  });

  it('can exclude subdomain cookies', () => {
    const sanitized = sanitizeStorageState(state, {
      cookieDomains: ['example.com'],
      origins: [],
      includeSubdomains: false,
    });
    expect(sanitized.cookies.map((cookie) => cookie.name)).toEqual(['allowed']);
  });

  it('rejects empty and dangerously broad scopes', () => {
    expect(() =>
      validateSessionScope({ cookieDomains: [], origins: [] })
    ).toThrow(/at least one/);
    expect(() =>
      validateSessionScope({ cookieDomains: ['com'], origins: [] })
    ).toThrow(/Unsafe/);
  });

  it('denies execution modes disabled by a strategy', () => {
    const strategy = {
      platform: 'human-only',
      loginUrl: 'https://app.example.com',
      policy: { allowUnattended: false },
    } as WebPostStrategy;
    expect(() => assertStrategyMode(strategy, 'interactive')).not.toThrow();
    expect(() => assertStrategyMode(strategy, 'unattended')).toThrow(
      /does not permit/
    );
  });
});
