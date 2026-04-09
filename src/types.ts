import type { Pool, PoolClient } from 'pg';

/**
 * A `pg.Pool` or any single checked-out `pg.PoolClient`. Functions in
 * this library issue a single SELECT, so either works fine.
 */
export type Queryable = Pool | PoolClient;

/**
 * The shape of an `auth_domains` row, returned by `getOidcConfig`.
 *
 * @typeParam TParams - The shape of `integration_params`. Defaults to
 *   `Record<string, unknown>` so the library doesn't impose a specific
 *   provider schema. Narrow this in a thin wrapper if your application
 *   wants compile-time guarantees about which fields exist.
 */
export interface OidcConfig<
  TParams = Record<string, unknown>,
> {
  /** Provider integration kind — `'oidc'`, `'saml'`, `'oauth2'`, etc.
   *  Whatever your application stores in this column. The library does
   *  not interpret this value. */
  readonly integrationType: string;
  /** Provider-specific configuration JSON. */
  readonly integrationParams: TParams;
}
