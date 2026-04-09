import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPED_AUTH_DOMAINS = path.resolve(
  HERE,
  '../schema/tables/auth_domains.yaml',
);
const FIXTURE_AUTH_DOMAINS = path.resolve(
  HERE,
  './fixtures/schema/tables/auth_domains.yaml',
);

/**
 * Strip everything after the first `seeds:` line and any comment lines
 * starting with `#`. The shipped file is canonical and has no seeds;
 * the fixture has the same shape plus inline `seeds:`. After stripping
 * comments and the seeds block from the fixture, the two files should
 * have identical column definitions and unique_constraints.
 *
 * If they drift (a column added to one but not the other, a type
 * change, a constraint rename), this test fails and points at the
 * exact diff.
 */
function normalizeForDriftCheck(yaml: string): string {
  const lines = yaml.split('\n');
  const stripped: string[] = [];
  let inSeedsBlock = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    // Drop entire-line comments and blank lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;
    // Drop the seeds block (everything from `seeds:` onward at top level)
    if (/^seeds(_on_conflict)?:/.test(line)) {
      inSeedsBlock = true;
      continue;
    }
    if (inSeedsBlock) {
      // Continue stripping until we hit a top-level key (non-indented).
      // For YAML, top-level keys have no leading whitespace. Anything
      // indented after `seeds:` is still part of the block.
      if (/^\S/.test(line)) {
        inSeedsBlock = false;
      } else {
        continue;
      }
    }
    stripped.push(line);
  }
  return stripped.join('\n').trim();
}

describe('schema drift detection', () => {
  it('shipped schema/tables/auth_domains.yaml matches the test fixture (ignoring seeds and comments)', async () => {
    const [shipped, fixture] = await Promise.all([
      readFile(SHIPPED_AUTH_DOMAINS, 'utf8'),
      readFile(FIXTURE_AUTH_DOMAINS, 'utf8'),
    ]);

    const shippedNormalized = normalizeForDriftCheck(shipped);
    const fixtureNormalized = normalizeForDriftCheck(fixture);

    expect(fixtureNormalized).toBe(shippedNormalized);
  });
});
