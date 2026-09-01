
export type Headers = Record<string, string | string[] | undefined>;

/** Base class for Twitter API related exceptions. */
export class TwitterException extends Error {
  readonly headers: Record<string, string | string[] | undefined> | null;

  constructor(message?: string, options?: { headers?: Headers | null }) {
    super(message);
    this.name = new.target.name;
    const headers = options?.headers;
    this.headers = headers ? { ...headers } : null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised for 400 Bad Request errors. */
export class BadRequest extends TwitterException {}
/** Raised for 401 Unauthorized errors. */
export class Unauthorized extends TwitterException {}
/** Raised for 403 Forbidden errors. */
export class Forbidden extends TwitterException {}
/** Raised for 404 Not Found errors. */
export class NotFound extends TwitterException {}
/** Raised for 408 Request Timeout errors. */
export class RequestTimeout extends TwitterException {}

/** Raised for 429 Too Many Requests errors. */
export class TooManyRequests extends TwitterException {
  /** Unix timestamp at which the rate limit resets, if the server reported one. */
  readonly rateLimitReset: number | null;

  constructor(message?: string, options?: { headers?: Headers | null }) {
    super(message, options);
    const raw = this.headers?.['x-rate-limit-reset'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    this.rateLimitReset = value === undefined ? null : Number.parseInt(value, 10);
  }
}

/** Raised for 5xx Server Error responses. */
export class ServerError extends TwitterException {}
/** Raised when a tweet could not be sent. */
export class CouldNotTweet extends TwitterException {}
/** Raised when a tweet is a duplicate of another. */
export class DuplicateTweet extends CouldNotTweet {}
/** Raised when a tweet is not available. */
export class TweetNotAvailable extends TwitterException {}
/** Raised when there is a problem with the media ID sent with the tweet. */
export class InvalidMedia extends TwitterException {}
/** Raised when a user does not exist. */
export class UserNotFound extends TwitterException {}
/** Raised when a user is unavailable. */
export class UserUnavailable extends TwitterException {}
/** Raised when the account is suspended. */
export class AccountSuspended extends TwitterException {}
/** Raised when the account is locked (very likely an Arkose challenge). */
export class AccountLocked extends TwitterException {}

export const ERROR_CODE_TO_EXCEPTION: Record<number, new (message?: string) => TwitterException> = {
  187: DuplicateTweet,
  324: InvalidMedia,
};

export interface ApiError {
  code?: number;
  message?: string;
  extensions?: { code?: number };
  [key: string]: unknown;
}

export function raiseExceptionsFromResponse(errors: ApiError[]): void {
  for (const error of errors) {
    let code = error.code;
    if (code === undefined || !(code in ERROR_CODE_TO_EXCEPTION)) {
      code = error.extensions?.code;
    }
    if (code === undefined) continue;
    const Exception = ERROR_CODE_TO_EXCEPTION[code];
    if (Exception !== undefined) {
      throw new Exception(error.message);
    }
  }
}
