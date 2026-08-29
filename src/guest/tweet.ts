/** Ported from twikit/guest/tweet.py */

import { mediaFromData, type MediaType } from '../models/media.js';
import { findDict } from '../utils.js';
import type { Client } from '../client/client.js';
import type { GuestClient } from './client.js';
import { GuestUser } from './user.js';

export interface GuestCommunityNote {
  id: string;
  text: string;
}

/**
 * A tweet as seen by the guest (unauthenticated) client.
 *
 * Unlike the authenticated `Tweet`, every field is resolved eagerly in the
 * constructor, matching the Python original.
 */
export class GuestTweet {
  replyTo: GuestTweet[] | null = null;
  relatedTweets: GuestTweet[] | null = null;
  thread: GuestTweet[] | null = null;

  readonly id: string;
  readonly createdAt: string;
  readonly text: string;
  readonly lang: string;
  readonly isQuoteStatus: boolean;
  readonly inReplyTo: string | null;
  readonly possiblySensitive: boolean;
  readonly possiblySensitiveEditable: boolean;
  readonly quoteCount: number;
  readonly replyCount: number;
  readonly favoriteCount: number;
  readonly favorited: boolean;
  readonly retweetCount: number;
  readonly bookmarkCount: number;
  readonly bookmarked: boolean;
  readonly editTweetIds: string[];
  readonly editableUntilMsecs: number;
  readonly isTranslatable: boolean;
  readonly isEditEligible: boolean;
  readonly editsRemaining: number;
  readonly viewCount: string | null;
  readonly viewCountState: string | null;
  readonly hasCommunityNotes: boolean;
  readonly quote: GuestTweet | null;
  readonly retweetedTweet: GuestTweet | null;
  readonly fullText: string;
  readonly urls: unknown[] | null;
  readonly hashtags: string[];
  readonly communityNote: GuestCommunityNote | null = null;
  readonly hasCard: boolean;
  readonly thumbnailUrl: string | null = null;
  readonly thumbnailTitle: string | null = null;

  private readonly mediaData: Record<string, any>[];
  private readonly placeData: Record<string, any> | null;
  private readonly pollData: Record<string, any> | null;

  constructor(
    private readonly client: GuestClient,
    data: Record<string, any>,
    public user: GuestUser | null = null
  ) {
    this.id = data.rest_id;
    const legacy = data.legacy ?? {};

    this.createdAt = legacy.created_at;
    this.text = legacy.full_text;
    this.lang = legacy.lang;
    this.isQuoteStatus = legacy.is_quote_status;
    this.inReplyTo = legacy.in_reply_to_status_id_str ?? null;
    this.possiblySensitive = legacy.possibly_sensitive;
    this.possiblySensitiveEditable = legacy.possibly_sensitive_editable;
    this.quoteCount = legacy.quote_count;
    this.mediaData = legacy.entities?.media ?? [];
    this.replyCount = legacy.reply_count;
    this.favoriteCount = legacy.favorite_count;
    this.favorited = legacy.favorited;
    this.retweetCount = legacy.retweet_count;
    this.placeData = legacy.place ?? null;
    this.bookmarkCount = legacy.bookmark_count;
    this.bookmarked = legacy.bookmarked;
    this.editTweetIds = data.edit_control?.edit_tweet_ids ?? [];
    this.editableUntilMsecs = data.edit_control?.editable_until_msecs;
    this.isTranslatable = data.is_translatable;
    this.isEditEligible = data.edit_control?.is_edit_eligible;
    this.editsRemaining = data.edit_control?.edits_remaining;
    this.viewCount = data.views?.count ?? null;
    this.viewCountState = data.views?.state ?? null;
    this.hasCommunityNotes = data.has_birdwatch_notes;

    // A deleted or otherwise unavailable quote/retweet comes back as an empty
    // object, or as a result carrying no `core`. Upstream indexes straight into
    // it and raises; skip those instead.
    this.quote = GuestTweet.fromNested(client, data.quoted_status_result);
    this.retweetedTweet = GuestTweet.fromNested(client, legacy.retweeted_status_result);

    const noteTweetResults = findDict(data, 'note_tweet_results', true);
    this.fullText = this.text;
    let hashtags: Record<string, any>[];

    if (noteTweetResults.length > 0) {
      const textList = findDict(noteTweetResults, 'text', true);
      if (textList.length > 0) this.fullText = textList[0];
      const entitySet = noteTweetResults[0].result.entity_set ?? {};
      this.urls = entitySet.urls ?? null;
      hashtags = entitySet.hashtags ?? [];
    } else {
      this.urls = legacy.entities?.urls ?? null;
      hashtags = legacy.entities?.hashtags ?? [];
    }
    this.hashtags = hashtags.map((hashtag) => hashtag.text);

    const communityNoteData = data.birdwatch_pivot;
    if (communityNoteData?.note) {
      this.communityNote = {
        id: communityNoteData.note.rest_id,
        text: communityNoteData.subtitle.text,
      };
    }

    const cardName = data.card?.legacy?.name;
    this.pollData =
      typeof cardName === 'string' && cardName.startsWith('poll') ? data.card : null;

    this.hasCard = 'card' in data;

    const cardData = data.card?.legacy?.binding_values;
    if (Array.isArray(cardData)) {
      const bindingValues: Record<string, any> = {};
      for (const item of cardData) bindingValues[item.key] = item.value;

      this.thumbnailTitle = bindingValues.title?.string_value ?? null;
      this.thumbnailUrl =
        bindingValues.thumbnail_image_original?.image_value?.url ?? null;
    }
  }

  /**
   * Builds a nested quote/retweet from its `{ result: ... }` wrapper, returning
   * `null` when the tweet is unavailable.
   */
  private static fromNested(
    client: GuestClient,
    wrapper: Record<string, any> | null | undefined
  ): GuestTweet | null {
    let nested = wrapper?.result;
    if (!nested) return null;
    if (nested.tweet) nested = nested.tweet;
    if (nested.__typename === 'TweetTombstone') return null;

    const userData = nested.core?.user_results?.result;
    if (!userData || !nested.legacy) return null;

    return new GuestTweet(client, nested, new GuestUser(client, userData));
  }

  /** Media attached to the tweet. */
  get media(): MediaType[] {
    const result: MediaType[] = [];
    for (const entry of this.mediaData) {
      // The media models only use the client to issue plain GETs, which the
      // guest client also provides.
      const mediaObj = mediaFromData(this.client as unknown as Client, entry);
      if (mediaObj) result.push(mediaObj);
    }
    return result;
  }

  /** Re-fetches this tweet and returns the fresh instance. */
  async update(): Promise<GuestTweet | null> {
    return this.client.getTweetById(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof GuestTweet && this.id === other.id;
  }

  toString(): string {
    return `<Tweet id="${this.id}">`;
  }
}
