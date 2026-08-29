/** Ported from twikit/trend.py */

import type { Client } from '../client/client.js';

export class Trend {
  /** The name of the trending topic. */
  readonly name: string;
  /** The count of tweets associated with the trend. */
  readonly tweetsCount: string | null;
  /** The context or domain associated with the trend. */
  readonly domainContext: string | null;
  /** Trend names grouped under the main trend. */
  readonly groupedTrends: string[];

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    const metadata = data.trendMetadata ?? {};
    this.name = data.name;
    this.tweetsCount = metadata.metaDescription ?? null;
    this.domainContext = metadata.domainContext ?? null;
    this.groupedTrends = (data.groupedTrends ?? []).map(
      (trend: Record<string, any>) => trend.name
    );
  }

  toString(): string {
    return `<Trend name="${this.name}">`;
  }
}

export interface PlaceTrends {
  trends: PlaceTrend[];
  as_of: string;
  created_at: string;
  locations: Record<string, unknown>[];
}

export class PlaceTrend {
  /** The name of the trend. */
  readonly name: string;
  /** The URL to view the trend. */
  readonly url: string;
  readonly promotedContent: null;
  /** The search query corresponding to the trend. */
  readonly query: string;
  /** The volume of tweets associated with the trend. */
  readonly tweetVolume: number;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.name = data.name;
    this.url = data.url;
    this.promotedContent = data.promoted_content;
    this.query = data.query;
    this.tweetVolume = data.tweet_volume;
  }

  toString(): string {
    return `<PlaceTrend name="${this.name}">`;
  }
}

export class Location {
  readonly woeid: number;
  readonly country: string;
  readonly countryCode: string;
  readonly name: string;
  readonly parentid: number;
  readonly placeType: Record<string, unknown>;
  readonly url: string;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.woeid = data.woeid;
    this.country = data.country;
    this.countryCode = data.countryCode;
    this.name = data.name;
    this.parentid = data.parentid;
    this.placeType = data.placeType;
    this.url = data.url;
  }

  async getTrends(): Promise<PlaceTrends> {
    return this.client.getPlaceTrends(this.woeid);
  }

  equals(other: unknown): boolean {
    return other instanceof Location && this.woeid === other.woeid;
  }

  toString(): string {
    return `<Location name="${this.name}" woeid=${this.woeid}>`;
  }
}
