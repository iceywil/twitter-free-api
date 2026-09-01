
import { GQLClient } from '../client/gql.js';
import type { ApiResult } from '../client/gql.js';
import { V11Client } from '../client/v11.js';
import { DOMAIN, TOKEN } from '../constants.js';
import {
  BadRequest,
  Forbidden,
  NotFound,
  RequestTimeout,
  ServerError,
  TooManyRequests,
  TwitterException,
  Unauthorized,
} from '../errors.js';
import { HttpSession, type HttpResponse, type RequestOptions } from '../internal/http.js';
import { TransactionManager } from '../internal/transactionManager.js';
import type { ClientTransaction } from '../transaction/transaction.js';
import { Result, findDict, findEntryByType } from '../utils.js';
import { GuestTweet } from './tweet.js';
import { GuestUser } from './user.js';

const GUEST_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface GuestClientOptions {
  language?: string;
  proxy?: string | null;
  timeout?: number;
  /**
   * Throw if the `x-client-transaction-id` header cannot be generated, instead
   * of continuing without it. Defaults to false.
   */
  requireTransactionId?: boolean;
  /** Suppress the warning emitted when that header is unavailable. */
  silent?: boolean;
}

/** Builds a `GuestTweet` from a raw GraphQL result, or `null` when unusable. */
export function guestTweetFromData(
  client: GuestClient,
  data: unknown
): GuestTweet | null {
  const found = findDict(data, 'result', true);
  if (found.length === 0) return null;

  let tweetData = found[0];
  if (tweetData?.__typename === 'TweetTombstone') return null;
  if (tweetData?.tweet) tweetData = tweetData.tweet;

  if (!tweetData?.core) return null;
  if (!tweetData.core.user_results?.result) return null;
  if (!tweetData.legacy) return null;

  const userData = tweetData.core.user_results.result;
  return new GuestTweet(client, tweetData, new GuestUser(client, userData));
}

/**
 * A read-only client that needs no account — it authenticates with a guest
 * token instead.
 *
 * @example
 * const client = new GuestClient();
 * await client.activate();
 * const user = await client.getUserByScreenName('example');
 */
export class GuestClient {
  readonly http: HttpSession;
  language: string;
  private readonly transactions: TransactionManager;

  readonly gql: GQLClient;
  readonly v11: V11Client;

  private token = TOKEN;
  private agent = GUEST_USER_AGENT;
  /** Set once {@link activate} has been called. */
  private guestToken: string | null = null;

  constructor(options: GuestClientOptions = {}) {
    this.http = new HttpSession({
      proxy: options.proxy ?? null,
      timeout: options.timeout,
    });
    this.language = options.language ?? 'en-US';
    this.transactions = new TransactionManager({
      requireTransactionId: options.requireTransactionId,
      silent: options.silent,
    });

    this.gql = new GQLClient(this);
    this.v11 = new V11Client(this);
  }

  get userAgent(): string {
    return this.agent;
  }

  set userAgent(value: string) {
    this.agent = value;
  }

  /** The underlying transaction-id generator. */
  get clientTransaction(): ClientTransaction {
    return this.transactions.transaction;
  }

  get proxy(): string | null {
    return this.http.proxy;
  }

  set proxy(url: string | null) {
    this.http.proxy = url;
  }

  /** @internal */
  async request<T = any>(
    method: string,
    url: string,
    options: RequestOptions & { raiseException?: boolean } = {}
  ): Promise<ApiResult<T>> {
    const { raiseException = true, ...requestOptions } = options;
    const headers: Record<string, string> = { ...requestOptions.headers };

    await this.transactions.apply(this.http, method, url, headers, {
      language: this.language,
      userAgent: this.agent,
    });

    const response = await this.http.request(method, url, { ...requestOptions, headers });

    let responseData: unknown = response.data;
    if (typeof response.data === 'string') {
      try {
        responseData = JSON.parse(response.data);
      } catch {
        responseData = response.text;
      }
    }

    const statusCode = response.status;

    if (statusCode >= 400 && raiseException) {
      const message = `status: ${statusCode}, message: "${response.text}"`;
      const errorOptions = { headers: response.headers };

      if (statusCode === 400) throw new BadRequest(message, errorOptions);
      if (statusCode === 401) throw new Unauthorized(message, errorOptions);
      if (statusCode === 403) throw new Forbidden(message, errorOptions);
      if (statusCode === 404) throw new NotFound(message, errorOptions);
      if (statusCode === 408) throw new RequestTimeout(message, errorOptions);
      if (statusCode === 429) throw new TooManyRequests(message, errorOptions);
      if (statusCode >= 500 && statusCode < 600) throw new ServerError(message, errorOptions);
      throw new TwitterException(message, errorOptions);
    }

    return [responseData as T, response];
  }

  /** @internal */
  async get<T = any>(url: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    return this.request<T>('GET', url, options);
  }

  /** @internal */
  async post<T = any>(url: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    return this.request<T>('POST', url, options);
  }

  /** @internal — the guest client has no CSRF token. */
  getCsrfToken(): string | undefined {
    return undefined;
  }

  /** @internal */
  get baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
      'X-Twitter-Active-User': 'yes',
      Referer: `https://${DOMAIN}`,
    };

    if (this.language != null) {
      headers['Accept-Language'] = this.language;
      headers['X-Twitter-Client-Language'] = this.language;
    }
    if (this.guestToken !== null) {
      headers['X-Guest-Token'] = this.guestToken;
    }

    return headers;
  }

  /**
   * Obtains a guest token. Must be called before any other method.
   *
   * @example
   * await client.activate();
   */
  async activate(): Promise<string> {
    const [response] = await this.v11.guestActivate();
    this.guestToken = response.guest_token;
    return this.guestToken as string;
  }

  /** Fetches a user by screen name (handle). */
  async getUserByScreenName(screenName: string): Promise<GuestUser> {
    const [response] = await this.gql.userByScreenName(screenName);
    return new GuestUser(this, response.data.user.result);
  }

  /** Fetches a user by ID. */
  async getUserById(userId: string): Promise<GuestUser> {
    const [response] = await this.gql.userByRestId(userId);
    return new GuestUser(this, response.data.user.result);
  }

  /** Retrieves a user's tweets. */
  async getUserTweets(
    userId: string,
    tweetType: 'Tweets' = 'Tweets',
    count = 40
  ): Promise<GuestTweet[]> {
    const [response] = await this.gql.userTweets(userId, count, null);

    const instructionsFound = findDict(response, 'instructions', true);
    if (instructionsFound.length === 0) return [];

    const instruction = findEntryByType(
      instructionsFound[0] as { type?: string }[],
      'TimelineAddEntries'
    ) as { entries: any[] } | null;
    if (instruction === null) return [];

    const results: GuestTweet[] = [];
    for (const item of instruction.entries) {
      const entryId = String(item.entryId);
      if (
        !entryId.startsWith('tweet') &&
        !entryId.startsWith('profile-conversation') &&
        !entryId.startsWith('profile-grid')
      ) {
        continue;
      }
      const tweet = guestTweetFromData(this, item);
      if (tweet === null) continue;
      results.push(tweet);
    }
    return results;
  }

  /** Fetches a tweet by ID. */
  async getTweetById(tweetId: string): Promise<GuestTweet | null> {
    const [response] = await this.gql.tweetResultByRestId(tweetId);
    return guestTweetFromData(this, response);
  }

  /** Retrieves highlighted tweets from a user's timeline. */
  async getUserHighlightsTweets(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<GuestTweet>> {
    const [response] = await this.gql.userHighlightsTweets(userId, count, cursor);
    const instructions =
      response.data.user.result.timeline.timeline.instructions as { type?: string }[];
    const instruction = findEntryByType(instructions, 'TimelineAddEntries') as
      | { entries: any[] }
      | null;
    if (instruction === null) return Result.empty<GuestTweet>();

    let previousCursor: string | null = null;
    let nextCursor: string | null = null;
    const results: GuestTweet[] = [];

    for (const entry of instruction.entries) {
      const entryId: string = entry.entryId;
      if (entryId.startsWith('tweet')) {
        const tweet = guestTweetFromData(this, entry);
        if (tweet !== null) results.push(tweet);
      } else if (entryId.startsWith('cursor-top')) {
        previousCursor = entry.content.value;
      } else if (entryId.startsWith('cursor-bottom')) {
        nextCursor = entry.content.value;
      }
    }

    return new Result<GuestTweet>(
      results,
      () => this.getUserHighlightsTweets(userId, count, nextCursor),
      nextCursor,
      () => this.getUserHighlightsTweets(userId, count, previousCursor),
      previousCursor
    );
  }
}
