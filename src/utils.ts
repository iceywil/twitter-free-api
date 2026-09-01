
import type { Client } from './client/client.js';

export type Fetcher<T> = () => Promise<Result<T>>;

/**
 * Stores multiple results and knows how to fetch the adjacent pages.
 *
 * Extends `Array`, so it can be indexed and iterated like a plain list — the
 * Python original supports the same — while `next()`/`previous()` walk the
 * cursor-based pagination.
 */
export class Result<T> extends Array<T> {
  /** Keeps `map`/`filter`/`slice` returning plain arrays instead of half-built Results. */
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  nextCursor: string | null;
  previousCursor: string | null;

  private fetchNextResult: Fetcher<T> | null;
  private fetchPreviousResult: Fetcher<T> | null;

  constructor(
    results: T[] = [],
    fetchNextResult: Fetcher<T> | null = null,
    nextCursor: string | null = null,
    fetchPreviousResult: Fetcher<T> | null = null,
    previousCursor: string | null = null
  ) {
    super();
    for (const result of results) this.push(result);
    this.nextCursor = nextCursor;
    this.previousCursor = previousCursor;
    this.fetchNextResult = fetchNextResult;
    this.fetchPreviousResult = fetchPreviousResult;
  }

  /** Alias of `nextCursor`, matching the Python attribute. */
  get token(): string | null {
    return this.nextCursor;
  }

  /** Alias of `nextCursor`, matching the Python attribute. */
  get cursor(): string | null {
    return this.nextCursor;
  }

  async next(): Promise<Result<T>> {
    if (this.fetchNextResult === null) return new Result<T>([]);
    return this.fetchNextResult();
  }

  async previous(): Promise<Result<T>> {
    if (this.fetchPreviousResult === null) return new Result<T>([]);
    return this.fetchPreviousResult();
  }

  static empty<U>(): Result<U> {
    return new Result<U>([]);
  }

  toArray(): T[] {
    return Array.from(this);
  }
}

interface FlowResponse {
  flow_token?: string;
  subtasks?: Record<string, any>[];
  [key: string]: unknown;
}

/** Drives the multi-step onboarding/login flow. */
export class Flow {
  response: FlowResponse | null = null;

  constructor(
    private readonly client: Client,
    public readonly guestToken: string
  ) {}

  async executeTask(
    subtaskInputs: unknown[] = [],
    options: { data?: Record<string, unknown>; params?: Record<string, unknown> } = {}
  ): Promise<void> {
    const [response] = await this.client.v11.onboardingTask(
      this.guestToken,
      this.token,
      subtaskInputs,
      options.data ?? {},
      options.params ? { params: options.params } : {}
    );
    this.response = response as FlowResponse;
  }

  async ssoInit(provider: string): Promise<void> {
    await this.client.v11.ssoInit(provider, this.guestToken);
  }

  get token(): string | null {
    return this.response?.flow_token ?? null;
  }

  get taskId(): string | null {
    const subtasks = this.response?.subtasks;
    if (!subtasks || subtasks.length === 0) return null;
    return subtasks[0].subtask_id ?? null;
  }
}

/** Recursively collects every value stored under `key` in a nested structure. */
export function findDict(obj: unknown, key: string | number, findOne = false): any[] {
  const results: any[] = [];

  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    if (String(key) in record) {
      results.push(record[String(key)]);
      if (findOne) return results;
    }
  }

  if (obj !== null && typeof obj === 'object') {
    const values = Array.isArray(obj) ? obj : Object.values(obj as Record<string, unknown>);
    for (const element of values) {
      const found = findDict(element, key, findOne);
      results.push(...found);
      if (found.length > 0 && findOne) return results;
    }
  }

  return results;
}

/**
 * Extracts the query id from a GraphQL URL.
 *
 * @example
 * getQueryId('https://twitter.com/i/api/graphql/queryid/Name') // 'queryid'
 */
export function getQueryId(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 2];
}

/** Parses Twitter's `created_at` format, e.g. `Wed Oct 10 20:19:24 +0000 2018`. */
export function timestampToDate(timestamp: string): Date {
  return new Date(timestamp);
}

export function buildTweetData(rawData: Record<string, any>): Record<string, any> {
  return {
    ...rawData,
    rest_id: rawData.id,
    is_translatable: null,
    views: {},
    edit_control: {},
    legacy: {
      created_at: rawData.created_at,
      full_text: rawData.full_text ?? rawData.text,
      lang: rawData.lang,
      is_quote_status: rawData.is_quote_status,
      in_reply_to_status_id_str: rawData.in_reply_to_status_id_str,
      retweeted_status_result: rawData.retweeted_status_result,
      possibly_sensitive: rawData.possibly_sensitive,
      possibly_sensitive_editable: rawData.possibly_sensitive_editable,
      quote_count: rawData.quote_count,
      entities: rawData.entities,
      reply_count: rawData.reply_count,
      favorite_count: rawData.favorite_count,
      favorited: rawData.favorited,
      retweet_count: rawData.retweet_count,
    },
  };
}

export function buildUserData(rawData: Record<string, any>): Record<string, any> {
  return {
    ...rawData,
    rest_id: rawData.id,
    is_blue_verified: rawData.ext_is_blue_verified,
    legacy: {
      created_at: rawData.created_at,
      name: rawData.name,
      screen_name: rawData.screen_name,
      profile_image_url_https: rawData.profile_image_url_https,
      location: rawData.location,
      description: rawData.description,
      entities: rawData.entities,
      pinned_tweet_ids_str: rawData.pinned_tweet_ids_str,
      verified: rawData.verified,
      possibly_sensitive: rawData.possibly_sensitive,
      can_dm: rawData.can_dm,
      can_media_tag: rawData.can_media_tag,
      want_retweets: rawData.want_retweets,
      default_profile: rawData.default_profile,
      default_profile_image: rawData.default_profile_image,
      has_custom_timelines: rawData.has_custom_timelines,
      followers_count: rawData.followers_count,
      fast_followers_count: rawData.fast_followers_count,
      normal_followers_count: rawData.normal_followers_count,
      friends_count: rawData.friends_count,
      favourites_count: rawData.favourites_count,
      listed_count: rawData.listed_count,
      media_count: rawData.media_count,
      statuses_count: rawData.statuses_count,
      is_translator: rawData.is_translator,
      translator_type: rawData.translator_type,
      withheld_in_countries: rawData.withheld_in_countries,
      url: rawData.url,
      profile_banner_url: rawData.profile_banner_url,
    },
  };
}

export function flattenParams(params: Record<string, unknown>): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    flattened[key] = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  }
  return flattened;
}

export function b64ToStr(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function findEntryByType<T extends { type?: string }>(
  entries: T[],
  typeFilter: string
): T | null {
  for (const entry of entries) {
    if (entry.type === typeFilter) return entry;
  }
  return null;
}

export type Filters =
  | 'media'
  | 'retweets'
  | 'native_video'
  | 'periscope'
  | 'vine'
  | 'images'
  | 'twimg'
  | 'links';

export interface SearchOptions {
  /** Exact phrases the tweet must contain. */
  exactPhrases?: string[];
  /** The tweet must contain at least one of these keywords. */
  orKeywords?: string[];
  /** Keywords the tweet must not contain. */
  excludeKeywords?: string[];
  hashtags?: string[];
  /** Only tweets from this username. */
  fromUser?: string;
  /** Only tweets sent to this username. */
  toUser?: string;
  /** Only tweets mentioning these usernames. */
  mentionedUsers?: string[];
  filters?: Filters[];
  excludeFilters?: Filters[];
  /** Only tweets containing these URLs. */
  urls?: string[];
  /** `YYYY-MM-DD` — only tweets since this date. */
  since?: string;
  /** `YYYY-MM-DD` — only tweets until this date. */
  until?: string;
  /** Include positive sentiment. */
  positive?: boolean;
  /** Include negative sentiment. */
  negative?: boolean;
  /** Search for tweets in question form. */
  question?: boolean;
}

/**
 * Builds a Twitter search query from base text plus structured options.
 *
 * @see https://developer.twitter.com/en/docs/twitter-api/v1/rules-and-filtering/search-operators
 */
export function buildQuery(text: string, options: SearchOptions = {}): string {
  let query = text;

  if (options.exactPhrases?.length) {
    query += ' ' + options.exactPhrases.map((i) => `"${i}"`).join(' ');
  }
  if (options.orKeywords?.length) {
    query += ' ' + options.orKeywords.join(' OR ');
  }
  if (options.excludeKeywords?.length) {
    query += ' ' + options.excludeKeywords.map((i) => `-"${i}"`).join(' ');
  }
  if (options.hashtags?.length) {
    query += ' ' + options.hashtags.map((i) => `#${i}`).join(' ');
  }
  if (options.fromUser) {
    query += ` from:${options.fromUser}`;
  }
  if (options.toUser) {
    query += ` to:${options.toUser}`;
  }
  if (options.mentionedUsers?.length) {
    query += ' ' + options.mentionedUsers.map((i) => `@${i}`).join(' ');
  }
  if (options.filters?.length) {
    query += ' ' + options.filters.map((i) => `filter:${i}`).join(' ');
  }
  if (options.excludeFilters?.length) {
    query += ' ' + options.excludeFilters.map((i) => `-filter:${i}`).join(' ');
  }
  if (options.urls?.length) {
    query += ' ' + options.urls.map((i) => `url:${i}`).join(' ');
  }
  if (options.since) {
    query += ` since:${options.since}`;
  }
  if (options.until) {
    query += ` until:${options.until}`;
  }
  if (options.positive === true) query += ' :)';
  if (options.negative === true) query += ' :(';
  if (options.question === true) query += ' ?';

  return query;
}
