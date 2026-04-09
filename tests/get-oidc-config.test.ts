import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOidcConfig, InvalidInputError } from '../src/index.js';
import { startTestDb, type TestDb } from './helpers/test-db.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await db.shutdown();
});

describe('getOidcConfig', () => {
  it('returns the OIDC config for a known domain code', async () => {
    const config = await getOidcConfig(db.pool, 'acme');
    expect(config).not.toBeNull();
    expect(config?.integrationType).toBe('oidc');
    expect(config?.integrationParams).toEqual({
      clientId: 'acme-client',
      clientSecret: 'acme-secret',
      issuer: 'https://idp.example.com/acme',
    });
  });

  it('returns the SAML config for a non-OIDC integration', async () => {
    const config = await getOidcConfig(db.pool, 'umbrella');
    expect(config).not.toBeNull();
    expect(config?.integrationType).toBe('saml');
    expect(config?.integrationParams).toEqual({
      entityId: 'https://umbrella.example.com',
      ssoUrl: 'https://idp.example.com/umbrella/sso',
    });
  });

  it('preserves nested arrays in integration_params (globex has scopes)', async () => {
    const config = await getOidcConfig(db.pool, 'globex');
    expect(config?.integrationParams).toMatchObject({
      scopes: ['openid', 'profile', 'email'],
    });
  });

  it('returns null for an unknown domain code', async () => {
    const config = await getOidcConfig(db.pool, 'nonexistent-tenant');
    expect(config).toBeNull();
  });

  it('throws InvalidInputError on missing db', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      getOidcConfig(null, 'acme'),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError on empty code', async () => {
    await expect(getOidcConfig(db.pool, '')).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('throws InvalidInputError on non-string code', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      getOidcConfig(db.pool, 42),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('rejects SQL-injection-shaped codes via parameterization', async () => {
    const malicious = "acme' OR 1=1; --";
    const config = await getOidcConfig(db.pool, malicious);
    expect(config).toBeNull();
    // Confirm table is intact
    const { rows } = await db.pool.query(
      `SELECT to_regclass('auth_domains') AS exists`,
    );
    expect(rows[0]?.exists).toBe('auth_domains');
  });

  it('supports a typed integration_params via the generic parameter', async () => {
    interface OidcParams {
      clientId: string;
      clientSecret: string;
      issuer: string;
    }
    const config = await getOidcConfig<OidcParams>(db.pool, 'acme');
    if (!config) throw new Error('expected acme config');
    // TypeScript narrows config.integrationParams to OidcParams
    const { clientId, issuer } = config.integrationParams;
    expect(clientId).toBe('acme-client');
    expect(issuer).toBe('https://idp.example.com/acme');
  });
});
