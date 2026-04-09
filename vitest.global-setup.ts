import { execSync } from 'node:child_process';

/**
 * Two modes:
 *
 * 1. **Local dev (default).** No `DATABASE_URL` set → start the
 *    docker-compose Postgres in `docker-compose.yml`, leave it running
 *    between test runs.
 *
 * 2. **CI / external Postgres.** `DATABASE_URL` set by the caller →
 *    skip docker-compose.
 */
export default function setup(): void {
  if (process.env.DATABASE_URL) {
    return;
  }

  execSync('docker compose up -d --wait', {
    stdio: 'inherit',
    cwd: import.meta.dirname,
  });

  process.env.DATABASE_URL =
    'postgresql://postgres:postgres@localhost:54321/postgres';
}
