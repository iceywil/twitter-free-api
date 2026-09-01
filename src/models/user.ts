
import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';
import { timestampToDate, type Result } from '../utils.js';
import type { Message } from './message.js';
import type { Tweet } from './tweet.js';

export class User {
  /** The unique ID of the user. */
  readonly id: string;
  /** The date and time when the user account was created, as sent by the API. */
  readonly createdAt: string;
  /** The display name of the user. */
  readonly name: string;
  /** The user's screen name (handle). */
  readonly screenName: string;
  /** The URL of the user's profile image. */
  readonly profileImageUrl: string;
  /** The URL of the user's profile banner. */
  readonly profileBannerUrl: string | null;
  /** The user's website URL. */
  readonly url: string | null;
  /** The user's location. */
  readonly location: string;
  /** The user's profile description (bio). */
  readonly description: string;
  /** URLs found in the user's description. */
  readonly descriptionUrls: unknown[];
  /** URLs on the user's profile. */
  readonly urls: unknown[] | null;
  /** IDs of the user's pinned tweets. */
  readonly pinnedTweetIds: string[];
  /** Whether the user has a blue check. */
  readonly isBlueVerified: boolean;
  /** Whether the user is verified. */
  readonly verified: boolean;
  /** Whether the user's tweets may be sensitive. */
  readonly possiblySensitive: boolean;
  /** Whether the user can receive DMs. */
  readonly canDm: boolean;
  readonly canMediaTag: boolean;
  readonly wantRetweets: boolean;
  readonly defaultProfile: boolean;
  readonly defaultProfileImage: boolean;
  readonly hasCustomTimelines: boolean;
  /** The number of followers. */
  readonly followersCount: number;
  readonly fastFollowersCount: number;
  readonly normalFollowersCount: number;
  /** The number of accounts the user follows. */
  readonly followingCount: number;
  /** The number of tweets the user has liked. */
  readonly favouritesCount: number;
  /** The number of lists the user appears on. */
  readonly listedCount: number;
  /** The number of media items the user has posted. */
  readonly mediaCount: number;
  /** The number of tweets the user has posted. */
  readonly statusesCount: number;
  readonly isTranslator: boolean;
  readonly translatorType: string;
  readonly withheldInCountries: string[];
  /** Whether the user's account is protected (private). */
  readonly protected: boolean;

  /**
   * x.com is migrating the user payload away from a single `legacy` blob toward
   * per-concern objects (`core`, `avatar`, `profile_bio`, `relationship_counts`,
   * ...). Both shapes are live at once — `UserByScreenName` still returns
   * `legacy`, while `Viewer` returns only the new shape — so each field reads
   * `legacy` first and falls back to its new-schema location.
   */
  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    const legacy = data.legacy ?? {};
    const core = data.core ?? {};

    this.id = data.rest_id;
    this.createdAt = legacy.created_at ?? core.created_at;
    this.name = legacy.name ?? core.name;
    this.screenName = legacy.screen_name ?? core.screen_name;
    this.profileImageUrl = legacy.profile_image_url_https ?? data.avatar?.image_url;
    this.profileBannerUrl = legacy.profile_banner_url ?? data.banner?.image_url ?? null;
    this.url = legacy.url ?? data.website?.url ?? null;
    this.location = legacy.location ?? data.location?.location;
    this.description = legacy.description ?? data.profile_bio?.description;
    this.descriptionUrls =
      legacy.entities?.description?.urls ?? data.profile_bio?.entities?.description?.urls ?? [];
    this.urls = legacy.entities?.url?.urls ?? null;
    this.pinnedTweetIds = legacy.pinned_tweet_ids_str ?? [];
    this.isBlueVerified = data.is_blue_verified;
    this.verified = legacy.verified ?? data.verification?.verified;
    this.possiblySensitive = legacy.possibly_sensitive ?? data.possibly_sensitive;
    this.canDm = legacy.can_dm ?? data.dm_permissions?.can_dm;
    this.canMediaTag = legacy.can_media_tag ?? data.media_permissions?.can_media_tag;
    this.wantRetweets = legacy.want_retweets;
    this.defaultProfile = legacy.default_profile;
    this.defaultProfileImage = legacy.default_profile_image;
    this.hasCustomTimelines = legacy.has_custom_timelines;
    this.followersCount = legacy.followers_count ?? data.relationship_counts?.followers;
    this.fastFollowersCount = legacy.fast_followers_count;
    this.normalFollowersCount = legacy.normal_followers_count;
    this.followingCount = legacy.friends_count ?? data.relationship_counts?.following;
    this.favouritesCount = legacy.favourites_count ?? data.action_counts?.favorites_count;
    this.listedCount = legacy.listed_count;
    this.mediaCount = legacy.media_count ?? data.tweet_counts?.media_tweets;
    this.statusesCount = legacy.statuses_count ?? data.tweet_counts?.tweets;
    this.isTranslator = legacy.is_translator;
    this.translatorType = legacy.translator_type;
    this.withheldInCountries = legacy.withheld_in_countries;
    this.protected = legacy.protected ?? data.privacy?.protected ?? false;
  }

  /** The account creation time as a `Date`. */
  get createdAtDate(): Date {
    return timestampToDate(this.createdAt);
  }

  /**
   * Retrieves the user's tweets.
   *
   * @example
   * const tweets = await user.getTweets('Tweets');
   * const moreTweets = await tweets.next();
   */
  async getTweets(
    tweetType: 'Tweets' | 'Replies' | 'Media' | 'Likes',
    count = 40
  ): Promise<Result<Tweet>> {
    return this.client.getUserTweets(this.id, tweetType, count);
  }

  async follow(): Promise<User> {
    return this.client.followUser(this.id);
  }

  async unfollow(): Promise<User> {
    return this.client.unfollowUser(this.id);
  }

  async block(): Promise<User> {
    return this.client.blockUser(this.id);
  }

  async unblock(): Promise<User> {
    return this.client.unblockUser(this.id);
  }

  async mute(): Promise<User> {
    return this.client.muteUser(this.id);
  }

  async unmute(): Promise<User> {
    return this.client.unmuteUser(this.id);
  }

  async getFollowers(count = 20): Promise<Result<User>> {
    return this.client.getUserFollowers(this.id, count);
  }

  async getVerifiedFollowers(count = 20): Promise<Result<User>> {
    return this.client.getUserVerifiedFollowers(this.id, count);
  }

  async getFollowersYouKnow(count = 20): Promise<Result<User>> {
    return this.client.getUserFollowersYouKnow(this.id, count);
  }

  async getFollowing(count = 20): Promise<Result<User>> {
    return this.client.getUserFollowing(this.id, count);
  }

  async getSubscriptions(count = 20): Promise<Result<User>> {
    return this.client.getUserSubscriptions(this.id, count);
  }

  async getLatestFollowers(count?: number, cursor?: string): Promise<Result<User>> {
    return this.client.getLatestFollowers({ userId: this.id, count, cursor });
  }

  async getLatestFriends(count?: number, cursor?: string): Promise<Result<User>> {
    return this.client.getLatestFriends({ userId: this.id, count, cursor });
  }

  /** Sends a direct message to the user. */
  async sendDm(text: string, mediaId?: string, replyTo?: string): Promise<Message> {
    return this.client.sendDm(this.id, text, mediaId, replyTo);
  }

  /** Retrieves the DM conversation history with the user. */
  async getDmHistory(maxId?: string): Promise<Result<Message>> {
    return this.client.getDmHistory(this.id, maxId);
  }

  async getHighlightsTweets(count = 20, cursor?: string): Promise<Result<Tweet>> {
    return this.client.getUserHighlightsTweets(this.id, count, cursor);
  }

  /** Re-fetches this user and returns the fresh instance. */
  async update(): Promise<User> {
    return this.client.getUserById(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof User && this.id === other.id;
  }

  toString(): string {
    return `<User id="${this.id}">`;
  }
}
