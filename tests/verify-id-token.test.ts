import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { verifyIdToken, InvalidInputError, OidcError } from '../src/index.js';

const mockJwtVerify = vi.mocked(jwtVerify);
const mockCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'test-client-id';
const JWKS_URI = 'https://idp.example.com/.well-known/jwks.json';
const CONFIG = { issuer: ISSUER, clientId: CLIENT_ID };

function mockDiscovery(jwksUri = JWKS_URI, ok = true) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ jwks_uri: jwksUri }),
  } as Response);
}

function mockJwtPayload(payload: Record<string, unknown>) {
  const jwksFunction = vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>;
  mockCreateRemoteJWKSet.mockReturnValue(jwksFunction);
  mockJwtVerify.mockResolvedValue({
    payload,
    protectedHeader: { alg: 'RS256' },
  } as Awaited<ReturnType<typeof jwtVerify>>);
}

describe('verifyIdToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Input validation ---

  it('throws InvalidInputError on empty idToken', async () => {
    await expect(verifyIdToken('', CONFIG)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('throws InvalidInputError on empty issuer', async () => {
    await expect(
      verifyIdToken('eyJ...', { issuer: '', clientId: CLIENT_ID }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError on empty clientId', async () => {
    await expect(
      verifyIdToken('eyJ...', { issuer: ISSUER, clientId: '' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  // --- Discovery failures ---

  it('throws OidcError when discovery fetch fails (network)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('network error'),
    );
    await expect(verifyIdToken('eyJ...', CONFIG)).rejects.toThrow(OidcError);
  });

  it('throws OidcError when discovery returns non-200', async () => {
    mockDiscovery(JWKS_URI, false);
    await expect(verifyIdToken('eyJ...', CONFIG)).rejects.toThrow(OidcError);
  });

  it('throws OidcError when discovery has no jwks_uri', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issuer: ISSUER }),
    } as Response);
    await expect(verifyIdToken('eyJ...', CONFIG)).rejects.toThrow(
      'no jwks_uri',
    );
  });

  // --- JWT verification failures ---

  it('throws OidcError when jwtVerify rejects (invalid signature)', async () => {
    mockDiscovery();
    mockCreateRemoteJWKSet.mockReturnValue(
      vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
    );
    mockJwtVerify.mockRejectedValue(new Error('signature mismatch'));

    await expect(verifyIdToken('eyJ...', CONFIG)).rejects.toThrow(
      'Invalid id_token',
    );
  });

  // --- Happy paths ---

  it('returns payload with email from email claim', async () => {
    mockDiscovery();
    mockJwtPayload({
      sub: 'user-123',
      email: 'alice@example.com',
      preferred_username: 'alice',
    });

    const result = await verifyIdToken('eyJ...', CONFIG);

    expect(result).toEqual({
      sub: 'user-123',
      email: 'alice@example.com',
      preferredUsername: 'alice',
    });
  });

  it('falls back to preferred_username when email claim is absent', async () => {
    mockDiscovery();
    mockJwtPayload({
      sub: 'user-456',
      preferred_username: 'bob@example.com',
    });

    const result = await verifyIdToken('eyJ...', CONFIG);

    expect(result).toEqual({
      sub: 'user-456',
      email: 'bob@example.com',
      preferredUsername: 'bob@example.com',
    });
  });

  it('returns undefined email when neither claim is present', async () => {
    mockDiscovery();
    mockJwtPayload({ sub: 'user-789' });

    const result = await verifyIdToken('eyJ...', CONFIG);

    expect(result).toEqual({
      sub: 'user-789',
      email: undefined,
      preferredUsername: undefined,
    });
  });

  it('calls jwtVerify with correct issuer and audience', async () => {
    mockDiscovery();
    mockJwtPayload({ sub: 'user-1', email: 'test@example.com' });

    await verifyIdToken('my-id-token', CONFIG);

    expect(mockJwtVerify).toHaveBeenCalledWith(
      'my-id-token',
      expect.any(Function),
      { issuer: ISSUER, audience: CLIENT_ID },
    );
  });

  it('uses cached discovery on second call for same issuer', async () => {
    // Use a unique issuer so no previous test has warmed the cache
    const uniqueIssuer = 'https://cache-test.example.com';
    const uniqueConfig = { issuer: uniqueIssuer, clientId: CLIENT_ID };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jwks_uri: JWKS_URI }),
    } as Response);

    mockJwtPayload({ sub: 'u1', email: 'a@b.com' });
    await verifyIdToken('tok1', uniqueConfig);

    // Second call — discovery should be cached, no new fetch
    mockJwtPayload({ sub: 'u2', email: 'c@d.com' });
    const result = await verifyIdToken('tok2', uniqueConfig);

    expect(result.email).toBe('c@d.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
