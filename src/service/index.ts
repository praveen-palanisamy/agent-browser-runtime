/**
 * Agent runner service entry point.
 *
 *   import { startRunner } from 'agent-browser-runtime/service';
 *   startRunner({ strategies: [new MyPlatformStrategy()] });
 *
 * The runner is platform-agnostic; the embedding application supplies the
 * `WebPostStrategy` implementations it wants to expose.
 */

import type { AuditSink, WebPostStrategy } from '../core/types';
import { loadConfig } from './config';
import { AgentRunner, type ProviderFactory } from './runner';
import { createRunnerServer } from './server';

export { loadConfig, type ProviderKind, type RunnerConfig } from './config';
export {
  handleLiveHttp,
  handleLiveUpgrade,
  parseLivePath,
  rewriteLiveHtml,
} from './live-proxy';
export {
  AgentRunner,
  defaultProviderFactory,
  type ProviderFactory,
} from './runner';
export { Mutex, SerializedProvider } from './serialized-provider';
export { createRunnerServer, HttpError, isAuthorized } from './server';

export type StartRunnerOptions = {
  strategies: WebPostStrategy[];
  env?: NodeJS.ProcessEnv;
  providerFactory?: ProviderFactory;
  audit?: AuditSink;
  onListening?: (info: { port: number }) => void;
};

export function startRunner(opts: StartRunnerOptions) {
  const config = loadConfig(opts.env ?? process.env);
  const runner = new AgentRunner(
    config,
    opts.strategies,
    opts.providerFactory,
    opts.audit
  );
  const server = createRunnerServer(runner);
  server.listen(config.port, () => {
    console.log(
      `[agent-browser-runtime] listening on :${config.port} jobs=${config.jobProvider} capture=${config.captureProvider} public=${config.publicUrl} strategies=${opts.strategies
        .map((s) => s.platform)
        .join(',')}`
    );
    opts.onListening?.({ port: config.port });
  });
  const stop = async () => {
    server.close();
    await runner.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { server, runner, config };
}
