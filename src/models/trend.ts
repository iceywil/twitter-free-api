
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

  /**
   * Accepts both trend payloads x.com serves: the camelCase shape from v1.1
   * `guide.json` and the snake_case `TimelineTrend` shape from the GraphQL
   * Explore endpoints. The Explore shape carries no post count, so
   * `tweetsCount` is null there.
   */
  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    const metadata = data.trendMetadata ?? data.trend_metadata ?? {};
    this.name = data.name;
    this.tweetsCount = metadata.metaDescription ?? metadata.meta_description ?? null;
    this.domainContext = metadata.domainContext ?? metadata.domain_context ?? null;
    this.groupedTrends = (data.groupedTrends ?? data.grouped_trends ?? []).map(
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

/** Collects every `TimelineTrend` object in a GraphQL Explore response. */
export function collectTimelineTrends(data: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, any>;
    if (record.__typename === 'TimelineTrend' && typeof record.name === 'string') {
      if (!seen.has(record.name)) {
        seen.add(record.name);
        found.push(record);
      }
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(data);
  return found;
}
