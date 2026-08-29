import { describe, expect, it } from 'vitest';
import { GuestTweet } from '../src/guest/tweet.js';
import type { GuestClient } from '../src/guest/client.js';
import { Tweet, tweetFromData } from '../src/models/tweet.js';
import type { Client } from '../src/client/client.js';

const client = {} as Client;
const guestClient = {} as GuestClient;

const baseTweet = (overrides: Record<string, any> = {}) => ({
  rest_id: '123',
  edit_control: {},
  views: { count: '10', state: 'EnabledWithCount' },
  legacy: {
    created_at: 'Wed Oct 10 20:19:24 +0000 2018',
    full_text: 'hello world',
    lang: 'en',
    is_quote_status: false,
    favorite_count: 3,
    reply_count: 1,
    retweet_count: 2,
    entities: { hashtags: [{ text: 'tag' }], urls: [{ url: 'https://t.co/x' }] },
  },
  ...overrides,
});

describe('Tweet', () => {
  it('exposes the core fields', () => {
    const tweet = new Tweet(client, baseTweet());
    expect(tweet.id).toBe('123');
    expect(tweet.text).toBe('hello world');
    expect(tweet.favoriteCount).toBe(3);
    expect(tweet.viewCount).toBe('10');
    expect(tweet.hashtags).toEqual(['tag']);
    expect(tweet.createdAtDate.getUTCFullYear()).toBe(2018);
  });

  it('prefers note-tweet text for long-form tweets', () => {
    const tweet = new Tweet(
      client,
      baseTweet({
        note_tweet: {
          note_tweet_results: {
            result: { text: 'the long version', entity_set: { hashtags: [{ text: 'long' }] } },
          },
        },
      })
    );
    expect(tweet.fullText).toBe('the long version');
    expect(tweet.hashtags).toEqual(['long']);
  });

  it('returns null for an unavailable quote rather than throwing', () => {
    const tweet = new Tweet(client, baseTweet({ quoted_status_result: {} }));
    expect(tweet.quote).toBeNull();
  });

  it('reads poll cards', () => {
    const tweet = new Tweet(
      client,
      baseTweet({
        card: {
          rest_id: 'card:1',
          legacy: {
            name: 'poll2choice_text_only',
            binding_values: [
              { key: 'choice1_label', value: { string_value: 'Red' } },
              { key: 'choice1_count', value: { string_value: '5' } },
              { key: 'choice2_label', value: { string_value: 'Blue' } },
              { key: 'duration_minutes', value: { string_value: '60' } },
              { key: 'end_datetime_utc', value: { string_value: '2024-01-01T00:00:00Z' } },
              { key: 'last_updated_datetime_utc', value: { string_value: '2024-01-01T00:00:00Z' } },
              { key: 'counts_are_final', value: { boolean_value: false } },
            ],
          },
        },
      })
    );

    const poll = tweet.poll;
    expect(poll).not.toBeNull();
    expect(poll!.choices).toEqual([
      { number: '1', label: 'Red', count: '5' },
      { number: '2', label: 'Blue', count: '0' },
    ]);
    expect(poll!.durationMinutes).toBe(60);
  });
});

describe('tweetFromData', () => {
  const wrap = (tweetData: Record<string, any>) => ({
    content: { itemContent: { tweet_results: { result: tweetData } } },
  });

  it('builds a Tweet with its author', () => {
    const tweet = tweetFromData(
      client,
      wrap({
        ...baseTweet(),
        core: { user_results: { result: { rest_id: '9', legacy: { screen_name: 'alice' } } } },
      })
    );
    expect(tweet?.id).toBe('123');
    expect(tweet?.user?.screenName).toBe('alice');
  });

  it('returns null for a tombstone', () => {
    expect(tweetFromData(client, wrap({ __typename: 'TweetTombstone' }))).toBeNull();
  });

  it('returns null when there is no author', () => {
    expect(tweetFromData(client, wrap({ ...baseTweet(), core: {} }))).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(tweetFromData(client, {})).toBeNull();
  });
});

describe('GuestTweet', () => {
  it('resolves fields eagerly', () => {
    const tweet = new GuestTweet(guestClient, baseTweet());
    expect(tweet.id).toBe('123');
    expect(tweet.text).toBe('hello world');
    expect(tweet.hashtags).toEqual(['tag']);
  });

  // Regression: x.com returns `quoted_status_result: {}` for deleted quotes,
  // which crashed both this port and the Python original.
  it('survives an empty quoted_status_result', () => {
    const tweet = new GuestTweet(guestClient, baseTweet({ quoted_status_result: {} }));
    expect(tweet.quote).toBeNull();
  });

  it('survives a quote whose result has no author', () => {
    const tweet = new GuestTweet(
      guestClient,
      baseTweet({ quoted_status_result: { result: { legacy: {} } } })
    );
    expect(tweet.quote).toBeNull();
  });

  it('survives an empty retweeted_status_result', () => {
    const data = baseTweet();
    data.legacy.retweeted_status_result = {};
    const tweet = new GuestTweet(guestClient, data);
    expect(tweet.retweetedTweet).toBeNull();
  });

  it('builds a nested quote when the payload is complete', () => {
    const tweet = new GuestTweet(
      guestClient,
      baseTweet({
        quoted_status_result: {
          result: {
            ...baseTweet({ rest_id: '456' }),
            core: { user_results: { result: { rest_id: '7', legacy: { screen_name: 'bob' } } } },
          },
        },
      })
    );
    expect(tweet.quote?.id).toBe('456');
    expect(tweet.quote?.user?.screenName).toBe('bob');
  });
});
