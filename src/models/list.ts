
import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';
import type { Result } from '../utils.js';
import type { Tweet } from './tweet.js';
import type { User } from './user.js';

/** Represents a Twitter List. */
export class TwitterList {
  /** The unique identifier of the List. */
  readonly id: string;
  /** The timestamp when the List was created, in milliseconds. */
  readonly createdAt: number;
  /** Information about the default banner of the List. */
  readonly defaultBanner: Record<string, unknown>;
  /** The List's banner, falling back to the default banner when none is set. */
  readonly banner: Record<string, unknown>;
  /** The description of the List. */
  readonly description: string;
  /** Whether the authenticated user is following the List. */
  readonly following: boolean;
  /** Whether the authenticated user is a member of the List. */
  readonly isMember: boolean;
  /** The number of members in the List. */
  readonly memberCount: number;
  /** The mode of the List. */
  readonly mode: 'Private' | 'Public';
  /** Whether the authenticated user is muting the List. */
  readonly muting: boolean;
  /** The name of the List. */
  readonly name: string;
  /** Whether the List is pinned. */
  readonly pinning: boolean;
  /** The number of subscribers to the List. */
  readonly subscriberCount: number;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.id_str;
    this.createdAt = data.created_at;
    this.defaultBanner = data.default_banner_media?.media_info;
    this.banner = data.custom_banner_media
      ? data.custom_banner_media.media_info
      : this.defaultBanner;
    this.description = data.description;
    this.following = data.following;
    this.isMember = data.is_member;
    this.memberCount = data.member_count;
    this.mode = data.mode;
    this.muting = data.muting;
    this.name = data.name;
    this.pinning = data.pinning;
    this.subscriberCount = data.subscriber_count;
  }

  get createdAtDate(): Date {
    return new Date(this.createdAt);
  }

  /**
   * Edits the banner image of the list.
   *
   * @example
   * const mediaId = await client.uploadMedia('image.png');
   * await list.editBanner(mediaId);
   */
  async editBanner(mediaId: string): Promise<HttpResponse> {
    return this.client.editListBanner(this.id, mediaId);
  }

  /** Deletes the list banner. */
  async deleteBanner(): Promise<HttpResponse> {
    return this.client.deleteListBanner(this.id);
  }

  /**
   * Edits list information.
   *
   * @example
   * await list.edit({ name: 'new name', description: 'new description', isPrivate: true });
   */
  async edit(options: {
    name?: string;
    description?: string;
    isPrivate?: boolean;
  } = {}): Promise<TwitterList> {
    return this.client.editList(this.id, options);
  }

  /** Adds a member to the list. */
  async addMember(userId: string): Promise<TwitterList> {
    return this.client.addListMember(this.id, userId);
  }

  /** Removes a member from the list. */
  async removeMember(userId: string): Promise<TwitterList> {
    return this.client.removeListMember(this.id, userId);
  }

  /**
   * Retrieves tweets from the list.
   *
   * @example
   * const tweets = await list.getTweets();
   * const moreTweets = await tweets.next();
   */
  async getTweets(count = 20, cursor?: string): Promise<Result<Tweet>> {
    return this.client.getListTweets(this.id, count, cursor);
  }

  /** Retrieves members of the list. */
  async getMembers(count = 20, cursor?: string): Promise<Result<User>> {
    return this.client.getListMembers(this.id, count, cursor);
  }

  /** Retrieves subscribers of the list. */
  async getSubscribers(count = 20, cursor?: string): Promise<Result<User>> {
    return this.client.getListSubscribers(this.id, count, cursor);
  }

  /** Re-fetches this list and returns the fresh instance. */
  async update(): Promise<TwitterList> {
    return this.client.getList(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof TwitterList && this.id === other.id;
  }

  toString(): string {
    return `<List id="${this.id}">`;
  }
}

export { TwitterList as List };
