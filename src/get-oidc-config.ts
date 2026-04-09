import { InvalidInputError } from './errors.js';
import type { OidcConfig, Queryable } from './types.js';

const SELECT_AUTH_DOMAIN = `
  SELECT
    integration_type    AS "integrationType",
    integration_params  AS "integrationParams"
  FROM auth_domains
  WHERE code = $1
`;

/**
 * Look up the auth-domain configuration for a tenant code.
 *
 * Returns the row from `auth_domains` where `code = $1`, or `null` if
 * no row matches. Use this in a sign-in page (or wherever you need to
 * resolve a tenant slug to a single-sign-on configuration) to figure
 * out which provider to redirect to.
 *
 * The library is provider-agnostic — it doesn't interpret
 * `integration_type` or `integration_params`. It just returns whatever
 * is in the database. The function name is `getOidcConfig` for
 * historical reasons; OIDC is the most common case but the same row
 * can describe SAML, OAuth2, or any other integration kind your
 * application supports.
 *
 * @example
 * ```ts
 * const config = await getOidcConfig(db, tenantCode);
 * if (!config) {
 *   return notFound();
 * }
 * if (config.integrationType !== 'oidc') {
 *   return badRequest('unsupported integration');
 * }
 * // config.integrationParams is the OIDC client config
 * ```
 *
 * @typeParam TParams - Optional narrow type for `integration_params`.
 *   Defaults to `Record<string, unknown>`. Specify this in a thin
 *   wrapper if you want compile-time guarantees about which fields
 *   are present.
 *
 * @throws {InvalidInputError} If `db` is missing or `code` is not a
 *   non-empty string.
 */
export async function getOidcConfig<TParams = Record<string, unknown>>(
  db: Queryable,
  code: string,
): Promise<OidcConfig<TParams> | null> {
  if (!db) {
    throw new InvalidInputError('db is required');
  }
  if (typeof code !== 'string' || code.length === 0) {
    throw new InvalidInputError('code must be a non-empty string');
  }

  const { rows } = await db.query<OidcConfig<TParams>>(SELECT_AUTH_DOMAIN, [
    code,
  ]);
  return rows[0] ?? null;
}
