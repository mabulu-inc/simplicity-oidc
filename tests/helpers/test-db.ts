import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { useTestProject, writeSchema } from '@smplcty/schema-flow/testing';
import type { TestProject } from '@smplcty/schema-flow/testing';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The test fixture is a complete schema-flow project (tables/, post/,
// etc.) that mirrors the shipped schema/ directory and adds inline
// seeds for the test data. This is what gets applied to the test
// database — schema-flow handles tables AND seeds in one migrate pass,
// so the test helper has zero raw-SQL apply steps.
//
// The shipped schema/tables/*.yaml files are NOT applied directly by
// the test suite. Drift between them and this fixture would silently
// pass tests, so tests/drift-detect.test.ts asserts the column lists
// and unique_constraints are byte-equivalent (ignoring `seeds`).
const TEST_FIXTURE_SCHEMA_DIR = path.resolve(HERE, '../fixtures/schema');

async function loadFixtureFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const subdir of ['tables', 'post', 'pre', 'enums', 'functions', 'views']) {
    const dir = path.join(TEST_FIXTURE_SCHEMA_DIR, subdir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry);
      const content = await readFile(abs, 'utf8');
      out[`${subdir}/${entry}`] = content;
    }
  }
  return out;
}

export interface TestDb {
  pool: pg.Pool;
  connectionString: string;
  shutdown: () => Promise<void>;
}

/**
 * Bring up a fresh isolated database for the test file.
 *
 * Each call:
 *   1. Carves out a new database under DATABASE_URL via schema-flow's
 *      `useTestProject`.
 *   2. Copies the test fixture schema (tables + inline seeds) into
 *      the project's temp dir.
 *   3. Runs `ctx.migrate()` to apply tables AND seeds in one pass.
 *   4. Returns a `pg.Pool` and a `shutdown` function.
 *
 * One TestDb per file, share across describe blocks. See the
 * feedback_schema_flow_test_db_per_file memory for the rationale.
 */
export async function startTestDb(): Promise<TestDb> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      'DATABASE_URL is not set. The vitest globalSetup is responsible for ' +
        'starting docker compose and exporting DATABASE_URL — make sure ' +
        'vitest.config.ts has globalSetup wired up.',
    );
  }

  const ctx: TestProject = await useTestProject(adminUrl);

  writeSchema(ctx.dir, await loadFixtureFiles());

  await ctx.migrate();

  const pool = new pg.Pool({ connectionString: ctx.connectionString, max: 4 });

  return {
    pool,
    connectionString: ctx.connectionString,
    async shutdown() {
      await pool.end();
      await ctx.cleanup();
    },
  };
}
