/**
 * An error with an HTTP status and a message that is safe to show to API clients.
 * Put internal details in `cause`; they are logged on the server but never sent.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
