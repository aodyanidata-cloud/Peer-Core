/**
 * ValidationError — a domain error for rejected input that must surface as an
 * HTTP 400, not a 500. Service methods validate their arguments with this
 * instead of a bare `throw new Error(...)`, so once a method is reachable over
 * HTTP the DomainExceptionFilter maps it to a clean 400 { error: { code } }
 * (any unlisted code defaults to 400) rather than leaking a 500.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: string = 'invalid_input',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
