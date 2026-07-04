/**
 * loadDotEnv — load a local `.env` file into `process.env` when present, using
 * Node's built-in env-file support (Node >=22; no dependency). Real environment
 * variables take precedence — the file only fills what isn't already set — and a
 * missing `.env` is a silent no-op.
 *
 * Call this from real entrypoints only (server bootstrap, CLI scripts), never at
 * module-import time, so that tests importing modules directly are unaffected by
 * whatever `.env` happens to sit in the working directory.
 */
export function loadDotEnv(): void {
  try {
    (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
  } catch {
    // No .env file present — the environment is configured another way. Fine.
  }
}
