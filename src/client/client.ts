/** Ported from twikit/client/client.py */

import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { TOTP } from 'otpauth';
import type { CaptchaSolver } from '../captcha/base.js';
import { DOMAIN, TOKEN } from '../constants.js';
import {
  AccountLocked,
  AccountSuspended,
  BadRequest,
  CouldNotTweet,
  Forbidden,
  InvalidMedia,
  NotFound,
  RequestTimeout,
  ServerError,
  TooManyRequests,
  TweetNotAvailable,
  TwitterException,
  Unauthorized,
  UserNotFound,
  UserUnavailable,
  raiseExceptionsFromResponse,
} from '../errors.js';
import { HttpSession, type HttpResponse, type RequestOptions } from '../internal/http.js';
import { TransactionManager } from '../internal/transactionManager.js';
import type { ClientTransaction } from '../transaction/transaction.js';
import { detectMediaType } from '../internal/mediaType.js';
import { BookmarkFolder } from '../models/bookmark.js';
import { Community, CommunityMember } from '../models/community.js';
import { Place, placesFromResponse } from '../models/geo.js';
import { Group, GroupMessage } from '../models/group.js';
import { TwitterList } from '../models/list.js';
import { Message } from '../models/message.js';
import { Notification } from '../models/notification.js';
import {
  StreamingSession,
  payloadFromData,
  type Payload,
  type StreamEvent,
} from '../models/streaming.js';
import { Location, PlaceTrend, Trend, type PlaceTrends } from '../models/trend.js';
import {
  CommunityNote,
  Poll,
  ScheduledTweet,
  Tweet,
  tweetFromData,
} from '../models/tweet.js';
import { User } from '../models/user.js';
import { solveUiMetrics } from '../uiMetrics/index.js';
import {
  Flow,
  Result,
  buildTweetData,
  buildUserData,
  findDict,
  findEntryByType,
  type SearchOptions,
} from '../utils.js';
import { GQLClient, type ApiResult } from './gql.js';
import { V11Client, V11Endpoint } from './v11.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

export interface ClientOptions {
  /** The language code to use in API requests. */
  language?: string;
  /** Proxy server URL, e.g. `http://0.0.0.0:0000` or `socks5://...`. */
  proxy?: string | null;
  captchaSolver?: CaptchaSolver | null;
  userAgent?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /**
   * Throw if the `x-client-transaction-id` header cannot be generated, instead
   * of continuing without it. Defaults to false.
   */
  requireTransactionId?: boolean;
  /** Suppress the warning emitted when that header is unavailable. */
  silent?: boolean;
  /**
   * Called when login needs a code typed in (email confirmation, 2FA without a
   * TOTP secret). Defaults to reading a line from stdin.
   */
  prompt?: (message: string) => Promise<string>;
}

export interface LoginOptions {
  /** Username, email address, or phone number. */
  authInfo1: string;
  /** A second identifier — optional, but recommended. */
  authInfo2?: string;
  password: string;
  /** TOTP secret key for two-factor authentication. */
  totpSecret?: string;
  /**
   * Path used to store and load cookies. If the file exists, cookies are loaded
   * from it and the login is skipped; otherwise cookies are saved there on success.
   */
  cookiesFile?: string;
  /**
   * When true, the obfuscated `ui_metrics` function is executed and its result
   * sent to the API. Enabling this may reduce the risk of account suspension.
   */
  enableUiMetrics?: boolean;
}

/**
 * A client for interacting with the Twitter/X API.
 *
 * @example
 * const client = new Client({ language: 'en-US' });
 * await client.login({
 *   authInfo1: 'example_user',
 *   authInfo2: 'email@example.com',
 *   password: '00000000',
 * });
 */
export class Client {
  readonly http: HttpSession;
  language: string;
  captchaSolver: CaptchaSolver | null;
  private readonly transactions: TransactionManager;

  readonly gql: GQLClient;
  readonly v11: V11Client;

  /** Attempts `getTrends` makes before giving up on an empty response. */
  static readonly MAX_TREND_ATTEMPTS = 10;

  private token = TOKEN;
  private currentUserId: string | null = null;
  private agent: string;
  private actAs: string | null = null;
  private readonly promptFn: (message: string) => Promise<string>;

  constructor(options: ClientOptions = {}) {
    this.http = new HttpSession({
      proxy: options.proxy ?? null,
      timeout: options.timeout,
    });
    this.language = options.language ?? 'en-US';
    this.captchaSolver = options.captchaSolver ?? null;
    if (this.captchaSolver) this.captchaSolver.client = this;
    this.transactions = new TransactionManager({
      requireTransactionId: options.requireTransactionId,
      silent: options.silent,
    });

    this.agent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.promptFn = options.prompt ?? defaultPrompt;

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
    options: RequestOptions & { autoUnlock?: boolean; raiseException?: boolean } = {}
  ): Promise<ApiResult<T>> {
    const { autoUnlock = true, raiseException = true, ...requestOptions } = options;
    const headers: Record<string, string> = { ...requestOptions.headers };

    await this.transactions.apply(this.http, method, url, headers, {
      language: this.language,
      userAgent: this.agent,
    });

    const cookiesBackup = { ...this.getCookies() };
    let response = await this.http.request(method, url, { ...requestOptions, headers });
    this.http.removeDuplicateCt0Cookie();

    let responseData: unknown = parseBody(response);

    if (isRecord(responseData) && Array.isArray(responseData.errors)) {
      const firstError = responseData.errors[0] ?? {};
      const errorCode = firstError.code;
      const errorMessage = firstError.message;

      if (errorCode === 37 || errorCode === 64) {
        throw new AccountSuspended(errorMessage);
      }

      if (errorCode === 326) {
        if (this.captchaSolver === null) {
          throw new AccountLocked(
            `Your account is locked. Visit https://${DOMAIN}/account/access to unlock it.`
          );
        }
        if (autoUnlock) {
          await this.unlock();
          this.setCookies(cookiesBackup, true);
          response = await this.http.request(method, url, requestOptions);
          this.http.removeDuplicateCt0Cookie();
          responseData = parseBody(response);
        }
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
      if (statusCode === 429) {
        if ((await this.getUserState()) === 'suspended') {
          throw new AccountSuspended(message, errorOptions);
        }
        throw new TooManyRequests(message, errorOptions);
      }
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

  /** @internal */
  getCsrfToken(): string | undefined {
    return this.http.getCookie('ct0');
  }

  /** Base headers sent with every API request. @internal */
  get baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      Referer: `https://${DOMAIN}/`,
      'User-Agent': this.agent,
    };

    if (this.language != null) {
      headers['Accept-Language'] = this.language;
      headers['X-Twitter-Client-Language'] = this.language;
    }

    const csrfToken = this.getCsrfToken();
    if (csrfToken !== undefined) headers['X-Csrf-Token'] = csrfToken;
    if (this.actAs !== null) headers['X-Act-As-User-Id'] = this.actAs;

    return headers;
  }

  private async getGuestToken(): Promise<string> {
    const [response] = await this.v11.guestActivate();
    return response.guest_token;
  }

  private async uiMetrics(): Promise<string> {
    // twitter.com (not x.com) is required here.
    const [response] = await this.get<string>('https://twitter.com/i/js_inst?c_name=ui_metrics');
    return String(response);
  }

  /**
   * Logs into the account.
   *
   * `authInfo1` and `password` are required; `authInfo2` is optional but
   * recommended. The order of the two identifiers is flexible.
   *
   * @example
   * await client.login({
   *   authInfo1: 'example_user',
   *   authInfo2: 'email@example.com',
   *   password: '00000000',
   *   cookiesFile: 'cookies.json',
   * });
   */
  async login(options: LoginOptions): Promise<Record<string, any> | undefined> {
    const {
      authInfo1,
      authInfo2,
      password,
      totpSecret,
      cookiesFile,
      enableUiMetrics = true,
    } = options;

    this.http.clearCookies();

    if (cookiesFile && existsSync(cookiesFile)) {
      await this.loadCookies(cookiesFile);
      return undefined;
    }

    const guestToken = await this.getGuestToken();
    const flow = new Flow(this, guestToken);

    await flow.executeTask([], {
      params: { flow_name: 'login' },
      data: {
        input_flow_data: {
          flow_context: {
            debug_overrides: {},
            start_location: { location: 'splash_screen' },
          },
        },
        subtask_versions: SUBTASK_VERSIONS,
      },
    });

    await flow.ssoInit('apple');

    const uiMetricsResponse = enableUiMetrics ? solveUiMetrics(await this.uiMetrics()) : '';

    await flow.executeTask([
      {
        subtask_id: 'LoginJsInstrumentationSubtask',
        js_instrumentation: { response: uiMetricsResponse, link: 'next_link' },
      },
    ]);

    await flow.executeTask([
      {
        subtask_id: 'LoginEnterUserIdentifierSSO',
        settings_list: {
          setting_responses: [
            {
              key: 'user_identifier',
              response_data: { text_data: { result: authInfo1 } },
            },
          ],
          link: 'next_link',
        },
      },
    ]);

    if (flow.taskId === 'LoginEnterAlternateIdentifierSubtask') {
      await flow.executeTask([
        {
          subtask_id: 'LoginEnterAlternateIdentifierSubtask',
          enter_text: { text: authInfo2, link: 'next_link' },
        },
      ]);
    }

    if (flow.taskId === 'DenyLoginSubtask') {
      throw new TwitterException(
        flow.response?.subtasks?.[0]?.cta?.secondary_text?.text as string
      );
    }

    await flow.executeTask([
      {
        subtask_id: 'LoginEnterPassword',
        enter_password: { password, link: 'next_link' },
      },
    ]);

    if (flow.taskId === 'DenyLoginSubtask') {
      throw new TwitterException(
        flow.response?.subtasks?.[0]?.cta?.secondary_text?.text as string
      );
    }

    if (flow.taskId === 'LoginAcid') {
      const secondaryText = findDict(flow.response, 'secondary_text', true)[0]?.text;
      const code = await this.promptFn(String(secondaryText ?? 'Enter the confirmation code'));
      await flow.executeTask([
        { subtask_id: 'LoginAcid', enter_text: { text: code, link: 'next_link' } },
      ]);
      return flow.response ?? undefined;
    }

    if (flow.taskId === 'LoginTwoFactorAuthChallenge') {
      let totpCode: string;
      if (totpSecret === undefined) {
        const secondaryText = findDict(flow.response, 'secondary_text', true)[0]?.text;
        totpCode = await this.promptFn(String(secondaryText ?? 'Enter the 2FA code'));
      } else {
        totpCode = new TOTP({ secret: totpSecret }).generate();
      }
      await flow.executeTask([
        {
          subtask_id: 'LoginTwoFactorAuthChallenge',
          enter_text: { text: totpCode, link: 'next_link' },
        },
      ]);
    }

    await flow.executeTask([
      {
        subtask_id: 'AccountDuplicationCheck',
        check_logged_in_account: { link: 'AccountDuplicationCheck_false' },
      },
    ]);

    if (cookiesFile) await this.saveCookies(cookiesFile);

    if (!flow.response?.subtasks?.length) return undefined;

    this.currentUserId = findDict(flow.response, 'id_str', true)[0];
    return flow.response ?? undefined;
  }

  /** Logs out of the account. */
  async logout(): Promise<HttpResponse> {
    const [, response] = await this.v11.accountLogout();
    return response;
  }

  /** Unlocks the account using the configured captcha solver. */
  async unlock(): Promise<void> {
    if (this.captchaSolver === null) {
      throw new Error('Captcha solver is not provided.');
    }

    let [response, html] = await this.captchaSolver.getUnlockHtml();

    if (html.deleteButton) {
      [response, html] = await this.captchaSolver.confirmUnlock(
        html.authenticityToken,
        html.assignmentToken,
        { uiMetrics: true }
      );
    }

    if (html.startButton || html.finishButton) {
      [response, html] = await this.captchaSolver.confirmUnlock(
        html.authenticityToken,
        html.assignmentToken,
        { uiMetrics: true }
      );
    }

    const cookiesBackup = { ...this.getCookies() };
    const maxUnlockAttempts = this.captchaSolver.maxAttempts;

    for (let attempt = 0; attempt < maxUnlockAttempts; attempt += 1) {
      if (html.authenticityToken === null) {
        [response, html] = await this.captchaSolver.getUnlockHtml();
      }

      const result = await this.captchaSolver.solveFuncaptcha(html.blob);
      if (result.errorId === 1) continue;

      this.setCookies(cookiesBackup, true);
      [response, html] = await this.captchaSolver.confirmUnlock(
        html.authenticityToken,
        html.assignmentToken,
        { verificationString: result.solution?.token ?? null }
      );

      if (html.finishButton) {
        [response, html] = await this.captchaSolver.confirmUnlock(
          html.authenticityToken,
          html.assignmentToken,
          { uiMetrics: true }
        );
      }

      // Upstream checks httpx's `next_request`; with redirects disabled the
      // equivalent signal is a redirect back to the site root.
      const location = response.headers.location;
      const target = Array.isArray(location) ? location[0] : location;
      if (target !== undefined && new URL(target, `https://${DOMAIN}`).pathname === '/') {
        return;
      }
    }

    throw new Error('could not unlock the account.');
  }

  // -- cookies ---------------------------------------------------------------

  /**
   * Returns the current session cookies as a `name -> value` map.
   *
   * @example
   * const cookies = client.getCookies();
   */
  getCookies(): Record<string, string> {
    return this.http.getCookies();
  }

  /**
   * Saves the current session cookies to a JSON file, so a later session can
   * skip the login flow.
   */
  async saveCookies(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.getCookies()), 'utf-8');
  }

  /** Sets session cookies, optionally clearing the existing ones first. */
  setCookies(cookies: Record<string, string>, clearCookies = false): void {
    this.http.setCookies(cookies, clearCookies);
  }

  /** Loads session cookies from a file written by {@link saveCookies}. */
  async loadCookies(path: string): Promise<void> {
    const raw = await readFile(path, 'utf-8');
    this.setCookies(JSON.parse(raw) as Record<string, string>);
  }

  /**
   * Sets the account to act on behalf of. Pass `null` to clear it.
   *
   * @param userId The user ID of the account to act as.
   */
  setDelegateAccount(userId: string | null): void {
    this.actAs = userId;
  }

  /** The authenticated user's ID. */
  async userId(): Promise<string> {
    if (this.currentUserId !== null) return this.currentUserId;
    const [response] = await this.v11.settings();
    const screenName = response.screen_name;
    this.currentUserId = (await this.getUserByScreenName(screenName)).id;
    return this.currentUserId;
  }

  /** The authenticated user. */
  async user(): Promise<User> {
    return this.getUserById(await this.userId());
  }

  // -- search ----------------------------------------------------------------

  /**
   * Searches for tweets.
   *
   * @param query The search query.
   * @param product The type of search results to return.
   * @example
   * const tweets = await client.searchTweet('query', 'Top');
   * const moreTweets = await tweets.next();
   */
  async searchTweet(
    query: string,
    product: 'Top' | 'Latest' | 'Media',
    count = 20,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const normalizedProduct = capitalize(product) as 'Top' | 'Latest' | 'Media';
    const [response] = await this.gql.searchTimeline(query, normalizedProduct, count, cursor);

    const instructionsFound = findDict(response, 'instructions', true);
    if (instructionsFound.length === 0) return new Result<Tweet>([]);
    const instructions = instructionsFound[0];

    let items: any[];
    if (normalizedProduct === 'Media' && cursor !== null) {
      items = findDict(instructions, 'moduleItems', true)[0];
    } else {
      const found = findDict(instructions, 'entries', true);
      items = found.length > 0 ? found[0] : [];
      if (normalizedProduct === 'Media') {
        items = items[0]?.content?.items ?? [];
      }
    }

    let nextCursor: string | null = null;
    let previousCursor: string | null = null;
    const results: Tweet[] = [];

    for (const item of items) {
      const entryId: string = item.entryId;
      if (entryId.startsWith('cursor-bottom')) nextCursor = item.content.value;
      if (entryId.startsWith('cursor-top')) previousCursor = item.content.value;
      if (!entryId.startsWith('tweet') && !entryId.startsWith('search-grid')) continue;

      let tweet: Tweet | null;
      try {
        tweet = tweetFromData(this, item);
      } catch {
        tweet = null;
      }
      if (tweet !== null) results.push(tweet);
    }

    if (nextCursor === null) {
      if (normalizedProduct === 'Media') {
        const entries = findDict(instructions, 'entries', true)[0];
        nextCursor = entries[entries.length - 1]?.content?.value ?? null;
        previousCursor = entries[entries.length - 2]?.content?.value ?? null;
      } else {
        nextCursor = instructions[instructions.length - 1]?.entry?.content?.value ?? null;
        previousCursor = instructions[instructions.length - 2]?.entry?.content?.value ?? null;
      }
    }

    return new Result<Tweet>(
      results,
      () => this.searchTweet(query, normalizedProduct, count, nextCursor),
      nextCursor,
      () => this.searchTweet(query, normalizedProduct, count, previousCursor),
      previousCursor
    );
  }

  /**
   * Searches for users.
   *
   * @example
   * const users = await client.searchUser('query');
   * const moreUsers = await users.next();
   */
  async searchUser(query: string, count = 20, cursor: string | null = null): Promise<Result<User>> {
    const [response] = await this.gql.searchTimeline(query, 'People', count, cursor);
    const items = findDict(response, 'entries', true)[0] ?? [];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;

    const results: User[] = [];
    for (const item of items) {
      if (!item.content?.itemContent) continue;
      const userInfo = findDict(item, 'result', true)[0];
      results.push(new User(this, userInfo));
    }

    return new Result<User>(
      results,
      () => this.searchUser(query, count, nextCursor),
      nextCursor
    );
  }

  /** Retrieves tweets similar to the given tweet. */
  async getSimilarTweets(tweetId: string): Promise<Tweet[]> {
    const [response] = await this.gql.similarPosts(tweetId);
    const found = findDict(response, 'entries', true);
    const results: Tweet[] = [];
    if (found.length === 0) return results;

    for (const item of found[0]) {
      if (!String(item.entryId).startsWith('tweet')) continue;
      const tweet = tweetFromData(this, item);
      if (tweet !== null) results.push(tweet);
    }
    return results;
  }

  /** Retrieves highlighted tweets from a user's timeline. */
  async getUserHighlightsTweets(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const [response] = await this.gql.userHighlightsTweets(userId, count, cursor);
    const instructions =
      response.data.user.result.timeline.timeline.instructions as { type?: string }[];
    const instruction = findEntryByType(instructions, 'TimelineAddEntries') as
      | { entries: any[] }
      | null;
    if (instruction === null) return Result.empty<Tweet>();

    let previousCursor: string | null = null;
    let nextCursor: string | null = null;
    const results: Tweet[] = [];

    for (const entry of instruction.entries) {
      const entryId: string = entry.entryId;
      if (entryId.startsWith('tweet')) {
        const tweet = tweetFromData(this, entry);
        if (tweet !== null) results.push(tweet);
      } else if (entryId.startsWith('cursor-top')) {
        previousCursor = entry.content.value;
      } else if (entryId.startsWith('cursor-bottom')) {
        nextCursor = entry.content.value;
      }
    }

    return new Result<Tweet>(
      results,
      () => this.getUserHighlightsTweets(userId, count, nextCursor),
      nextCursor,
      () => this.getUserHighlightsTweets(userId, count, previousCursor),
      previousCursor
    );
  }

  // -- media -----------------------------------------------------------------

  /**
   * Uploads media to X and returns its media ID.
   *
   * @param source A file path or the raw bytes of the media.
   * @example
   * const mediaId = await client.uploadMedia('image1.png');
   * await client.createTweet({ mediaIds: [mediaId] });
   */
  async uploadMedia(
    source: string | Buffer | Uint8Array,
    options: {
      /** Wait until X finishes processing the upload. */
      waitForCompletion?: boolean;
      /** Seconds between status checks; defaults to the API's suggestion. */
      statusCheckInterval?: number;
      mediaType?: string;
      mediaCategory?: string;
      isLongVideo?: boolean;
    } = {}
  ): Promise<string> {
    let { waitForCompletion = false } = options;
    const { statusCheckInterval, mediaCategory = null, isLongVideo = false } = options;

    const binary =
      typeof source === 'string' ? await readFile(source) : Buffer.from(source);

    let mediaType = options.mediaType;
    if (mediaType === undefined) {
      const detected = detectMediaType(binary);
      if (detected === null) {
        throw new TwitterException(
          'Could not determine the media type; pass `mediaType` explicitly.'
        );
      }
      mediaType = detected.mime;
    }

    if (waitForCompletion) {
      if (mediaType === 'image/gif') {
        if (mediaCategory === null) {
          throw new TwitterException(
            "`mediaCategory` must be specified to check the upload status of gif " +
              "images ('dm_gif' or 'tweet_gif')"
          );
        }
      } else if (mediaType.startsWith('image')) {
        // Checking the upload status of an image is impossible.
        waitForCompletion = false;
      }
    }

    const totalBytes = binary.length;

    // ============ INIT =============
    const [initResponse] = await this.v11.uploadMediaInit(
      mediaType,
      totalBytes,
      mediaCategory,
      isLongVideo
    );
    const mediaId: string = initResponse.media_id;

    // =========== APPEND ============
    const MAX_SEGMENT_SIZE = 8 * 1024 * 1024; // The maximum segment size is 8 MB
    const appendTasks: Promise<unknown>[] = [];
    let segmentIndex = 0;
    let bytesSent = 0;

    while (bytesSent < totalBytes) {
      const chunk = binary.subarray(bytesSent, bytesSent + MAX_SEGMENT_SIZE);
      appendTasks.push(
        this.v11.uploadMediaAppend(isLongVideo, mediaId, segmentIndex, chunk)
      );
      segmentIndex += 1;
      bytesSent += chunk.length;
    }
    await Promise.all(appendTasks);

    // ========== FINALIZE ===========
    await this.v11.uploadMediaFinalize(isLongVideo, mediaId);

    if (waitForCompletion) {
      for (;;) {
        const state = await this.checkMediaStatus(mediaId, isLongVideo);
        const processingInfo = state.processing_info;
        if (processingInfo?.error) {
          throw new InvalidMedia(processingInfo.error.message);
        }
        if (processingInfo?.state === 'succeeded') break;
        await sleep((statusCheckInterval ?? processingInfo.check_after_secs) * 1000);
      }
    }

    return mediaId;
  }

  /** Checks the processing status of an uploaded medium. */
  async checkMediaStatus(mediaId: string, isLongVideo = false): Promise<Record<string, any>> {
    const [response] = await this.v11.uploadMediaStatus(isLongVideo, mediaId);
    return response;
  }

  /**
   * Adds metadata (alt text, sensitivity warnings) to an uploaded medium.
   *
   * @example
   * const mediaId = await client.uploadMedia('media.png');
   * await client.createMediaMetadata(mediaId, { altText: 'Alt text' });
   */
  async createMediaMetadata(
    mediaId: string,
    options: {
      altText?: string;
      sensitiveWarning?: ('adult_content' | 'graphic_violence' | 'other')[];
    } = {}
  ): Promise<HttpResponse> {
    const [, response] = await this.v11.createMediaMetadata(
      mediaId,
      options.altText ?? null,
      options.sensitiveWarning ?? null
    );
    return response;
  }

  // -- polls -----------------------------------------------------------------

  /**
   * Creates a poll and returns its card URI, for passing to `createTweet`.
   *
   * @example
   * const cardUri = await client.createPoll(['A', 'B'], 60);
   * await client.createTweet({ pollUri: cardUri });
   */
  async createPoll(choices: string[], durationMinutes: number): Promise<string> {
    const [response] = await this.v11.createCard(choices, durationMinutes);
    return response.card_uri;
  }

  /** Votes on a poll. */
  async vote(
    selectedChoice: string,
    cardUri: string,
    tweetId: string,
    cardName: string
  ): Promise<Poll> {
    const [response] = await this.v11.vote(selectedChoice, cardUri, tweetId, cardName);
    const cardData = { rest_id: response.card.url, legacy: response.card };
    return new Poll(this, cardData, null);
  }

  // -- tweets ----------------------------------------------------------------

  /**
   * Creates a new tweet.
   *
   * @example
   * const mediaIds = [await client.uploadMedia('image1.png')];
   * await client.createTweet({ text: 'Hello', mediaIds });
   */
  async createTweet(
    text = '',
    options: {
      mediaIds?: string[];
      pollUri?: string;
      replyTo?: string;
      /** Who may reply to the tweet. */
      conversationControl?: 'followers' | 'verified' | 'mentioned';
      attachmentUrl?: string;
      communityId?: string;
      shareWithFollowers?: boolean;
      isNoteTweet?: boolean;
      richtextOptions?: Record<string, unknown>[];
      editTweetId?: string;
    } = {}
  ): Promise<Tweet | null> {
    const mediaEntities = (options.mediaIds ?? []).map((mediaId) => ({
      media_id: mediaId,
      tagged_users: [],
    }));

    let limitMode: string | null = null;
    if (options.conversationControl !== undefined) {
      limitMode = {
        followers: 'Community',
        verified: 'Verified',
        mentioned: 'ByInvitation',
      }[options.conversationControl.toLowerCase() as 'followers' | 'verified' | 'mentioned'];
    }

    const isNoteTweet = options.isNoteTweet ?? false;
    const [response] = await this.gql.createTweet(
      isNoteTweet,
      text,
      mediaEntities,
      options.pollUri ?? null,
      options.replyTo ?? null,
      options.attachmentUrl ?? null,
      options.communityId ?? null,
      options.shareWithFollowers ?? false,
      options.richtextOptions ?? null,
      options.editTweetId ?? null,
      limitMode
    );

    if (response.errors) {
      raiseExceptionsFromResponse(response.errors);
      throw new CouldNotTweet(
        response.errors.length > 0
          ? JSON.stringify(response.errors[0])
          : 'Failed to post a tweet.'
      );
    }

    const result = isNoteTweet
      ? response.data.notetweet_create.tweet_results
      : response.data.create_tweet.tweet_results;
    return tweetFromData(this, result);
  }

  /**
   * Schedules a tweet and returns the scheduled tweet's ID.
   *
   * @param scheduledAt UNIX timestamp (in seconds) at which to post.
   */
  async createScheduledTweet(
    scheduledAt: number,
    text = '',
    mediaIds: string[] | null = null
  ): Promise<string> {
    const [response] = await this.gql.createScheduledTweet(scheduledAt, text, mediaIds);
    return response.data.tweet.rest_id;
  }

  /** Deletes a tweet. */
  async deleteTweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteTweet(tweetId);
    return response;
  }

  // -- users -----------------------------------------------------------------

  /** Fetches a user by screen name (handle). */
  async getUserByScreenName(screenName: string): Promise<User> {
    const [response] = await this.gql.userByScreenName(screenName);
    if (!response.data.user) {
      throw new UserNotFound('The user does not exist.');
    }
    const userData = response.data.user.result;
    if (userData.__typename === 'UserUnavailable') {
      throw new UserUnavailable(userData.message);
    }
    return new User(this, userData);
  }

  /** Fetches a user by ID. */
  async getUserById(userId: string): Promise<User> {
    const [response] = await this.gql.userByRestId(userId);
    if (!response.data.user?.result) {
      throw new TwitterException(`Invalid user id: ${userId}`);
    }
    const userData = response.data.user.result;
    if (userData.__typename === 'UserUnavailable') {
      throw new UserUnavailable(userData.message);
    }
    return new User(this, userData);
  }

  // -- geo -------------------------------------------------------------------

  /** Finds places near a latitude/longitude. */
  async reverseGeocode(
    lat: number,
    long: number,
    options: {
      accuracy?: string | number;
      granularity?: 'neighborhood' | 'city' | 'admin' | 'country';
      maxResults?: number;
    } = {}
  ): Promise<Place[]> {
    const [response] = await this.v11.reverseGeocode(
      lat,
      long,
      options.accuracy ?? null,
      options.granularity ?? null,
      options.maxResults ?? null
    );
    return placesFromResponse(this, response);
  }

  /** Searches for places. */
  async searchGeo(
    options: {
      lat?: number;
      long?: number;
      query?: string;
      ip?: string;
      granularity?: 'neighborhood' | 'city' | 'admin' | 'country';
      maxResults?: number;
    } = {}
  ): Promise<Place[]> {
    const [response] = await this.v11.searchGeo(
      options.lat ?? null,
      options.long ?? null,
      options.query ?? null,
      options.ip ?? null,
      options.granularity ?? null,
      options.maxResults ?? null
    );
    return placesFromResponse(this, response);
  }

  /** Fetches a place by ID. */
  async getPlace(id: string): Promise<Place> {
    const [response] = await this.v11.getPlace(id);
    return new Place(this, response);
  }

  private async getMoreReplies(tweetId: string, cursor: string): Promise<Result<Tweet>> {
    const [response] = await this.gql.tweetDetail(tweetId, cursor);
    const entries = findDict(response, 'entries', true)[0] ?? [];

    const results: Tweet[] = [];
    for (const entry of entries) {
      const entryId: string = entry.entryId;
      if (entryId.startsWith('cursor') || entryId.startsWith('label')) continue;
      const tweet = tweetFromData(this, entry);
      if (tweet !== null) results.push(tweet);
    }

    const last = entries[entries.length - 1];
    let nextCursor: string | null = null;
    let fetchNext: (() => Promise<Result<Tweet>>) | null = null;
    if (last && String(last.entryId).startsWith('cursor')) {
      nextCursor = last.content.itemContent.value;
      fetchNext = () => this.getMoreReplies(tweetId, nextCursor as string);
    }

    return new Result<Tweet>(results, fetchNext, nextCursor);
  }

  private async showMoreReplies(tweetId: string, cursor: string): Promise<Result<Tweet>> {
    const [response] = await this.gql.tweetDetail(tweetId, cursor);
    const items = findDict(response, 'moduleItems', true)[0] ?? [];

    const results: Tweet[] = [];
    for (const item of items) {
      if (!String(item.entryId).includes('tweet')) continue;
      const tweet = tweetFromData(this, item);
      if (tweet !== null) results.push(tweet);
    }
    return new Result<Tweet>(results);
  }

  /**
   * Fetches a tweet by ID, along with its replies, the tweets it replies to,
   * and related tweets.
   *
   * @example
   * const tweet = await client.getTweetById('...');
   * for (const reply of tweet.replies ?? []) console.log(reply);
   */
  async getTweetById(tweetId: string, cursor: string | null = null): Promise<Tweet> {
    const [response] = await this.gql.tweetDetail(tweetId, cursor);

    if (response.errors) {
      throw new TweetNotAvailable(response.errors[0].message);
    }

    const entries = findDict(response, 'entries', true)[0] ?? [];
    const replyTo: Tweet[] = [];
    const repliesList: Tweet[] = [];
    const relatedTweets: Tweet[] = [];
    let tweet: Tweet | null = null;

    for (const entry of entries) {
      const entryId: string = entry.entryId;
      if (entryId.startsWith('cursor')) continue;

      const tweetObject = tweetFromData(this, entry);
      if (tweetObject === null) continue;

      if (entryId.startsWith('tweetdetailrelatedtweets')) {
        relatedTweets.push(tweetObject);
        continue;
      }

      if (entryId === `tweet-${tweetId}`) {
        tweet = tweetObject;
        continue;
      }

      if (tweet === null) {
        replyTo.push(tweetObject);
        continue;
      }

      const replies: Tweet[] = [];
      let srCursor: string | null = null;
      let showReplies: (() => Promise<Result<Tweet>>) | null = null;

      for (const reply of (entry.content?.items ?? []).slice(1)) {
        const replyEntryId = String(reply.entryId ?? '');
        if (replyEntryId.includes('tweetcomposer')) continue;
        if (replyEntryId.includes('tweet')) {
          const rpl = tweetFromData(this, reply);
          if (rpl !== null) replies.push(rpl);
        }
        if (replyEntryId.includes('cursor')) {
          srCursor = reply.item.itemContent.value;
          showReplies = () => this.showMoreReplies(tweetId, srCursor as string);
        }
      }

      tweetObject.replies = new Result<Tweet>(replies, showReplies, srCursor);
      repliesList.push(tweetObject);

      const displayType = findDict(entry, 'tweetDisplayType', true);
      if (displayType.length > 0 && displayType[0] === 'SelfThread') {
        tweet.thread = [tweetObject, ...replies];
      }
    }

    if (tweet === null) {
      throw new TweetNotAvailable(`Tweet ${tweetId} was not found in the response.`);
    }

    const last = entries[entries.length - 1];
    let replyNextCursor: string | null = null;
    let fetchMoreReplies: (() => Promise<Result<Tweet>>) | null = null;
    if (last && String(last.entryId).startsWith('cursor')) {
      replyNextCursor = last.content.itemContent.value;
      fetchMoreReplies = () => this.getMoreReplies(tweetId, replyNextCursor as string);
    }

    tweet.replies = new Result<Tweet>(repliesList, fetchMoreReplies, replyNextCursor);
    tweet.replyTo = replyTo;
    tweet.relatedTweets = relatedTweets;
    return tweet;
  }

  /** Fetches multiple tweets by their IDs in one request. */
  async getTweetsByIds(ids: string[]): Promise<(Tweet | null)[]> {
    const [response] = await this.gql.tweetResultsByRestIds(ids);
    const tweetResults = response.data.tweetResult as unknown[];
    return tweetResults.map((tweetResult) => tweetFromData(this, tweetResult));
  }

  /** Retrieves the authenticated user's scheduled tweets. */
  async getScheduledTweets(): Promise<ScheduledTweet[]> {
    const [response] = await this.gql.fetchScheduledTweets();
    const tweets = findDict(response, 'scheduled_tweet_list', true)[0] ?? [];
    return tweets.map((tweet: Record<string, any>) => new ScheduledTweet(this, tweet));
  }

  /** Deletes a scheduled tweet. */
  async deleteScheduledTweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteScheduledTweet(tweetId);
    return response;
  }

  private async getTweetEngagements(
    tweetId: string,
    count: number,
    cursor: string | null,
    fetcher: (tweetId: string, count: number, cursor: string | null) => Promise<ApiResult>
  ): Promise<Result<User>> {
    const [response] = await fetcher(tweetId, count, cursor);
    const found = findDict(response, 'entries', true);
    if (found.length === 0) return new Result<User>([]);

    const items = found[0];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;
    const previousCursor = items[items.length - 2]?.content?.value ?? null;

    const results: User[] = [];
    for (const item of items) {
      if (!String(item.entryId).startsWith('user')) continue;
      const userInfo = findDict(item, 'result', true);
      if (userInfo.length === 0) continue;
      results.push(new User(this, userInfo[0]));
    }

    return new Result<User>(
      results,
      () => this.getTweetEngagements(tweetId, count, nextCursor, fetcher),
      nextCursor,
      () => this.getTweetEngagements(tweetId, count, previousCursor, fetcher),
      previousCursor
    );
  }

  /** Retrieves the users who retweeted a tweet. */
  async getRetweeters(
    tweetId: string,
    count = 40,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getTweetEngagements(tweetId, count, cursor, (id, c, cur) =>
      this.gql.retweeters(id, c, cur)
    );
  }

  /** Retrieves the users who liked a tweet. */
  async getFavoriters(
    tweetId: string,
    count = 40,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getTweetEngagements(tweetId, count, cursor, (id, c, cur) =>
      this.gql.favoriters(id, c, cur)
    );
  }

  /** Fetches a community note by ID. */
  async getCommunityNote(noteId: string): Promise<CommunityNote> {
    const [response] = await this.gql.birdWatchOneNote(noteId);
    const noteData = response.data.birdwatch_note_by_rest_id;
    if (!noteData?.data_v1) {
      throw new TwitterException(`Invalid note id: ${noteId}`);
    }
    return new CommunityNote(this, noteData);
  }

  /**
   * Retrieves a user's tweets.
   *
   * @example
   * const tweets = await client.getUserTweets(userId, 'Tweets');
   * const moreTweets = await tweets.next();
   */
  async getUserTweets(
    userId: string,
    tweetType: 'Tweets' | 'Replies' | 'Media' | 'Likes',
    count = 40,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const normalizedType = capitalize(tweetType) as 'Tweets' | 'Replies' | 'Media' | 'Likes';
    const fetcher = {
      Tweets: (id: string, c: number, cur: string | null) => this.gql.userTweets(id, c, cur),
      Replies: (id: string, c: number, cur: string | null) =>
        this.gql.userTweetsAndReplies(id, c, cur),
      Media: (id: string, c: number, cur: string | null) => this.gql.userMedia(id, c, cur),
      Likes: (id: string, c: number, cur: string | null) => this.gql.userLikes(id, c, cur),
    }[normalizedType];

    const [response] = await fetcher(userId, count, cursor);
    const instructionsFound = findDict(response, 'instructions', true);
    if (instructionsFound.length === 0) return new Result<Tweet>([]);

    const instructions = instructionsFound[0];
    let items = instructions[instructions.length - 1].entries ?? [];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;
    const previousCursor = items[items.length - 2]?.content?.value ?? null;

    if (normalizedType === 'Media') {
      items = cursor === null ? items[0]?.content?.items ?? [] : instructions[0].moduleItems ?? [];
    }

    const results: Tweet[] = [];
    for (let item of items) {
      const entryId: string = item.entryId;
      if (
        !entryId.startsWith('tweet') &&
        !entryId.startsWith('profile-conversation') &&
        !entryId.startsWith('profile-grid')
      ) {
        continue;
      }

      let replies: Tweet[] | null = null;
      if (entryId.startsWith('profile-conversation')) {
        const tweets = item.content.items;
        replies = [];
        for (const reply of tweets.slice(1)) {
          const tweetObject = tweetFromData(this, reply);
          if (tweetObject !== null) replies.push(tweetObject);
        }
        item = tweets[0];
      }

      const tweet = tweetFromData(this, item);
      if (tweet === null) continue;
      tweet.replies = replies as unknown as Result<Tweet> | null;
      results.push(tweet);
    }

    return new Result<Tweet>(
      results,
      () => this.getUserTweets(userId, normalizedType, count, nextCursor),
      nextCursor,
      () => this.getUserTweets(userId, normalizedType, count, previousCursor),
      previousCursor
    );
  }

  private async homeTimeline(
    fetcher: (
      count: number,
      seenTweetIds: string[] | null,
      cursor: string | null
    ) => Promise<ApiResult>,
    next: (count: number, seenTweetIds: string[] | null, cursor: string | null) => Promise<Result<Tweet>>,
    count: number,
    seenTweetIds: string[] | null,
    cursor: string | null
  ): Promise<Result<Tweet>> {
    const [response] = await fetcher(count, seenTweetIds, cursor);
    const items = findDict(response, 'entries', true)[0] ?? [];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;

    const results: Tweet[] = [];
    for (const item of items) {
      if (!item.content?.itemContent) continue;
      const tweet = tweetFromData(this, item);
      if (tweet === null) continue;
      results.push(tweet);
    }

    return new Result<Tweet>(
      results,
      () => next(count, seenTweetIds, nextCursor),
      nextCursor
    );
  }

  /**
   * Retrieves the "For You" home timeline.
   *
   * @param seenTweetIds IDs of tweets already seen, to influence the results.
   * @example
   * const tweets = await client.getTimeline();
   * const moreTweets = await tweets.next();
   */
  async getTimeline(
    count = 20,
    seenTweetIds: string[] | null = null,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    return this.homeTimeline(
      (c, s, cur) => this.gql.homeTimeline(c, s, cur),
      (c, s, cur) => this.getTimeline(c, s, cur),
      count,
      seenTweetIds,
      cursor
    );
  }

  /**
   * Retrieves the "Following" (latest) home timeline.
   *
   * @example
   * const tweets = await client.getLatestTimeline();
   */
  async getLatestTimeline(
    count = 20,
    seenTweetIds: string[] | null = null,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    return this.homeTimeline(
      (c, s, cur) => this.gql.homeLatestTimeline(c, s, cur),
      (c, s, cur) => this.getLatestTimeline(c, s, cur),
      count,
      seenTweetIds,
      cursor
    );
  }

  /** Likes a tweet. */
  async favoriteTweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.favoriteTweet(tweetId);
    return response;
  }

  /** Removes a like from a tweet. */
  async unfavoriteTweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.unfavoriteTweet(tweetId);
    return response;
  }

  /** Retweets a tweet. */
  async retweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.retweet(tweetId);
    return response;
  }

  /** Removes a retweet. */
  async deleteRetweet(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteRetweet(tweetId);
    return response;
  }

  /** Bookmarks a tweet, optionally into a folder. */
  async bookmarkTweet(tweetId: string, folderId: string | null = null): Promise<HttpResponse> {
    if (folderId === null) {
      const [, response] = await this.gql.createBookmark(tweetId);
      return response;
    }
    const [, response] = await this.gql.bookmarkTweetToFolder(tweetId, folderId);
    return response;
  }

  /** Removes a bookmark from a tweet. */
  async deleteBookmark(tweetId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteBookmark(tweetId);
    return response;
  }

  /**
   * Retrieves bookmarks, optionally from a specific folder.
   *
   * @example
   * const bookmarks = await client.getBookmarks();
   * const moreBookmarks = await bookmarks.next();
   */
  async getBookmarks(
    options: { count?: number; cursor?: string | null; folderId?: string | null } = {}
  ): Promise<Result<Tweet>> {
    const { count = 20, cursor = null, folderId = null } = options;

    const [response] =
      folderId === null
        ? await this.gql.bookmarks(count, cursor)
        : await this.gql.bookmarkFolderTimeline(count, cursor, folderId);

    const found = findDict(response, 'entries', true);
    if (found.length === 0) return new Result<Tweet>([]);

    const items = found[0];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;

    let previousCursor: string | null = null;
    let fetchPreviousResult: (() => Promise<Result<Tweet>>) | null = null;
    if (folderId === null) {
      previousCursor = items[items.length - 2]?.content?.value ?? null;
      fetchPreviousResult = () =>
        this.getBookmarks({ count, cursor: previousCursor, folderId });
    }

    const results: Tweet[] = [];
    for (const item of items) {
      const tweet = tweetFromData(this, item);
      if (tweet === null) continue;
      results.push(tweet);
    }

    return new Result<Tweet>(
      results,
      () => this.getBookmarks({ count, cursor: nextCursor, folderId }),
      nextCursor,
      fetchPreviousResult,
      previousCursor
    );
  }

  /** Deletes all bookmarks. */
  async deleteAllBookmarks(): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteAllBookmarks();
    return response;
  }

  /** Retrieves the authenticated user's bookmark folders. */
  async getBookmarkFolders(cursor: string | null = null): Promise<Result<BookmarkFolder>> {
    const [response] = await this.gql.bookmarkFoldersSlice(cursor);
    const slice = findDict(response, 'bookmark_collections_slice', true)[0];

    const results = (slice?.items ?? []).map(
      (item: Record<string, any>) => new BookmarkFolder(this, item)
    );

    const nextCursor: string | null = slice?.slice_info?.next_cursor ?? null;
    const fetchNextResult =
      nextCursor !== null ? () => this.getBookmarkFolders(nextCursor) : null;

    return new Result<BookmarkFolder>(results, fetchNextResult, nextCursor);
  }

  /** Renames a bookmark folder. */
  async editBookmarkFolder(folderId: string, name: string): Promise<BookmarkFolder> {
    const [response] = await this.gql.editBookmarkFolder(folderId, name);
    return new BookmarkFolder(this, response.data.bookmark_collection_update);
  }

  /** Deletes a bookmark folder. */
  async deleteBookmarkFolder(folderId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteBookmarkFolder(folderId);
    return response;
  }

  /** Creates a bookmark folder. */
  async createBookmarkFolder(name: string): Promise<BookmarkFolder> {
    const [response] = await this.gql.createBookmarkFolder(name);
    return new BookmarkFolder(this, response.data.bookmark_collection_create);
  }

  // -- follow / block / mute -------------------------------------------------

  /** Follows a user. */
  async followUser(userId: string): Promise<User> {
    const [response] = await this.v11.createFriendships(userId);
    return new User(this, buildUserData(response));
  }

  /** Unfollows a user. */
  async unfollowUser(userId: string): Promise<User> {
    const [response] = await this.v11.destroyFriendships(userId);
    return new User(this, buildUserData(response));
  }

  /** Blocks a user. */
  async blockUser(userId: string): Promise<User> {
    const [response] = await this.v11.createBlocks(userId);
    return new User(this, buildUserData(response));
  }

  /** Unblocks a user. */
  async unblockUser(userId: string): Promise<User> {
    const [response] = await this.v11.destroyBlocks(userId);
    return new User(this, buildUserData(response));
  }

  /** Mutes a user. */
  async muteUser(userId: string): Promise<User> {
    const [response] = await this.v11.createMutes(userId);
    return new User(this, buildUserData(response));
  }

  /** Unmutes a user. */
  async unmuteUser(userId: string): Promise<User> {
    const [response] = await this.v11.destroyMutes(userId);
    return new User(this, buildUserData(response));
  }

  // -- trends ----------------------------------------------------------------

  /**
   * Retrieves trending topics.
   *
   * @param retry When true, keeps re-requesting while X returns no trends,
   *   which it does intermittently. Upstream recurses without a bound; this
   *   caps the attempts at {@link Client.MAX_TREND_ATTEMPTS} so a persistently
   *   empty response cannot spin forever.
   * @example
   * const trends = await client.getTrends('trending');
   */
  async getTrends(
    category: 'trending' | 'for-you' | 'news' | 'sports' | 'entertainment',
    count = 20,
    retry = true,
    additionalRequestParams: Record<string, unknown> | null = null
  ): Promise<Trend[]> {
    let normalizedCategory: string = category.toLowerCase();
    if (['news', 'sports', 'entertainment'].includes(normalizedCategory)) {
      normalizedCategory += '_unified';
    }
    const entryIdPrefix = normalizedCategory === 'trending' ? 'trends' : 'Guide';
    const maxAttempts = retry ? Client.MAX_TREND_ATTEMPTS : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const [response] = await this.v11.guide(
        normalizedCategory,
        count,
        additionalRequestParams
      );

      const entries = (findDict(response, 'entries', true)[0] ?? []).filter((entry: any) =>
        String(entry.entryId).startsWith(entryIdPrefix)
      );

      if (entries.length === 0) continue;

      const items = entries[entries.length - 1].content?.timelineModule?.items ?? [];
      return items.map(
        (item: Record<string, any>) => new Trend(this, item.item.content.trend)
      );
    }

    return [];
  }

  /** Retrieves the locations that have trend data available. */
  async getAvailableLocations(): Promise<Location[]> {
    const [response] = await this.v11.availableTrends();
    return (response as Record<string, any>[]).map((data) => new Location(this, data));
  }

  /** Retrieves trends for a location, by WOEID. */
  async getPlaceTrends(woeid: number): Promise<PlaceTrends> {
    const [response] = await this.v11.placeTrends(woeid);
    const trendData = response[0];
    trendData.trends = (trendData.trends as Record<string, any>[]).map(
      (data) => new PlaceTrend(this, data)
    );
    return trendData as PlaceTrends;
  }

  // -- friendships -----------------------------------------------------------

  private async getUserFriendship(
    userId: string,
    count: number,
    fetcher: (userId: string, count: number, cursor: string | null) => Promise<ApiResult>,
    cursor: string | null
  ): Promise<Result<User>> {
    const [response] = await fetcher(userId, count, cursor);
    const found = findDict(response, 'entries', true);
    if (found.length === 0) return Result.empty<User>();

    const items = found[0];
    const results: User[] = [];
    let nextCursor: string | null = null;

    for (const item of items) {
      const entryId: string = item.entryId;
      if (entryId.startsWith('user')) {
        const userInfo = findDict(item, 'result', true);
        if (userInfo.length === 0) {
          console.warn(
            'Some followers are excluded because "Quality Filter" is enabled. ' +
              'To get all followers, turn it off in the Twitter settings.'
          );
          continue;
        }
        if (userInfo[0]?.__typename === 'UserUnavailable') continue;
        results.push(new User(this, userInfo[0]));
      } else if (entryId.startsWith('cursor-bottom')) {
        nextCursor = item.content.value;
      }
    }

    return new Result<User>(
      results,
      () => this.getUserFriendship(userId, count, fetcher, nextCursor),
      nextCursor
    );
  }

  private async getUserFriendship2(
    userId: string | null,
    screenName: string | null,
    count: number,
    fetcher: (
      userId: string | null,
      screenName: string | null,
      count: number,
      cursor: string | null
    ) => Promise<ApiResult>,
    cursor: string | null
  ): Promise<Result<User>> {
    const [response] = await fetcher(userId, screenName, count, cursor);
    const results = (response.users as Record<string, any>[]).map(
      (user) => new User(this, buildUserData(user))
    );

    const previousCursor: string | null = response.previous_cursor ?? null;
    const nextCursor: string | null = response.next_cursor ?? null;

    return new Result<User>(
      results,
      () => this.getUserFriendship2(userId, screenName, count, fetcher, nextCursor),
      nextCursor,
      () => this.getUserFriendship2(userId, screenName, count, fetcher, previousCursor),
      previousCursor
    );
  }

  /**
   * Retrieves a user's followers.
   *
   * @example
   * const followers = await client.getUserFollowers(userId);
   * const moreFollowers = await followers.next();
   */
  async getUserFollowers(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getUserFriendship(
      userId,
      count,
      (id, c, cur) => this.gql.followers(id, c, cur),
      cursor
    );
  }

  /** Retrieves a user's most recent followers, via the v1.1 endpoint. */
  async getLatestFollowers(
    options: {
      userId?: string;
      screenName?: string;
      count?: number;
      cursor?: string | null;
    } = {}
  ): Promise<Result<User>> {
    return this.getUserFriendship2(
      options.userId ?? null,
      options.screenName ?? null,
      options.count ?? 200,
      (id, name, c, cur) => this.v11.followersList(id, name, c, cur),
      options.cursor ?? null
    );
  }

  /** Retrieves the accounts a user most recently followed, via the v1.1 endpoint. */
  async getLatestFriends(
    options: {
      userId?: string;
      screenName?: string;
      count?: number;
      cursor?: string | null;
    } = {}
  ): Promise<Result<User>> {
    return this.getUserFriendship2(
      options.userId ?? null,
      options.screenName ?? null,
      options.count ?? 200,
      (id, name, c, cur) => this.v11.friendsList(id, name, c, cur),
      options.cursor ?? null
    );
  }

  /** Retrieves a user's verified followers. */
  async getUserVerifiedFollowers(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getUserFriendship(
      userId,
      count,
      (id, c, cur) => this.gql.blueVerifiedFollowers(id, c, cur),
      cursor
    );
  }

  /** Retrieves the followers of a user that the authenticated user also follows. */
  async getUserFollowersYouKnow(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getUserFriendship(
      userId,
      count,
      (id, c, cur) => this.gql.followersYouKnow(id, c, cur),
      cursor
    );
  }

  /** Retrieves the accounts a user follows. */
  async getUserFollowing(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getUserFriendship(
      userId,
      count,
      (id, c, cur) => this.gql.following(id, c, cur),
      cursor
    );
  }

  /** Retrieves the creators a user subscribes to. */
  async getUserSubscriptions(
    userId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getUserFriendship(
      userId,
      count,
      (id, c, cur) => this.gql.userCreatorSubscriptions(id, c, cur),
      cursor
    );
  }

  private async getFriendshipIds(
    userId: string | null,
    screenName: string | null,
    count: number,
    fetcher: (
      userId: string | null,
      screenName: string | null,
      count: number,
      cursor: string | null
    ) => Promise<ApiResult>,
    cursor: string | null
  ): Promise<Result<number>> {
    const [response] = await fetcher(userId, screenName, count, cursor);
    const previousCursor: string | null = response.previous_cursor ?? null;
    const nextCursor: string | null = response.next_cursor ?? null;

    return new Result<number>(
      response.ids ?? [],
      () => this.getFriendshipIds(userId, screenName, count, fetcher, nextCursor),
      nextCursor,
      () => this.getFriendshipIds(userId, screenName, count, fetcher, previousCursor),
      previousCursor
    );
  }

  /** Retrieves the IDs of a user's followers. */
  async getFollowersIds(
    options: {
      userId?: string;
      screenName?: string;
      count?: number;
      cursor?: string | null;
    } = {}
  ): Promise<Result<number>> {
    return this.getFriendshipIds(
      options.userId ?? null,
      options.screenName ?? null,
      options.count ?? 5000,
      (id, name, c, cur) => this.v11.followersIds(id, name, c, cur),
      options.cursor ?? null
    );
  }

  /** Retrieves the IDs of the accounts a user follows. */
  async getFriendsIds(
    options: {
      userId?: string;
      screenName?: string;
      count?: number;
      cursor?: string | null;
    } = {}
  ): Promise<Result<number>> {
    return this.getFriendshipIds(
      options.userId ?? null,
      options.screenName ?? null,
      options.count ?? 5000,
      (id, name, c, cur) => this.v11.friendsIds(id, name, c, cur),
      options.cursor ?? null
    );
  }

  // -- direct messages -------------------------------------------------------

  private async sendDmRequest(
    conversationId: string,
    text: string,
    mediaId: string | null,
    replyTo: string | null
  ): Promise<Record<string, any>> {
    const [response] = await this.v11.dmNew(conversationId, text, mediaId, replyTo);
    return response;
  }

  private async dmHistoryRequest(
    conversationId: string,
    maxId: string | null = null
  ): Promise<Record<string, any>> {
    const [response] = await this.v11.dmConversation(conversationId, maxId);
    return response;
  }

  /**
   * Sends a direct message to a user.
   *
   * @param mediaId Media ID of an attachment, from `client.uploadMedia()`.
   * @param replyTo ID of the message to reply to.
   * @example
   * const mediaId = await client.uploadMedia('image.png');
   * const message = await client.sendDm(userId, 'text', mediaId);
   */
  async sendDm(
    userId: string,
    text: string,
    mediaId?: string,
    replyTo?: string
  ): Promise<Message> {
    const response = await this.sendDmRequest(
      `${userId}-${await this.userId()}`,
      text,
      mediaId ?? null,
      replyTo ?? null
    );

    const messageData = findDict(response, 'message_data', true)[0];
    const users = Object.values<Record<string, any>>(response.users ?? {});
    return new Message(
      this,
      messageData,
      users[0]?.id_str,
      users.length === 2 ? users[1].id_str : users[0]?.id_str
    );
  }

  /** Adds an emoji reaction to a direct message. */
  async addReactionToMessage(
    messageId: string,
    conversationId: string,
    emoji: string
  ): Promise<HttpResponse> {
    const [, response] = await this.gql.userDmReactionMutationAddMutation(
      messageId,
      conversationId,
      emoji
    );
    return response;
  }

  /** Removes an emoji reaction from a direct message. */
  async removeReactionFromMessage(
    messageId: string,
    conversationId: string,
    emoji: string
  ): Promise<HttpResponse> {
    const [, response] = await this.gql.userDmReactionMutationRemoveMutation(
      messageId,
      conversationId,
      emoji
    );
    return response;
  }

  /** Deletes a direct message. */
  async deleteDm(messageId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.dmMessageDeleteMutation(messageId);
    return response;
  }

  /**
   * Retrieves the DM conversation history with a user.
   *
   * @param maxId If given, retrieves messages older than this message ID.
   * @example
   * const messages = await client.getDmHistory(userId);
   * const moreMessages = await messages.next();
   */
  async getDmHistory(userId: string, maxId?: string): Promise<Result<Message>> {
    const response = await this.dmHistoryRequest(
      `${userId}-${await this.userId()}`,
      maxId ?? null
    );

    const entries = response.conversation_timeline?.entries;
    if (!entries) return new Result<Message>([]);

    const messages: Message[] = [];
    for (const item of entries) {
      const messageInfo = item.message?.message_data;
      if (!messageInfo) continue;
      messages.push(
        new Message(this, messageInfo, messageInfo.sender_id, messageInfo.recipient_id)
      );
    }

    if (messages.length === 0) return new Result<Message>([]);

    const lastId = messages[messages.length - 1].id;
    return new Result<Message>(messages, () => this.getDmHistory(userId, lastId), lastId);
  }

  /**
   * Sends a message to a group.
   *
   * @example
   * const mediaId = await client.uploadMedia('image.png');
   * const message = await client.sendDmToGroup(groupId, 'text', mediaId);
   */
  async sendDmToGroup(
    groupId: string,
    text: string,
    mediaId?: string,
    replyTo?: string
  ): Promise<GroupMessage> {
    const response = await this.sendDmRequest(
      groupId,
      text,
      mediaId ?? null,
      replyTo ?? null
    );

    const messageData = findDict(response, 'message_data', true)[0];
    const users = Object.values<Record<string, any>>(response.users ?? {});
    return new GroupMessage(this, messageData, users[0]?.id_str, groupId);
  }

  /**
   * Retrieves a group's DM conversation history.
   *
   * @example
   * const messages = await client.getGroupDmHistory(groupId);
   * const moreMessages = await messages.next();
   */
  async getGroupDmHistory(groupId: string, maxId?: string): Promise<Result<GroupMessage>> {
    const response = await this.dmHistoryRequest(groupId, maxId ?? null);

    const entries = response.conversation_timeline?.entries;
    if (!entries) return new Result<GroupMessage>([]);

    const messages: GroupMessage[] = [];
    for (const item of entries) {
      if (!item.message) continue;
      const messageInfo = item.message.message_data;
      messages.push(new GroupMessage(this, messageInfo, messageInfo.sender_id, groupId));
    }

    if (messages.length === 0) return new Result<GroupMessage>([]);

    const lastId = messages[messages.length - 1].id;
    return new Result<GroupMessage>(
      messages,
      () => this.getGroupDmHistory(groupId, lastId),
      lastId
    );
  }

  /** Fetches a group by ID. */
  async getGroup(groupId: string): Promise<Group> {
    const response = await this.dmHistoryRequest(groupId);
    return new Group(this, groupId, response);
  }

  /** Adds members to a group. */
  async addMembersToGroup(groupId: string, userIds: string[]): Promise<HttpResponse> {
    const [, response] = await this.gql.addParticipantsMutation(groupId, userIds);
    return response;
  }

  /** Changes a group's name. */
  async changeGroupName(groupId: string, name: string): Promise<HttpResponse> {
    const [, response] = await this.v11.conversationUpdateName(groupId, name);
    return response;
  }

  // -- lists -----------------------------------------------------------------

  /**
   * Creates a list.
   *
   * @example
   * const list = await client.createList('list name', 'list description', true);
   */
  async createList(name: string, description = '', isPrivate = false): Promise<TwitterList> {
    const [response] = await this.gql.createList(name, description, isPrivate);
    const listInfo = findDict(response, 'list', true)[0];
    return new TwitterList(this, listInfo);
  }

  /** Sets a list's banner image. */
  async editListBanner(listId: string, mediaId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.editListBanner(listId, mediaId);
    return response;
  }

  /** Deletes a list's banner image. */
  async deleteListBanner(listId: string): Promise<HttpResponse> {
    const [, response] = await this.gql.deleteListBanner(listId);
    return response;
  }

  /**
   * Edits a list's name, description, or privacy.
   *
   * @example
   * await client.editList(listId, { name: 'new name', isPrivate: true });
   */
  async editList(
    listId: string,
    options: { name?: string; description?: string; isPrivate?: boolean } = {}
  ): Promise<TwitterList> {
    const [response] = await this.gql.updateList(
      listId,
      options.name ?? null,
      options.description ?? null,
      options.isPrivate ?? null
    );
    const listInfo = findDict(response, 'list', true)[0];
    return new TwitterList(this, listInfo);
  }

  /** Adds a user to a list. */
  async addListMember(listId: string, userId: string): Promise<TwitterList> {
    const [response] = await this.gql.listAddMember(listId, userId);
    return new TwitterList(this, response.data.list);
  }

  /** Removes a user from a list. */
  async removeListMember(listId: string, userId: string): Promise<TwitterList> {
    const [response] = await this.gql.listRemoveMember(listId, userId);
    if (response.errors) {
      throw new TwitterException(response.errors[0].message);
    }
    return new TwitterList(this, response.data.list);
  }

  /**
   * Retrieves the authenticated user's lists.
   *
   * @example
   * const lists = await client.getLists();
   * const moreLists = await lists.next();
   */
  async getLists(count = 100, cursor: string | null = null): Promise<Result<TwitterList>> {
    const [response] = await this.gql.listManagementPaceTimeline(count, cursor);
    const entries = findDict(response, 'entries', true)[0] ?? [];
    const items = findDict(entries, 'items');
    if (items.length < 2) return new Result<TwitterList>([]);

    const lists = items[1].map(
      (item: Record<string, any>) => new TwitterList(this, item.item.itemContent.list)
    );
    const nextCursor = entries[entries.length - 1]?.content?.value ?? null;

    return new Result<TwitterList>(
      lists,
      () => this.getLists(count, nextCursor),
      nextCursor
    );
  }

  /** Fetches a list by ID. */
  async getList(listId: string): Promise<TwitterList> {
    const [response] = await this.gql.listByRestId(listId);
    const listData = findDict(response, 'list', true);
    if (listData.length === 0) {
      throw new Error(`Invalid list id: ${listId}`);
    }
    return new TwitterList(this, listData[0]);
  }

  /**
   * Retrieves tweets from a list.
   *
   * @example
   * const tweets = await client.getListTweets(listId);
   * const moreTweets = await tweets.next();
   */
  async getListTweets(
    listId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const [response] = await this.gql.listLatestTweetsTimeline(listId, count, cursor);
    const found = findDict(response, 'entries', true);
    if (found.length === 0) {
      throw new Error(`Invalid list id: ${listId}`);
    }

    const items = found[0];
    const nextCursor = items[items.length - 1]?.content?.value ?? null;

    const results: Tweet[] = [];
    for (const item of items) {
      if (!String(item.entryId).startsWith('tweet')) continue;
      const tweet = tweetFromData(this, item);
      if (tweet !== null) results.push(tweet);
    }

    return new Result<Tweet>(
      results,
      () => this.getListTweets(listId, count, nextCursor),
      nextCursor
    );
  }

  private async getListUsers(
    fetcher: (listId: string, count: number, cursor: string | null) => Promise<ApiResult>,
    listId: string,
    count: number,
    cursor: string | null
  ): Promise<Result<User>> {
    const [response] = await fetcher(listId, count, cursor);
    const items = findDict(response, 'entries', true)[0] ?? [];

    const results: User[] = [];
    let nextCursor: string | null = null;

    for (const item of items) {
      const entryId: string = item.entryId;
      if (entryId.startsWith('user')) {
        const userInfo = findDict(item, 'result', true)[0];
        results.push(new User(this, userInfo));
      } else if (entryId.startsWith('cursor-bottom')) {
        nextCursor = item.content.value;
        break;
      }
    }

    return new Result<User>(
      results,
      () => this.getListUsers(fetcher, listId, count, nextCursor),
      nextCursor
    );
  }

  /** Retrieves the members of a list. */
  async getListMembers(
    listId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getListUsers(
      (id, c, cur) => this.gql.listMembers(id, c, cur),
      listId,
      count,
      cursor
    );
  }

  /** Retrieves the subscribers of a list. */
  async getListSubscribers(
    listId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<User>> {
    return this.getListUsers(
      (id, c, cur) => this.gql.listSubscribers(id, c, cur),
      listId,
      count,
      cursor
    );
  }

  /** Searches for lists. */
  async searchList(
    query: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<TwitterList>> {
    const [response] = await this.gql.searchTimeline(query, 'Lists', count, cursor);
    const entries = findDict(response, 'entries', true)[0] ?? [];

    const items =
      cursor === null
        ? entries[0]?.content?.items ?? []
        : findDict(response, 'moduleItems', true)[0] ?? [];

    const lists = items.map(
      (item: Record<string, any>) => new TwitterList(this, item.item.itemContent.list)
    );
    const nextCursor = entries[entries.length - 1]?.content?.value ?? null;

    return new Result<TwitterList>(
      lists,
      () => this.searchList(query, count, nextCursor),
      nextCursor
    );
  }

  // -- notifications ---------------------------------------------------------

  /**
   * Retrieves notifications for the authenticated user.
   *
   * @example
   * const notifications = await client.getNotifications('All');
   * const moreNotifications = await notifications.next();
   */
  async getNotifications(
    type: 'All' | 'Verified' | 'Mentions',
    count = 40,
    cursor: string | null = null
  ): Promise<Result<Notification>> {
    const normalizedType = capitalize(type) as 'All' | 'Verified' | 'Mentions';
    const fetcher = {
      All: (c: number, cur: string | null) => this.v11.notificationsAll(c, cur),
      Verified: (c: number, cur: string | null) => this.v11.notificationsVerified(c, cur),
      Mentions: (c: number, cur: string | null) => this.v11.notificationsMentions(c, cur),
    }[normalizedType];

    const [response] = await fetcher(count, cursor);
    const globalObjects = response.globalObjects ?? {};

    const users: Record<string, User> = {};
    for (const [id, data] of Object.entries<Record<string, any>>(globalObjects.users ?? {})) {
      users[id] = new User(this, buildUserData(data));
    }

    const tweets: Record<string, Tweet> = {};
    for (const [id, tweetData] of Object.entries<Record<string, any>>(
      globalObjects.tweets ?? {}
    )) {
      const user = users[tweetData.user_id_str];
      tweets[id] = new Tweet(this, buildTweetData(tweetData), user ?? null);
    }

    const notifications: Notification[] = [];
    for (const notification of Object.values<Record<string, any>>(
      globalObjects.notifications ?? {}
    )) {
      const userActions = notification.template?.aggregateUserActionsV1;
      const targetObjects = userActions?.targetObjects ?? [];
      const tweet =
        targetObjects.length > 0 && targetObjects[0].tweet
          ? tweets[targetObjects[0].tweet.id] ?? null
          : null;

      const fromUsers = userActions?.fromUsers ?? [];
      const user =
        fromUsers.length > 0 && fromUsers[0].user
          ? users[fromUsers[0].user.id] ?? null
          : null;

      notifications.push(new Notification(this, notification, tweet, user));
    }

    const entries = findDict(response, 'entries', true)[0] ?? [];
    const cursorBottomEntry = entries.filter((entry: any) =>
      String(entry.entryId).startsWith('cursor-bottom')
    );
    const nextCursor =
      cursorBottomEntry.length > 0
        ? findDict(cursorBottomEntry[0], 'value', true)[0] ?? null
        : null;

    return new Result<Notification>(
      notifications,
      () => this.getNotifications(normalizedType, count, nextCursor),
      nextCursor
    );
  }

  // -- communities -----------------------------------------------------------

  /** Searches for communities. */
  async searchCommunity(
    query: string,
    cursor: string | null = null
  ): Promise<Result<Community>> {
    const [response] = await this.gql.searchCommunity(query, cursor);
    const items = findDict(response, 'items_results', true)[0] ?? [];

    const communities = items.map(
      (item: Record<string, any>) => new Community(this, item.result)
    );

    const found = findDict(response, 'next_cursor', true);
    const nextCursor: string | null = found.length > 0 ? found[0] : null;
    const fetchNextResult =
      nextCursor === null ? null : () => this.searchCommunity(query, nextCursor);

    return new Result<Community>(communities, fetchNextResult, nextCursor);
  }

  /** Fetches a community by ID. */
  async getCommunity(communityId: string): Promise<Community> {
    const [response] = await this.gql.communityQuery(communityId);
    const communityData = findDict(response, 'result', true)[0];
    return new Community(this, communityData);
  }

  /**
   * Retrieves tweets posted in a community.
   *
   * @example
   * const tweets = await client.getCommunityTweets(communityId, 'Latest');
   * const moreTweets = await tweets.next();
   */
  async getCommunityTweets(
    communityId: string,
    tweetType: 'Top' | 'Latest' | 'Media',
    count = 40,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    let response: Record<string, any>;
    if (tweetType === 'Media') {
      [response] = await this.gql.communityMediaTimeline(communityId, count, cursor);
    } else if (tweetType === 'Top') {
      [response] = await this.gql.communityTweetsTimeline(
        communityId,
        'Relevance',
        count,
        cursor
      );
    } else if (tweetType === 'Latest') {
      [response] = await this.gql.communityTweetsTimeline(
        communityId,
        'Recency',
        count,
        cursor
      );
    } else {
      throw new Error(`Invalid tweetType: ${String(tweetType)}`);
    }

    const entries = findDict(response, 'entries', true)[0] ?? [];
    const nextCursor = entries[entries.length - 1]?.content?.value ?? null;
    const previousCursor = entries[entries.length - 2]?.content?.value ?? null;

    let items: any[];
    if (tweetType === 'Media') {
      items =
        cursor === null
          ? entries[0]?.content?.items ?? []
          : findDict(response, 'moduleItems', true)[0] ?? [];
    } else {
      items = entries;
    }

    const tweets: Tweet[] = [];
    for (const item of items) {
      const entryId = String(item.entryId);
      if (!entryId.startsWith('tweet') && !entryId.startsWith('communities-grid')) continue;
      const tweet = tweetFromData(this, item);
      if (tweet !== null) tweets.push(tweet);
    }

    return new Result<Tweet>(
      tweets,
      () => this.getCommunityTweets(communityId, tweetType, count, nextCursor),
      nextCursor,
      () => this.getCommunityTweets(communityId, tweetType, count, previousCursor),
      previousCursor
    );
  }

  /** Retrieves the communities home timeline. */
  async getCommunitiesTimeline(
    count = 20,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const [response] = await this.gql.communitiesMainPageTimeline(count, cursor);
    const items = findDict(response, 'entries', true)[0] ?? [];

    const tweets: Tweet[] = [];
    for (const item of items) {
      if (!String(item.entryId).startsWith('tweet')) continue;

      let tweetData = findDict(item, 'result', true)[0];
      if (tweetData?.tweet) tweetData = tweetData.tweet;

      const userData = tweetData.core.user_results.result;
      const communityData = tweetData.community_results.result;
      communityData.rest_id = communityData.id_str;

      const tweet = new Tweet(this, tweetData, new User(this, userData));
      tweet.community = new Community(this, communityData);
      tweets.push(tweet);
    }

    const nextCursor = items[items.length - 1]?.content?.value ?? null;
    const previousCursor = items[items.length - 2]?.content?.value ?? null;

    return new Result<Tweet>(
      tweets,
      () => this.getCommunitiesTimeline(count, nextCursor),
      nextCursor,
      () => this.getCommunitiesTimeline(count, previousCursor),
      previousCursor
    );
  }

  /** Joins a community. */
  async joinCommunity(communityId: string): Promise<Community> {
    const [response] = await this.gql.joinCommunity(communityId);
    const communityData = response.data.community_join;
    communityData.rest_id = communityData.id_str;
    return new Community(this, communityData);
  }

  /** Leaves a community. */
  async leaveCommunity(communityId: string): Promise<Community> {
    const [response] = await this.gql.leaveCommunity(communityId);
    const communityData = response.data.community_leave;
    communityData.rest_id = communityData.id_str;
    return new Community(this, communityData);
  }

  /** Requests to join a community. */
  async requestToJoinCommunity(communityId: string, answer?: string): Promise<Community> {
    const [response] = await this.gql.requestToJoinCommunity(communityId, answer ?? null);
    const communityData = findDict(response, 'result', true)[0];
    communityData.rest_id = communityData.id_str;
    return new Community(this, communityData);
  }

  private async getCommunityUsers(
    fetcher: (
      communityId: string,
      count: number,
      cursor: string | null
    ) => Promise<ApiResult>,
    communityId: string,
    count: number,
    cursor: string | null
  ): Promise<Result<CommunityMember>> {
    const [response] = await fetcher(communityId, count, cursor);
    const items = findDict(response, 'items_results', true)[0] ?? [];

    const users: CommunityMember[] = [];
    for (const item of items) {
      if (!item.result) continue;
      if (item.result.__typename !== 'User') continue;
      users.push(new CommunityMember(this, item.result));
    }

    const found = findDict(response, 'next_cursor', true);
    const nextCursor: string | null = found.length > 0 ? found[0] : null;
    const fetchNextResult =
      nextCursor === null
        ? null
        : () => this.getCommunityUsers(fetcher, communityId, count, nextCursor);

    return new Result<CommunityMember>(users, fetchNextResult, nextCursor);
  }

  /** Retrieves the members of a community. */
  async getCommunityMembers(
    communityId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<CommunityMember>> {
    return this.getCommunityUsers(
      (id, c, cur) => this.gql.membersSliceTimelineQuery(id, c, cur),
      communityId,
      count,
      cursor
    );
  }

  /** Retrieves the moderators of a community. */
  async getCommunityModerators(
    communityId: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<CommunityMember>> {
    return this.getCommunityUsers(
      (id, c, cur) => this.gql.moderatorsSliceTimelineQuery(id, c, cur),
      communityId,
      count,
      cursor
    );
  }

  /** Searches for tweets within a community. */
  async searchCommunityTweet(
    communityId: string,
    query: string,
    count = 20,
    cursor: string | null = null
  ): Promise<Result<Tweet>> {
    const [response] = await this.gql.communityTweetSearchModuleQuery(
      communityId,
      query,
      count,
      cursor
    );
    const items = findDict(response, 'entries', true)[0] ?? [];

    const tweets: Tweet[] = [];
    for (const item of items) {
      if (!String(item.entryId).startsWith('tweet')) continue;
      const tweet = tweetFromData(this, item);
      if (tweet !== null) tweets.push(tweet);
    }

    const nextCursor = items[items.length - 1]?.content?.value ?? null;
    const previousCursor = items[items.length - 2]?.content?.value ?? null;

    return new Result<Tweet>(
      tweets,
      () => this.searchCommunityTweet(communityId, query, count, nextCursor),
      nextCursor,
      () => this.searchCommunityTweet(communityId, query, count, previousCursor),
      previousCursor
    );
  }

  // -- streaming -------------------------------------------------------------

  /** @internal */
  async *stream(topics: Set<string>): AsyncGenerator<StreamEvent> {
    const url = `https://api.${DOMAIN}/live_pipeline/events`;
    const headers = this.baseHeaders;
    delete headers['content-type'];

    const response = await this.http.request<NodeJS.ReadableStream>('GET', url, {
      params: { topics: [...topics].join(',') },
      headers,
      responseType: 'stream',
      timeout: 0,
    });

    this.http.removeDuplicateCt0Cookie();

    for await (const line of iterateLines(response.data)) {
      let data: Record<string, any>;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      yield [data.topic, payloadFromData(data.payload)];
    }
  }

  /**
   * Opens a streaming session for the given topics.
   *
   * @example
   * import { Topic } from 'twikit-ts';
   *
   * const topics = new Set([
   *   Topic.tweetEngagement('1739617652'),
   *   Topic.dmUpdate('17544932482-174455537996'),
   * ]);
   * const session = await client.getStreamingSession(topics);
   *
   * for await (const [topic, payload] of session) {
   *   if (payload.dmUpdate) console.log(payload.dmUpdate.conversationId);
   *   if (payload.tweetEngagement) console.log(payload.tweetEngagement.likeCount);
   * }
   *
   * @see Topic
   * @see StreamingSession
   */
  async getStreamingSession(
    topics: Set<string>,
    autoReconnect = true
  ): Promise<StreamingSession> {
    const stream = this.stream(topics);
    const first = await stream.next();
    if (first.done || !first.value[1].config) {
      throw new TwitterException('Failed to open a streaming session.');
    }
    const sessionId = first.value[1].config.sessionId;
    return new StreamingSession(this, sessionId, stream, topics, autoReconnect);
  }

  /** @internal */
  async updateSubscriptions(
    session: StreamingSession,
    subscribe?: Set<string>,
    unsubscribe?: Set<string>
  ): Promise<Payload> {
    const toSubscribe = subscribe ?? new Set<string>();
    const toUnsubscribe = unsubscribe ?? new Set<string>();

    const [response] = await this.v11.livePipelineUpdateSubscriptions(
      session.id,
      [...toSubscribe].join(','),
      [...toUnsubscribe].join(',')
    );

    for (const topic of toSubscribe) session.topics.add(topic);
    for (const topic of toUnsubscribe) session.topics.delete(topic);

    return payloadFromData(response);
  }

  private async getUserState(): Promise<string | undefined> {
    const [response] = await this.get(V11Endpoint.USER_STATE, {
      headers: this.baseHeaders,
      raiseException: false,
    } as RequestOptions);
    return response?.userState;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(response: HttpResponse): unknown {
  if (typeof response.data === 'string') {
    try {
      return JSON.parse(response.data);
    } catch {
      return response.text;
    }
  }
  return response.data;
}

async function defaultPrompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${message}\n>>> `)).trim();
  } finally {
    rl.close();
  }
}

/** Subtask versions sent when starting the login flow. */
const SUBTASK_VERSIONS: Record<string, number> = {
  action_list: 2,
  alert_dialog: 1,
  app_download_cta: 1,
  check_logged_in_account: 1,
  choice_selection: 3,
  contacts_live_sync_permission_prompt: 0,
  cta: 7,
  email_verification: 2,
  end_flow: 1,
  enter_date: 1,
  enter_email: 2,
  enter_password: 5,
  enter_phone: 2,
  enter_recaptcha: 1,
  enter_text: 5,
  enter_username: 2,
  generic_urt: 3,
  in_app_notification: 1,
  interest_picker: 3,
  js_instrumentation: 1,
  menu_dialog: 1,
  notifications_permission_prompt: 2,
  open_account: 2,
  open_home_timeline: 1,
  open_link: 1,
  phone_verification: 4,
  privacy_options: 1,
  security_key: 3,
  select_avatar: 4,
  select_banner: 2,
  settings_list: 7,
  show_code: 1,
  sign_up: 2,
  sign_up_review: 4,
  tweet_selection_urt: 1,
  update_users: 1,
  upload_media: 1,
  user_recommendations_list: 4,
  user_recommendations_urt: 1,
  wait_spinner: 3,
  web_modal: 1,
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Splits a readable stream into newline-delimited chunks. */
async function* iterateLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line !== '') yield line;
      newlineIndex = buffer.indexOf('\n');
    }
  }
  if (buffer.trim() !== '') yield buffer.trim();
}
