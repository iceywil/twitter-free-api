
import type { Client } from '../client/client.js';

export interface ConfigEvent {
  /** The session ID associated with the configuration. */
  sessionId: string;
  /** The time to live for the subscription. */
  subscriptionTtlMillis: number;
  /** The heartbeat interval in milliseconds. */
  heartbeatMillis: number;
}

export interface SubscriptionsEvent {
  errors: unknown[];
}

export interface TweetEngagementEvent {
  likeCount: string | null;
  retweetCount: string | null;
  viewCount: string | null;
  viewCountState: string | null;
  quoteCount: number | null;
  replyCount: number | null;
}

export interface DMUpdateEvent {
  /** The ID of the conversation associated with the DM. */
  conversationId: string;
  /** ID of the user who sent the DM. */
  userId: string;
}

export interface DMTypingEvent {
  /** The conversation where the typing indication occurred. */
  conversationId: string;
  /** The ID of the typing user. */
  userId: string;
}

export type StreamEventType =
  | ConfigEvent
  | SubscriptionsEvent
  | TweetEngagementEvent
  | DMUpdateEvent
  | DMTypingEvent;

/** A payload containing one or more event types. */
export interface Payload {
  config?: ConfigEvent;
  subscriptions?: SubscriptionsEvent;
  tweetEngagement?: TweetEngagementEvent;
  dmUpdate?: DMUpdateEvent;
  dmTyping?: DMTypingEvent;
}

/** A `[topic, payload]` pair as yielded by the stream. */
export type StreamEvent = [string, Payload];

export function eventFromData(name: string, data: Record<string, any>): StreamEventType | null {
  if (name === 'config') {
    return {
      sessionId: data.session_id,
      subscriptionTtlMillis: data.subscription_ttl_millis,
      heartbeatMillis: data.heartbeat_millis,
    };
  }

  if (name === 'subscriptions') {
    return { errors: data.errors };
  }

  if (name === 'tweet_engagement') {
    let viewCount: string | null = null;
    let viewCountState: string | null = null;
    if (data.view_count_info) {
      viewCount = data.view_count_info.count;
      viewCountState = data.view_count_info.state;
    }
    return {
      likeCount: data.like_count ?? null,
      retweetCount: data.retweet_count ?? null,
      viewCount,
      viewCountState,
      quoteCount: data.quote_count ?? null,
      replyCount: data.reply_count ?? null,
    };
  }

  if (name === 'dm_update' || name === 'dm_typing') {
    return { conversationId: data.conversation_id, userId: data.user_id };
  }

  return null;
}

const PAYLOAD_KEY_MAPPING: Record<string, keyof Payload> = {
  config: 'config',
  subscriptions: 'subscriptions',
  tweet_engagement: 'tweetEngagement',
  dm_update: 'dmUpdate',
  dm_typing: 'dmTyping',
};

export function payloadFromData(data: Record<string, any>): Payload {
  const payload: Payload = {};
  for (const [name, eventData] of Object.entries(data)) {
    const key = PAYLOAD_KEY_MAPPING[name];
    const event = eventFromData(name, eventData as Record<string, any>);
    if (key !== undefined && event !== null) {
      (payload as Record<string, unknown>)[key] = event;
    }
  }
  return payload;
}

/**
 * Represents a streaming session.
 *
 * @see Client.getStreamingSession
 */
export class StreamingSession {
  constructor(
    private readonly client: Client,
    /** The ID of the session. */
    public id: string,
    private stream: AsyncGenerator<StreamEvent>,
    /** The topics being streamed. */
    readonly topics: Set<string>,
    readonly autoReconnect: boolean
  ) {}

  /** Reconnects the session and returns the new config event. */
  async reconnect(): Promise<StreamEvent> {
    const stream = this.client.stream(this.topics);
    const configEvent = await stream.next();
    if (configEvent.done) {
      throw new Error('Failed to reconnect the streaming session');
    }
    this.id = configEvent.value[1].config!.sessionId;
    this.stream = stream;
    return configEvent.value;
  }

  /**
   * Updates subscriptions for the session.
   *
   * @example
   * import { Topic } from 'free-twitter-api';
   * await session.updateSubscriptions(
   *   new Set([Topic.tweetEngagement('1749528513')]),
   *   new Set([Topic.dmUpdate('17544932482-174455537996')])
   * );
   *
   * @remarks `dm_update` and `dm_typing` topics cannot be added.
   */
  async updateSubscriptions(
    subscribe?: Set<string>,
    unsubscribe?: Set<string>
  ): Promise<Payload> {
    return this.client.updateSubscriptions(this, subscribe, unsubscribe);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
    for (;;) {
      for await (const event of this.stream) {
        yield event;
      }
      if (!this.autoReconnect) break;
      yield await this.reconnect();
    }
  }

  toString(): string {
    return `<StreamingSession id="${this.id}">`;
  }
}

/** Generates topic strings for streaming. */
export const Topic = {
  /** Topic string for tweet engagement events. */
  tweetEngagement(tweetId: string): string {
    return `/tweet_engagement/${tweetId}`;
  },
  /**
   * Topic string for direct message update events.
   *
   * @param conversationId Group ID (`00000000`) or `partnerId-yourId`.
   */
  dmUpdate(conversationId: string): string {
    return `/dm_update/${conversationId}`;
  },
  /**
   * Topic string for direct message typing events.
   *
   * @param conversationId Group ID (`00000000`) or `partnerId-yourId`.
   */
  dmTyping(conversationId: string): string {
    return `/dm_typing/${conversationId}`;
  },
} as const;
