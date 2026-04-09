/**
 * Base class for all errors thrown by `@smplcty/oidc`. Every error
 * has a `code` discriminator so consumers can `switch` on it without
 * `instanceof`.
 */
export class OidcError extends Error {
  override readonly name: string = 'OidcError';
  readonly code: string = 'OIDC_ERROR';
}

/**
 * Thrown when a function input fails validation (empty string, missing
 * db, wrong type, etc.) before the library will hit Postgres.
 */
export class InvalidInputError extends OidcError {
  override readonly name = 'InvalidInputError';
  override readonly code = 'INVALID_INPUT' as const;

  constructor(message: string) {
    super(message);
  }
}
