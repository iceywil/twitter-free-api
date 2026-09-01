
import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';
import { findDict, timestampToDate, type Result } from '../utils.js';
import type { Community } from './community.js';
import { Place } from './geo.js';
import { mediaFromData, type MediaType } from './media.js';
import { User } from './user.js';

export interface CommunityNoteSummary {
  id: string;
  text: string;
}

export interface PollChoice {
  number: string;
  label: string;
  count: string;
}

export class Tweet {
  private readonly legacy: Record<string, any>;

  /** Replies to this tweet, when populated by the fetching method. */
  replies: Result<Tweet> | null = null;
  /** Tweets this tweet is replying to, when populated. */
  replyTo: Tweet[] | null = null;
  /** Related tweets, when populated. */
  relatedTweets: Tweet[] | null = null;
  /** The thread this tweet belongs to, when populated. */
  thread: Tweet[] | null = null;
  /** The community the tweet was posted in, when populated. */
  community: Community | null = null;

  constructor(
    private readonly client: Client,
    private readonly data: Record<string, any>,
    /** The user who posted the tweet. */
    public user: User | null = null
  ) {
    this.legacy = data.legacy;
  }

  /** The unique ID of the tweet. */
  get id(): string {
    return this.data.rest_id;
  }

  /** The date and time the tweet was created, as sent by the API. */
  get createdAt(): string {
    return this.legacy.created_at;
  }

  /** The full text of the tweet. */
  get text(): string {
    return this.legacy.full_text;
  }

  /** The language of the tweet. */
  get lang(): string {
    return this.legacy.lang;
  }

  /** The ID of the tweet this one replies to. */
  get inReplyTo(): string | null {
    return this.legacy.in_reply_to_status_id_str ?? null;
  }

  /** Whether the tweet is a quote of another tweet. */
  get isQuoteStatus(): boolean {
    return this.legacy.is_quote_status;
  }

  get possiblySensitive(): boolean {
    return this.legacy.possibly_sensitive;
  }

  get possiblySensitiveEditable(): boolean {
    return this.legacy.possibly_sensitive_editable;
  }

  get quoteCount(): number {
    return this.legacy.quote_count;
  }

  get replyCount(): number {
    return this.legacy.reply_count;
  }

  get favoriteCount(): number {
    return this.legacy.favorite_count;
  }

  /** Whether the authenticated user has liked the tweet. */
  get favorited(): boolean {
    return this.legacy.favorited;
  }

  get retweetCount(): number {
    return this.legacy.retweet_count;
  }

  get bookmarkCount(): number {
    return this.legacy.bookmark_count;
  }

  /** Whether the authenticated user has bookmarked the tweet. */
  get bookmarked(): boolean {
    return this.legacy.bookmarked;
  }

  get editTweetIds(): string[] {
    return this.data.edit_control?.edit_tweet_ids ?? [];
  }

  get editableUntilMsecs(): number {
    return this.data.edit_control?.editable_until_msecs;
  }

  get isTranslatable(): boolean {
    return this.data.is_translatable;
  }

  get isEditEligible(): boolean {
    return this.data.edit_control?.is_edit_eligible;
  }

  get editsRemaining(): number {
    return this.data.edit_control?.edits_remaining;
  }

  get viewCount(): number | null {
    return this.data.views?.count ?? null;
  }

  get viewCountState(): string | null {
    return this.data.views?.state ?? null;
  }

  get hasCommunityNotes(): boolean {
    return this.data.has_birdwatch_notes;
  }

  /** The quoted tweet, if any. */
  get quote(): Tweet | null {
    if (this.data.quoted_status_result) {
      return tweetFromData(this.client, this.data.quoted_status_result);
    }
    return null;
  }

  /** The retweeted tweet, if this tweet is a retweet. */
  get retweetedTweet(): Tweet | null {
    if (this.legacy.retweeted_status_result) {
      return tweetFromData(this.client, this.legacy.retweeted_status_result);
    }
    return null;
  }

  private get noteTweetResults(): Record<string, any> | null {
    return this.data.note_tweet?.note_tweet_results ?? null;
  }

  /** The complete text, expanded for long-form ("note") tweets. */
  get fullText(): string {
    const noteTweetResults = this.noteTweetResults;
    if (noteTweetResults) return noteTweetResults.result.text;
    return this.text;
  }

  /** Hashtags used in the tweet. */
  get hashtags(): string[] {
    const noteTweetResults = this.noteTweetResults;
    const hashtags = noteTweetResults
      ? noteTweetResults.result.entity_set?.hashtags ?? []
      : this.legacy.entities?.hashtags ?? [];
    return hashtags.map((hashtag: Record<string, any>) => hashtag.text);
  }

  /** URLs contained in the tweet. */
  get urls(): unknown[] {
    const noteTweetResults = this.noteTweetResults;
    if (noteTweetResults) return noteTweetResults.result.entity_set?.urls;
    return this.legacy.entities?.urls;
  }

  /** The attached community note, if any. */
  get communityNote(): CommunityNoteSummary | null {
    const communityNoteData = this.data.birdwatch_pivot;
    if (communityNoteData?.note) {
      return {
        id: communityNoteData.note.rest_id,
        text: communityNoteData.subtitle.text,
      };
    }
    return null;
  }

  private get bindingValues(): Record<string, any> | null {
    const cardData = this.data.card?.legacy?.binding_values;
    if (Array.isArray(cardData)) {
      const values: Record<string, any> = {};
      for (const item of cardData) {
        values[item.key] = item.value;
      }
      return values;
    }
    return null;
  }

  get hasCard(): boolean {
    return 'card' in this.data;
  }

  get thumbnailTitle(): string | null {
    return this.bindingValues?.title?.string_value ?? null;
  }

  get thumbnailUrl(): string | null {
    return this.bindingValues?.thumbnail_image_original?.image_value?.url ?? null;
  }

  /** The tweet creation time as a `Date`. */
  get createdAtDate(): Date {
    return timestampToDate(this.createdAt);
  }

  /** The attached poll, if any. */
  get poll(): Poll | null {
    const name = this.data.card?.legacy?.name;
    if (typeof name === 'string' && name.startsWith('poll')) {
      return new Poll(this.client, this.data.card, this);
    }
    return null;
  }

  /** The place the tweet was posted from, if any. */
  get place(): Place | null {
    const placeData = this.legacy.place;
    return placeData ? new Place(this.client, placeData) : null;
  }

  /** Media attached to the tweet. */
  get media(): MediaType[] {
    const mediaData = this.legacy.entities?.media ?? [];
    const result: MediaType[] = [];
    for (const entry of mediaData) {
      const mediaObj = mediaFromData(this.client, entry);
      if (mediaObj) result.push(mediaObj);
    }
    return result;
  }

  async delete(): Promise<HttpResponse> {
    return this.client.deleteTweet(this.id);
  }

  async favorite(): Promise<HttpResponse> {
    return this.client.favoriteTweet(this.id);
  }

  async unfavorite(): Promise<HttpResponse> {
    return this.client.unfavoriteTweet(this.id);
  }

  async retweet(): Promise<HttpResponse> {
    return this.client.retweet(this.id);
  }

  async deleteRetweet(): Promise<HttpResponse> {
    return this.client.deleteRetweet(this.id);
  }

  async bookmark(): Promise<HttpResponse> {
    return this.client.bookmarkTweet(this.id);
  }

  async deleteBookmark(): Promise<HttpResponse> {
    return this.client.deleteBookmark(this.id);
  }

  /** Replies to the tweet. */
  async reply(
    text = '',
    mediaIds?: string[],
    options: Record<string, unknown> = {}
  ): Promise<Tweet | null> {
    return this.client.createTweet(text, { ...options, mediaIds, replyTo: this.id });
  }

  async getRetweeters(count = 40, cursor?: string): Promise<Result<User>> {
    return this.client.getRetweeters(this.id, count, cursor);
  }

  async getFavoriters(count = 40, cursor?: string): Promise<Result<User>> {
    return this.client.getFavoriters(this.id, count, cursor);
  }

  async getSimilarTweets(): Promise<Tweet[]> {
    return this.client.getSimilarTweets(this.id);
  }

  /** Re-fetches this tweet and returns the fresh instance. */
  async update(): Promise<Tweet> {
    return this.client.getTweetById(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof Tweet && this.id === other.id;
  }

  toString(): string {
    return `<Tweet id="${this.id}">`;
  }
}

/** Builds a `Tweet` from a raw GraphQL result, or `null` when unusable. */
export function tweetFromData(client: Client, data: unknown): Tweet | null {
  const found = findDict(data, 'result', true);
  if (found.length === 0) return null;

  let tweetData = found[0];
  if (tweetData?.__typename === 'TweetTombstone') return null;
  if (tweetData?.tweet) tweetData = tweetData.tweet;

  if (!tweetData?.core) return null;
  if (!tweetData.core.user_results?.result) return null;
  if (!tweetData.legacy) return null;

  const userData = tweetData.core.user_results.result;
  return new Tweet(client, tweetData, new User(client, userData));
}

export class ScheduledTweet {
  readonly id: string;
  readonly executeAt: number;
  readonly state: string;
  readonly type: string;
  readonly text: string;
  readonly media: Record<string, unknown>[];

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.rest_id;
    this.executeAt = data.scheduling_info?.execute_at;
    this.state = data.scheduling_info?.state;
    this.type = data.tweet_create_request?.type;
    this.text = data.tweet_create_request?.status;
    this.media = (data.media_entities ?? []).map(
      (entity: Record<string, any>) => entity.media_info
    );
  }

  async delete(): Promise<HttpResponse> {
    return this.client.deleteScheduledTweet(this.id);
  }

  toString(): string {
    return `<ScheduledTweet id="${this.id}">`;
  }
}

export class TweetTombstone {
  readonly text: string;

  constructor(
    private readonly client: Client,
    readonly id: string,
    data: Record<string, any>
  ) {
    this.text = data.text?.text;
  }

  equals(other: unknown): boolean {
    return other instanceof TweetTombstone && this.id === other.id;
  }

  toString(): string {
    return `<TweetTombstone id="${this.id}">`;
  }
}

export class Poll {
  readonly id: string;
  readonly name: string;
  readonly choices: PollChoice[];
  readonly durationMinutes: number;
  readonly endDatetimeUtc: string;
  readonly lastUpdatedDatetimeUtc: string;
  readonly countsAreFinal: boolean;
  readonly selectedChoice: string | null;

  constructor(
    private readonly client: Client,
    data: Record<string, any>,
    /** The tweet the poll is attached to. */
    readonly tweet: Tweet | null = null
  ) {
    const legacy = data.legacy;
    let bindingValues = legacy.binding_values;
    if (Array.isArray(bindingValues)) {
      const values: Record<string, any> = {};
      for (const item of bindingValues) {
        values[item.key] = item.value;
      }
      bindingValues = values;
    }

    this.id = data.rest_id;
    this.name = legacy.name;

    const choicesMatch = /poll(\d)choice_text_only/.exec(this.name);
    const choicesNumber = choicesMatch ? Number.parseInt(choicesMatch[1], 10) : 0;

    const choices: PollChoice[] = [];
    for (let i = 1; i <= choicesNumber; i += 1) {
      const choiceLabel = bindingValues[`choice${i}_label`];
      const choiceCount = bindingValues[`choice${i}_count`] ?? {};
      choices.push({
        number: String(i),
        label: choiceLabel.string_value,
        count: choiceCount.string_value ?? '0',
      });
    }
    this.choices = choices;

    this.durationMinutes = Number.parseInt(bindingValues.duration_minutes.string_value, 10);
    this.endDatetimeUtc = bindingValues.end_datetime_utc.string_value;
    this.lastUpdatedDatetimeUtc = bindingValues.last_updated_datetime_utc.string_value;
    this.countsAreFinal = bindingValues.counts_are_final.boolean_value;
    this.selectedChoice = bindingValues.selected_choice?.string_value ?? null;
  }

  /** Casts a vote for the given choice number. */
  async vote(selectedChoice: string): Promise<Poll> {
    if (this.tweet === null) {
      throw new Error('Cannot vote on a poll that is not attached to a tweet');
    }
    return this.client.vote(selectedChoice, this.id, this.tweet.id, this.name);
  }

  equals(other: unknown): boolean {
    return other instanceof Poll && this.id === other.id;
  }

  toString(): string {
    return `<Poll id="${this.id}">`;
  }
}

export class CommunityNote {
  readonly id: string;
  readonly text: string;
  readonly misleadingTags: string[] | null;
  readonly trustworthySources: boolean | null;
  readonly helpfulTags: string[] | null;
  readonly createdAt: number | null;
  readonly canAppeal: boolean | null;
  readonly appealStatus: string | null;
  readonly isMediaNote: boolean | null;
  readonly mediaNoteMatches: string | null;
  readonly birdwatchProfile: Record<string, unknown> | null;
  readonly tweetId: string;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.rest_id;
    const dataV1 = data.data_v1 ?? {};
    this.text = dataV1.summary?.text;
    this.misleadingTags = dataV1.misleading_tags ?? null;
    this.trustworthySources = dataV1.trustworthy_sources ?? null;
    this.helpfulTags = data.helpful_tags ?? null;
    this.createdAt = data.created_at ?? null;
    this.canAppeal = data.can_appeal ?? null;
    this.appealStatus = data.appeal_status ?? null;
    this.isMediaNote = data.is_media_note ?? null;
    this.mediaNoteMatches = data.media_note_matches ?? null;
    this.birdwatchProfile = data.birdwatch_profile ?? null;
    this.tweetId = data.tweet_results?.result?.rest_id;
  }

  /** Re-fetches this note and returns the fresh instance. */
  async update(): Promise<CommunityNote> {
    return this.client.getCommunityNote(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof CommunityNote && this.id === other.id;
  }

  toString(): string {
    return `<CommunityNote id="${this.id}">`;
  }
}
