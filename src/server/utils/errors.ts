/** Error carrying an HTTP status and optional machine-readable code. Safe to send to the client. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Error thrown by TrelloService for any failed Trello API call.
 * `retryable` is true for 429, 5xx and network errors; false for 4xx validation/auth errors.
 * Message must never contain the API key or token.
 */
export class TrelloApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly code:
      | 'TRELLO_UNAUTHORIZED'
      | 'TRELLO_NOT_FOUND'
      | 'TRELLO_BAD_REQUEST'
      | 'TRELLO_RATE_LIMITED'
      | 'TRELLO_SERVER_ERROR'
      | 'TRELLO_NETWORK_ERROR'
      | 'TRELLO_NOT_CONFIGURED'
      | 'TRELLO_ERROR',
  ) {
    super(message);
    this.name = 'TrelloApiError';
  }
}

/** Wrap an async express handler so rejections reach the error middleware. */
export function asyncHandler<Req, Res, Next>(
  fn: (req: Req, res: Res, next: Next) => Promise<unknown>,
): (req: Req, res: Res, next: Next) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next as unknown as (err: unknown) => void);
  };
}
