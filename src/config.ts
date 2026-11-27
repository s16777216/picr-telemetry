/** The settings of the service, from environment variables
 * (`add-review-trace-server` design, Decision 8). */
export interface Config {
  host: string;
  ingestPort: number;
  uiPort: number;
  databasePath: string;
  retentionDays: number;
}

export class ConfigError extends Error {}

function port(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ConfigError(`${name} must be a port number from 1 to 65535, not "${raw}".`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError(`${name} must be a whole number of 1 or more, not "${raw}".`);
  }
  return value;
}

/** Reads the settings. Throws `ConfigError` with a clear message for a value that is not valid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST?.trim() || '0.0.0.0',
    ingestPort: port(env, 'INGEST_PORT', 4318),
    uiPort: port(env, 'UI_PORT', 8080),
    databasePath: env.DATABASE_PATH?.trim() || './data/picr-telemetry.sqlite',
    retentionDays: positiveInteger(env, 'RETENTION_DAYS', 90),
  };
}
