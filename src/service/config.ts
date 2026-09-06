/**
 * Runner service configuration (environment driven, validated at boot).
 *
 * - AGENT_RUNNER_TOKEN      shared bearer token orchestrators use to call us (required)
 * - AGENT_RUNNER_PUBLIC_URL absolute URL users reach the runner at (live view)
 * - AGENT_RUNNER_JOB_PROVIDER   local | steel | kernel  (headless post/probe jobs)
 * - AGENT_RUNNER_CAPTURE_PROVIDER local | steel | kernel (interactive sign-in)
 * - STEEL_API_URL           e.g. http://127.0.0.1:3000 (sidecar) — required for steel
 * - STEEL_API_KEY           Steel Cloud only
 * - KERNEL_API_KEY          required for kernel (managed microVM browsers)
 * - KERNEL_API_URL          default https://api.onkernel.com
 * - PORT                    default 8080 (Cloud Run convention)
 */

export type ProviderKind = 'local' | 'steel' | 'kernel';

export type RunnerConfig = {
  port: number;
  token: string;
  publicUrl: string;
  jobProvider: ProviderKind;
  captureProvider: ProviderKind;
  steel?: { baseUrl: string; apiKey?: string };
  kernel?: { apiKey: string; baseUrl?: string };
  captureTtlMs: number;
  pacing: boolean;
};

function providerKind(
  value: string | undefined,
  fallback: ProviderKind
): ProviderKind {
  if (value === 'local' || value === 'steel' || value === 'kernel') {
    return value;
  }
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const token = env.AGENT_RUNNER_TOKEN;
  if (!token || token.length < 16) {
    throw new Error('AGENT_RUNNER_TOKEN must be set (>= 16 chars)');
  }
  const port = Number(env.PORT || 8080);
  const publicUrl = (
    env.AGENT_RUNNER_PUBLIC_URL || `http://localhost:${port}`
  ).replace(/\/+$/, '');
  const jobProvider = providerKind(env.AGENT_RUNNER_JOB_PROVIDER, 'local');
  const captureProvider = providerKind(
    env.AGENT_RUNNER_CAPTURE_PROVIDER,
    env.STEEL_API_URL ? 'steel' : 'local'
  );
  const steel = env.STEEL_API_URL
    ? {
        baseUrl: env.STEEL_API_URL.replace(/\/+$/, ''),
        apiKey: env.STEEL_API_KEY || undefined,
      }
    : undefined;
  if ((jobProvider === 'steel' || captureProvider === 'steel') && !steel) {
    throw new Error(
      'STEEL_API_URL is required when a provider is set to steel'
    );
  }
  const kernel = env.KERNEL_API_KEY
    ? { apiKey: env.KERNEL_API_KEY, baseUrl: env.KERNEL_API_URL || undefined }
    : undefined;
  if ((jobProvider === 'kernel' || captureProvider === 'kernel') && !kernel) {
    throw new Error(
      'KERNEL_API_KEY is required when a provider is set to kernel'
    );
  }
  return {
    port,
    token,
    publicUrl,
    jobProvider,
    captureProvider,
    steel,
    kernel,
    captureTtlMs: Number(env.AGENT_RUNNER_CAPTURE_TTL_MS || 20 * 60_000),
    pacing: env.AGENT_RUNNER_PACING !== 'false',
  };
}
