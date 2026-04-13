import { createRemoteJWKSet, jwtVerify } from 'jose';
import { InvalidInputError, OidcError } from './errors.js';
import type { OidcTokenPayload } from './types.js';

/**
 * Module-level caches that survive across warm Lambda invocations.
 * Cold starts clear them naturally.
 */
const discoveryCache = new Map<string, string>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verify an OIDC id_token against the provider's public keys.
 *
 * 1. Fetches the OIDC discovery document to find the `jwks_uri`.
 * 2. Verifies the JWT signature against the provider's JWKS.
 * 3. Validates standard claims: `iss`, `aud`, `exp`.
 * 4. Returns the validated payload.
 *
 * Both the discovery document and the JWKS function are cached per
 * issuer in module scope — warm Lambda invocations skip the network
 * round-trips. `jose`'s `createRemoteJWKSet` handles key rotation
 * internally (refetches when it encounters an unknown `kid`).
 *
 * @throws {InvalidInputError} If inputs are missing or empty.
 * @throws {OidcError} If discovery fails, the token is invalid, or
 *   any claim check fails. The error message is generic — the
 *   underlying `jose` error is logged but not exposed to callers.
 *
 * @example
 * ```ts
 * try {
 *   const payload = await verifyIdToken('eyJ...', {
 *     issuer: 'https://idp.example.com',
 *     clientId: 'my-client-id',
 *   });
 *   console.log(payload.email);
 * } catch (err) {
 *   if (err instanceof OidcError) {
 *     // token is invalid — deny the request
 *   }
 * }
 * ```
 */
export async function verifyIdToken(
  idToken: string,
  config: { issuer: string; clientId: string },
): Promise<OidcTokenPayload> {
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new InvalidInputError('idToken must be a non-empty string');
  }
  if (typeof config?.issuer !== 'string' || config.issuer.length === 0) {
    throw new InvalidInputError('config.issuer must be a non-empty string');
  }
  if (typeof config?.clientId !== 'string' || config.clientId.length === 0) {
    throw new InvalidInputError('config.clientId must be a non-empty string');
  }

  const jwksUri = await getJwksUri(config.issuer);
  const jwks = getJWKS(jwksUri);

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(idToken, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    console.warn('id_token verification failed', {
      issuer: config.issuer,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new OidcError('Invalid id_token');
  }

  const email =
    typeof payload.email === 'string' && payload.email.length > 0
      ? payload.email
      : typeof payload.preferred_username === 'string' &&
          payload.preferred_username.length > 0
        ? payload.preferred_username
        : undefined;

  return {
    sub: typeof payload.sub === 'string' ? payload.sub : '',
    email,
    preferredUsername:
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : undefined,
  };
}

async function getJwksUri(issuer: string): Promise<string> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const url = `${issuer}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new OidcError(
      `Failed to fetch OIDC discovery document from ${issuer}`,
    );
  }

  if (!res.ok) {
    throw new OidcError(
      `OIDC discovery returned ${res.status} from ${issuer}`,
    );
  }

  let doc: Record<string, unknown>;
  try {
    doc = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OidcError('OIDC discovery document is not valid JSON');
  }

  const jwksUri = doc.jwks_uri;
  if (typeof jwksUri !== 'string' || jwksUri.length === 0) {
    throw new OidcError('OIDC discovery document has no jwks_uri');
  }

  discoveryCache.set(issuer, jwksUri);
  return jwksUri;
}

function getJWKS(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}
