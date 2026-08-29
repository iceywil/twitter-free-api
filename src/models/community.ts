/** Ported from twikit/community.py */

import type { Client } from '../client/client.js';
import { b64ToStr, type Result } from '../utils.js';
import { Tweet } from './tweet.js';
import { User } from './user.js';

export interface CommunityCreator {
  id: string;
  screenName: string;
  verified: boolean;
}

export interface CommunityRule {
  id: string;
  name: string;
}

export class CommunityMember {
  readonly id: string;
  readonly name: string;
  readonly communityRole: string;
  readonly superFollowing: boolean;
  readonly superFollowEligible: boolean;
  readonly superFollowedBy: boolean;
  readonly smartBlocking: boolean;
  readonly isBlueVerified: boolean;
  readonly screenName: string;
  readonly followRequestSent: boolean;
  readonly protected: boolean;
  readonly following: boolean;
  readonly followedBy: boolean;
  readonly blocking: boolean;
  readonly profileImageUrlHttps: string;
  readonly verified: boolean;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.rest_id;
    this.name = data.name;
    this.communityRole = data.community_role;
    this.superFollowing = data.super_following;
    this.superFollowEligible = data.super_follow_eligible;
    this.superFollowedBy = data.super_followed_by;
    this.smartBlocking = data.smart_blocking;
    this.isBlueVerified = data.is_blue_verified;

    const legacy = data.legacy ?? {};
    this.screenName = legacy.screen_name;
    this.name = legacy.name ?? data.name;
    this.followRequestSent = legacy.follow_request_sent;
    this.protected = legacy.protected;
    this.following = legacy.following;
    this.followedBy = legacy.followed_by;
    this.blocking = legacy.blocking;
    this.profileImageUrlHttps = legacy.profile_image_url_https;
    this.verified = legacy.verified;
  }

  equals(other: unknown): boolean {
    return other instanceof CommunityMember && this.id === other.id;
  }

  toString(): string {
    return `<CommunityMember id="${this.id}">`;
  }
}

export class Community {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly isNsfw: boolean;
  readonly membersFacepileResults: string[];
  readonly banner: Record<string, unknown>;
  readonly isMember: boolean | null;
  readonly role: string | null;
  readonly description: string | null;
  readonly creator: User | CommunityCreator | null;
  readonly admin: User | null;
  readonly joinPolicy: string | null;
  readonly createdAt: number | null;
  readonly invitesPolicy: string | null;
  readonly isPinned: boolean | null;
  readonly rules: CommunityRule[] | null;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.rest_id;
    this.name = data.name;
    this.memberCount = data.member_count;
    this.isNsfw = data.is_nsfw;

    this.membersFacepileResults = (data.members_facepile_results ?? []).map(
      (item: Record<string, any>) => item.result?.legacy?.profile_image_url_https
    );
    this.banner = data.default_banner_media?.media_info;

    this.isMember = data.is_member ?? null;
    this.role = data.role ?? null;
    this.description = data.description ?? null;

    if (data.creator_results) {
      const creator = data.creator_results.result;
      if (creator.rest_id) {
        this.creator = new User(client, creator);
      } else {
        this.creator = {
          id: stripPrefix(b64ToStr(creator.id), 'User:'),
          screenName: creator.legacy?.screen_name,
          verified: creator.legacy?.verified,
        };
      }
    } else {
      this.creator = null;
    }

    this.admin = data.admin_results ? new User(client, data.admin_results.result) : null;

    this.joinPolicy = data.join_policy ?? null;
    this.createdAt = data.created_at ?? null;
    this.invitesPolicy = data.invites_policy ?? null;
    this.isPinned = data.is_pinned ?? null;

    this.rules = data.rules
      ? data.rules.map((rule: Record<string, any>) => ({ id: rule.rest_id, name: rule.name }))
      : null;
  }

  /** Retrieves tweets posted in the community. */
  async getTweets(
    tweetType: 'Top' | 'Latest' | 'Media',
    count = 40,
    cursor?: string
  ): Promise<Result<Tweet>> {
    return this.client.getCommunityTweets(this.id, tweetType, count, cursor);
  }

  async join(): Promise<Community> {
    return this.client.joinCommunity(this.id);
  }

  async leave(): Promise<Community> {
    return this.client.leaveCommunity(this.id);
  }

  async requestToJoin(answer?: string): Promise<Community> {
    return this.client.requestToJoinCommunity(this.id, answer);
  }

  async getMembers(count = 20, cursor?: string): Promise<Result<CommunityMember>> {
    return this.client.getCommunityMembers(this.id, count, cursor);
  }

  async getModerators(count = 20, cursor?: string): Promise<Result<CommunityMember>> {
    return this.client.getCommunityModerators(this.id, count, cursor);
  }

  async searchTweet(query: string, count = 20, cursor?: string): Promise<Result<Tweet>> {
    return this.client.searchCommunityTweet(this.id, query, count, cursor);
  }

  /** Re-fetches this community and returns the fresh instance. */
  async update(): Promise<Community> {
    return this.client.getCommunity(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof Community && this.id === other.id;
  }

  toString(): string {
    return `<Community id="${this.id}">`;
  }
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
