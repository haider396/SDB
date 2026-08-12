/**
 * Boot entry. Env validation failure exits non-zero with a clear message
 * listing the missing keys (AC-NFR-05) before anything else starts.
 */
import { buildApp } from './app.js';
import { EnvValidationError, loadEnv } from './lib/env.js';
import { createLogger } from './lib/logger.js';
import { registerJobs } from './jobs/index.js';

function fail(message: string): never {
  // Deliberate console usage: the logger cannot exist without a valid env.
   
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      fail(error.message);
    }
    throw error;
  }

  const logger = createLogger(env);
  const app = await buildApp({ env, logger });
  const jobs = registerJobs(logger);

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    jobs.stop();
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
   
  console.error(error);
  process.exit(1);
});
