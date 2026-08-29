/** Ported from twikit/guest/user.py */

import { timestampToDate, type Result } from '../utils.js';
import type { GuestClient } from './client.js';
import type { GuestTweet } from './tweet.js';

/** A user as seen by the guest (unauthenticated) client. */
export class GuestUser {
  readonly id: string;
  readonly createdAt: string;
  readonly name: string;
  readonly screenName: string;
  readonly profileImageUrl: string;
  readonly profileBannerUrl: string | null;
  readonly url: string | null;
  readonly location: string;
  readonly description: string;
  readonly descriptionUrls: unknown[];
  readonly urls: unknown[] | null;
  readonly pinnedTweetIds: string[];
  readonly isBlueVerified: boolean;
  readonly verified: boolean;
  readonly possiblySensitive: boolean;
  readonly defaultProfile: boolean;
  readonly defaultProfileImage: boolean;
  readonly hasCustomTimelines: boolean;
  readonly followersCount: number;
  readonly fastFollowersCount: number;
  readonly normalFollowersCount: number;
  readonly followingCount: number;
  readonly favouritesCount: number;
  readonly listedCount: number;
  readonly mediaCount: number;
  readonly statusesCount: number;
  readonly isTranslator: boolean;
  readonly translatorType: string;
  readonly withheldInCountries: string[];
  readonly protected: boolean;

  constructor(
    private readonly client: GuestClient,
    data: Record<string, any>
  ) {
    const legacy = data.legacy ?? {};

    this.id = data.rest_id;
    this.createdAt = legacy.created_at;
    this.name = legacy.name;
    this.screenName = legacy.screen_name;
    this.profileImageUrl = legacy.profile_image_url_https;
    this.profileBannerUrl = legacy.profile_banner_url ?? null;
    this.url = legacy.url ?? null;
    this.location = legacy.location;
    this.description = legacy.description;
    this.descriptionUrls = legacy.entities?.description?.urls ?? [];
    this.urls = legacy.entities?.url?.urls ?? null;
    this.pinnedTweetIds = legacy.pinned_tweet_ids_str;
    this.isBlueVerified = data.is_blue_verified;
    this.verified = legacy.verified;
    this.possiblySensitive = legacy.possibly_sensitive;
    this.defaultProfile = legacy.default_profile;
    this.defaultProfileImage = legacy.default_profile_image;
    this.hasCustomTimelines = legacy.has_custom_timelines;
    this.followersCount = legacy.followers_count;
    this.fastFollowersCount = legacy.fast_followers_count;
    this.normalFollowersCount = legacy.normal_followers_count;
    this.followingCount = legacy.friends_count;
    this.favouritesCount = legacy.favourites_count;
    this.listedCount = legacy.listed_count;
    this.mediaCount = legacy.media_count;
    this.statusesCount = legacy.statuses_count;
    this.isTranslator = legacy.is_translator;
    this.translatorType = legacy.translator_type;
    this.withheldInCountries = legacy.withheld_in_countries;
    this.protected = legacy.protected ?? false;
  }

  get createdAtDate(): Date {
    return timestampToDate(this.createdAt);
  }

  async getTweets(tweetType: 'Tweets' = 'Tweets', count = 40): Promise<GuestTweet[]> {
    return this.client.getUserTweets(this.id, tweetType, count);
  }

  async getHighlightsTweets(count = 20, cursor?: string): Promise<Result<GuestTweet>> {
    return this.client.getUserHighlightsTweets(this.id, count, cursor ?? null);
  }

  /** Re-fetches this user and returns the fresh instance. */
  async update(): Promise<GuestUser> {
    return this.client.getUserById(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof GuestUser && this.id === other.id;
  }

  toString(): string {
    return `<User id="${this.id}">`;
  }
}
