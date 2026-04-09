# @smplcty/oidc

Tiny TypeScript helper for looking up per-tenant OIDC (and other) auth-domain configuration from a Postgres `auth_domains` table.

[![npm](https://img.shields.io/npm/v/@smplcty/oidc.svg)](https://www.npmjs.com/package/@smplcty/oidc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What this is

A 50-line, dependency-free helper around one query: "given a tenant code, what's the SSO integration?" The library is provider-agnostic — it returns whatever's in the `auth_domains` table, whether that's OIDC, SAML, OAuth2, or anything else your application understands.

The function is named `getOidcConfig` for historical reasons. OIDC is the most common case but the same row can describe any integration.

## Install

```sh
pnpm add @smplcty/oidc pg
```

`pg` is a peer dependency.

## Usage

```ts
import { getOidcConfig } from '@smplcty/oidc';

const config = await getOidcConfig(db, tenantCode);
if (!config) {
  // No SSO configured for this tenant — fall back to your default flow
  return notFound();
}

if (config.integrationType === 'oidc') {
  // config.integrationParams is the OIDC client config
  // (clientId, clientSecret, issuer, etc.)
  return redirectToOidcProvider(config.integrationParams);
}

if (config.integrationType === 'saml') {
  return redirectToSamlProvider(config.integrationParams);
}

return badRequest('unsupported integration');
```

## API

### `getOidcConfig(db, code)`

```ts
import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

interface OidcConfig<TParams = Record<string, unknown>> {
  readonly integrationType: string;
  readonly integrationParams: TParams;
}

function getOidcConfig<TParams = Record<string, unknown>>(
  db: Queryable,
  code: string,
): Promise<OidcConfig<TParams> | null>;
```

Returns the row from `auth_domains` where `code = $1`, or `null` if no row matches. Throws `InvalidInputError` if `db` is missing or `code` is empty.

The library does not interpret `integration_type` or `integration_params`. Whatever is in those columns is what gets returned.

### Typed `integration_params` via the generic

By default `integrationParams` is typed as `Record<string, unknown>`. To get compile-time guarantees about which fields exist, pass a specific type:

```ts
interface OidcParams {
  clientId: string;
  clientSecret: string;
  issuer: string;
  scopes?: string[];
}

const config = await getOidcConfig<OidcParams>(db, tenantCode);
if (config) {
  // config.integrationParams.clientId is string, no narrowing needed
  redirectToOidcProvider(config.integrationParams);
}
```

The runtime behavior is identical — the generic just narrows the TypeScript type. If your application has multiple integration kinds, write a thin wrapper:

```ts
type AppIntegration =
  | { integrationType: 'oidc'; integrationParams: OidcParams }
  | { integrationType: 'saml'; integrationParams: SamlParams };

export async function getAppAuthConfig(
  db: Queryable,
  code: string,
): Promise<AppIntegration | null> {
  const row = await getOidcConfig(db, code);
  if (!row) return null;
  return row as AppIntegration;
}
```

## Required database schema

The library reads one table. The shipped schema lives at `node_modules/@smplcty/oidc/schema/`:

```
@smplcty/oidc/schema/
└── tables/
    └── auth_domains.yaml
```

### If you use [`@smplcty/schema-flow`](https://www.npmjs.com/package/@smplcty/schema-flow)

Copy the file in:

```sh
cp node_modules/@smplcty/oidc/schema/tables/auth_domains.yaml schema/tables/
npx @smplcty/schema-flow run
```

### If you use any other migration tool

Translate to DDL:

```sql
CREATE TABLE auth_domains (
  auth_domain_id      SERIAL PRIMARY KEY,
  tenant_id           INT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  integration_type    TEXT NOT NULL,
  integration_params  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The library only reads `integration_type` and `integration_params` and looks up by `code`. Adding columns is fine; renaming or dropping the read columns will break it.

## Why no env var reads, no logging, no error wrapping

The previous internal `@mabulu-inc/oidc` package had a few audit-flagged behaviors that this rewrite removes:

| Previous | This package |
|---|---|
| `console.debug('Looking for OIDC config for domain code:', code)` — logs the tenant identifier on every call | No `console.*` calls. The library is silent unless your pg client logs. |
| `console.error('Failed to retrieve OIDC config for domain code: ${code}', error)` on rejection | No error path logging. pg errors propagate naturally with their original stacks. |
| Wrapped errors with `throw new Error(...)`, losing the original stack | Throws `InvalidInputError` with `code` discriminator for input validation; lets pg errors propagate as-is for query failures (preserves stack traces). |
| String-error throws like `throw new Error('Database connection is required')` | Typed `InvalidInputError` extends `OidcError` with a `code` discriminator. |

## License

MIT — see [LICENSE](LICENSE).
