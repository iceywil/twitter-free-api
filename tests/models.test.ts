import { describe, expect, it } from 'vitest';
import { GuestTweet } from '../src/guest/tweet.js';
import type { GuestClient } from '../src/guest/client.js';
import { Tweet, tweetFromData } from '../src/models/tweet.js';
import { User } from '../src/models/user.js';
import { buildTweetData, buildUserData } from '../src/utils.js';
import { Trend, collectTimelineTrends } from '../src/models/trend.js';
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

describe('User schema compatibility', () => {
  // x.com serves two user shapes concurrently: UserByScreenName returns a
  // `legacy` blob, Viewer returns per-concern objects. Both must map.
  const legacyPayload = {
    rest_id: '12',
    is_blue_verified: true,
    legacy: {
      created_at: 'Tue Mar 21 20:50:14 +0000 2006',
      name: 'jack',
      screen_name: 'jack',
      profile_image_url_https: 'https://example.com/a.jpg',
      profile_banner_url: 'https://example.com/b.jpg',
      location: 'earth',
      description: 'bio',
      entities: { description: { urls: [{ url: 'https://t.co/x' }] } },
      pinned_tweet_ids_str: ['1'],
      verified: false,
      followers_count: 100,
      friends_count: 5,
      favourites_count: 7,
      media_count: 2,
      statuses_count: 9,
      can_dm: true,
      can_media_tag: false,
      protected: true,
    },
  };

  const newPayload = {
    rest_id: '2092621837301596161',
    is_blue_verified: false,
    core: { created_at: 'Wed Aug 26 14:35:39 +0000 2026', name: 'bozo', screen_name: 'bozo1of1' },
    avatar: { image_url: 'https://example.com/new-a.jpg' },
    banner: { image_url: 'https://example.com/new-b.jpg' },
    profile_bio: { description: 'new bio', entities: { description: { urls: [] } } },
    relationship_counts: { followers: 3, following: 41 },
    action_counts: { favorites_count: 4 },
    tweet_counts: { tweets: 11, media_tweets: 6 },
    location: { location: 'somewhere' },
    verification: { verified: true },
    privacy: { protected: false },
    website: { url: 'https://example.com' },
    dm_permissions: { can_dm: false },
    media_permissions: { can_media_tag: true },
  };

  it('maps the legacy shape', () => {
    const user = new User(client, legacyPayload);
    expect(user.screenName).toBe('jack');
    expect(user.followersCount).toBe(100);
    expect(user.followingCount).toBe(5);
    expect(user.favouritesCount).toBe(7);
    expect(user.statusesCount).toBe(9);
    expect(user.mediaCount).toBe(2);
    expect(user.description).toBe('bio');
    expect(user.location).toBe('earth');
    expect(user.protected).toBe(true);
    expect(user.canDm).toBe(true);
    expect(user.descriptionUrls).toHaveLength(1);
  });

  it('maps the new per-concern shape', () => {
    const user = new User(client, newPayload);
    expect(user.id).toBe('2092621837301596161');
    expect(user.screenName).toBe('bozo1of1');
    expect(user.name).toBe('bozo');
    expect(user.createdAtDate.getUTCFullYear()).toBe(2026);
    expect(user.profileImageUrl).toBe('https://example.com/new-a.jpg');
    expect(user.profileBannerUrl).toBe('https://example.com/new-b.jpg');
    expect(user.url).toBe('https://example.com');
    expect(user.description).toBe('new bio');
    expect(user.location).toBe('somewhere');
    expect(user.followersCount).toBe(3);
    expect(user.followingCount).toBe(41);
    expect(user.favouritesCount).toBe(4);
    expect(user.statusesCount).toBe(11);
    expect(user.mediaCount).toBe(6);
    expect(user.verified).toBe(true);
    expect(user.protected).toBe(false);
    expect(user.canDm).toBe(false);
    expect(user.canMediaTag).toBe(true);
  });

  it('prefers legacy when both shapes are present', () => {
    const user = new User(client, { ...newPayload, ...legacyPayload });
    expect(user.screenName).toBe('jack');
    expect(user.followersCount).toBe(100);
  });

  it('does not throw on a sparse payload', () => {
    const user = new User(client, { rest_id: '1' });
    expect(user.id).toBe('1');
    expect(user.protected).toBe(false);
    expect(user.pinnedTweetIds).toEqual([]);
    expect(user.descriptionUrls).toEqual([]);
  });
});

describe('adaptive search payload handling', () => {
  // The legacy 2/search/adaptive.json route returns v1.1-shaped globalObjects
  // instead of a GraphQL timeline. Verify the rebuild helpers cover that shape.
  const adaptive = {
    globalObjects: {
      tweets: {
        '111': {
          id: '111',
          user_id_str: '9',
          full_text: 'first result',
          favorite_count: 2,
          entities: { hashtags: [] },
        },
        '222': {
          id: '222',
          user_id_str: '9',
          text: 'second result',
          entities: { hashtags: [] },
        },
      },
      users: { '9': { id: '9', screen_name: 'alice', name: 'Alice', followers_count: 3 } },
    },
    timeline: {
      instructions: [
        {
          addEntries: {
            entries: [
              { entryId: 'sq-I-t-111', content: { item: { content: { tweet: { id: '111' } } } } },
              { entryId: 'sq-I-t-222', content: { item: { content: { tweet: { id: '222' } } } } },
              {
                entryId: 'sq-cursor-bottom',
                content: { operation: { cursor: { value: 'NEXT', cursorType: 'Bottom' } } },
              },
              {
                entryId: 'sq-cursor-top',
                content: { operation: { cursor: { value: 'PREV', cursorType: 'Top' } } },
              },
            ],
          },
        },
      ],
    },
  };

  it('rebuilds tweets from the v1.1 globalObjects shape', () => {
    const data = adaptive.globalObjects.tweets['111'];
    const built = buildTweetData(data);
    const user = new User(client, buildUserData(adaptive.globalObjects.users['9']));
    const tweet = new Tweet(client, built, user);

    expect(tweet.id).toBe('111');
    expect(tweet.text).toBe('first result');
    expect(tweet.favoriteCount).toBe(2);
    expect(tweet.user?.screenName).toBe('alice');
  });

  it('falls back to `text` when `full_text` is absent', () => {
    const tweet = new Tweet(client, buildTweetData(adaptive.globalObjects.tweets['222']));
    expect(tweet.text).toBe('second result');
  });

  it('exposes both cursors from the entry list', () => {
    const entries = adaptive.timeline.instructions.flatMap((i: any) => i.addEntries.entries);
    const cursors = entries
      .map((e: any) => e.content?.operation?.cursor)
      .filter(Boolean) as { value: string; cursorType: string }[];
    expect(cursors.find((c) => c.cursorType === 'Bottom')?.value).toBe('NEXT');
    expect(cursors.find((c) => c.cursorType === 'Top')?.value).toBe('PREV');
  });

  it('preserves entry ordering', () => {
    const entries = adaptive.timeline.instructions.flatMap((i: any) => i.addEntries.entries);
    const ids = entries
      .map((e: any) => e.content?.item?.content?.tweet?.id)
      .filter(Boolean);
    expect(ids).toEqual(['111', '222']);
  });
});

describe('Trend payload shapes', () => {
  // guide.json returns camelCase; the GraphQL Explore endpoints return a
  // snake_case TimelineTrend. Both must map.
  it('maps the v1.1 guide.json shape', () => {
    const trend = new Trend(client, {
      name: 'Example',
      trendMetadata: { metaDescription: '12.3K posts', domainContext: 'Trending in Tech' },
      groupedTrends: [{ name: 'sub1' }, { name: 'sub2' }],
    });
    expect(trend.name).toBe('Example');
    expect(trend.tweetsCount).toBe('12.3K posts');
    expect(trend.domainContext).toBe('Trending in Tech');
    expect(trend.groupedTrends).toEqual(['sub1', 'sub2']);
  });

  it('maps the GraphQL TimelineTrend shape', () => {
    const trend = new Trend(client, {
      __typename: 'TimelineTrend',
      name: 'Népal',
      trend_metadata: { domain_context: 'Technology · Trending' },
    });
    expect(trend.name).toBe('Népal');
    expect(trend.domainContext).toBe('Technology · Trending');
    expect(trend.tweetsCount).toBeNull();
    expect(trend.groupedTrends).toEqual([]);
  });
});

describe('collectTimelineTrends', () => {
  const nested = {
    data: {
      explore_sidebar: {
        timeline: {
          instructions: [
            { type: 'TimelineClearCache' },
            {
              entries: [
                {
                  content: {
                    items: [
                      { item: { itemContent: { __typename: 'TimelineTrend', name: 'A', trend_metadata: {} } } },
                      { item: { itemContent: { __typename: 'TimelineTrend', name: 'B', trend_metadata: {} } } },
                      { item: { itemContent: { __typename: 'TimelineUser', name: 'not a trend' } } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };

  it('finds trends at any depth and ignores other item types', () => {
    const found = collectTimelineTrends(nested);
    expect(found.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('de-duplicates by name', () => {
    const dup = { a: nested, b: nested };
    expect(collectTimelineTrends(dup).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('returns an empty array when there are none', () => {
    expect(collectTimelineTrends({ data: {} })).toEqual([]);
    expect(collectTimelineTrends(null)).toEqual([]);
  });
});

describe('cursor value extraction (Client.cursorValue)', () => {
  // Reply cursors and thread cursors nest their value differently. Both must
  // be read without throwing (regression: getTweetById crashed on
  // cursor-showmorethreads, whose value is at content.value not
  // content.itemContent.value).
  const cursorValue = (entry: any): string | null =>
    entry?.content?.itemContent?.value ?? entry?.content?.value ?? null;

  it('reads a reply cursor at content.itemContent.value', () => {
    expect(cursorValue({ entryId: 'cursor-bottom-1', content: { itemContent: { value: 'A' } } })).toBe('A');
  });

  it('reads a thread cursor at content.value', () => {
    expect(cursorValue({ entryId: 'cursor-showmorethreads-1', content: { __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'B' } })).toBe('B');
  });

  it('returns null when neither shape is present', () => {
    expect(cursorValue({ entryId: 'cursor-x', content: {} })).toBeNull();
    expect(cursorValue({})).toBeNull();
  });
});
