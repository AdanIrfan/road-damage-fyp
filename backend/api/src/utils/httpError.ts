/**
 * An error with an HTTP status and a message that is safe to show to API clients.
 * `details` must also be safe to show (e.g. field validation messages, retry delays).
 * Put internal details in `cause`; they are logged on the server but never sent.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options?.details;
  }
}
