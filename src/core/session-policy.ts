import type {
  AgentSessionState,
  SessionScope,
  StorageState,
  WebPostStrategy,
} from './types';

function normalizedDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}

function cookieDomainAllowed(
  cookieDomain: string,
  allowedDomain: string,
  includeSubdomains: boolean
): boolean {
  const cookie = normalizedDomain(cookieDomain);
  const allowed = normalizedDomain(allowedDomain);
  return (
    cookie === allowed || (includeSubdomains && cookie.endsWith(`.${allowed}`))
  );
}

function normalizedOrigin(value: string): string {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    throw new Error(`Invalid session origin in strategy policy: ${value}`);
  }
}

export function validateSessionScope(scope: SessionScope): void {
  const domains = scope.cookieDomains.map(normalizedDomain).filter(Boolean);
  const origins = scope.origins.map(normalizedOrigin);
  if (domains.length === 0 && origins.length === 0) {
    throw new Error(
      'Strategy session scope must allow at least one cookie domain or origin'
    );
  }
  for (const domain of domains) {
    if (
      domain === 'com' ||
      domain === 'org' ||
      domain === 'net' ||
      !domain.includes('.')
    ) {
      throw new Error(`Unsafe cookie domain in strategy policy: ${domain}`);
    }
  }
}

export function sanitizeStorageState(
  state: StorageState,
  scope: SessionScope
): StorageState {
  validateSessionScope(scope);
  const domains = scope.cookieDomains.map(normalizedDomain);
  const origins = new Set(scope.origins.map(normalizedOrigin));
  const includeSubdomains = scope.includeSubdomains !== false;
  return {
    cookies: state.cookies.filter((cookie) =>
      domains.some((domain) =>
        cookieDomainAllowed(cookie.domain, domain, includeSubdomains)
      )
    ),
    origins: state.origins.filter((origin) =>
      origins.has(normalizedOrigin(origin.origin))
    ),
  };
}

export function sanitizeSessionState(
  state: AgentSessionState,
  strategy: WebPostStrategy
): AgentSessionState {
  const scope = strategy.policy?.session;
  if (!scope) {
    return state;
  }
  return {
    ...state,
    storageState: sanitizeStorageState(state.storageState, scope),
  };
}

export function assertStrategyMode(
  strategy: WebPostStrategy,
  mode: 'interactive' | 'unattended'
): void {
  if (
    (mode === 'interactive' &&
      strategy.policy?.allowInteractiveCapture === false) ||
    (mode === 'unattended' && strategy.policy?.allowUnattended === false)
  ) {
    throw new Error(
      `Strategy ${strategy.platform} does not permit ${mode} execution`
    );
  }
}
