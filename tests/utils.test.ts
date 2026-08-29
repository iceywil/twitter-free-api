import { describe, expect, it } from 'vitest';
import { Result, buildQuery, findDict, getQueryId, buildTweetData } from '../src/utils.js';

describe('buildQuery', () => {
  it('appends every operator in the documented order', () => {
    const query = buildQuery('base', {
      exactPhrases: ['a b', 'c'],
      orKeywords: ['x', 'y'],
      excludeKeywords: ['no'],
      hashtags: ['tag'],
      fromUser: 'alice',
      toUser: 'bob',
      mentionedUsers: ['carol'],
      filters: ['media'],
      excludeFilters: ['retweets'],
      urls: ['example.com'],
      since: '2024-01-01',
      until: '2024-02-01',
      positive: true,
      negative: true,
      question: true,
    });

    expect(query).toBe(
      'base "a b" "c" x OR y -"no" #tag from:alice to:bob @carol ' +
        'filter:media -filter:retweets url:example.com ' +
        'since:2024-01-01 until:2024-02-01 :) :( ?'
    );
  });

  it('returns the text unchanged with no options', () => {
    expect(buildQuery('hello')).toBe('hello');
  });

  it('omits empty arrays', () => {
    expect(buildQuery('hello', { hashtags: [], orKeywords: [] })).toBe('hello');
  });
});

describe('findDict', () => {
  const data = {
    a: { target: 1 },
    b: [{ target: 2 }, { c: { target: 3 } }],
  };

  it('collects every match in a nested structure', () => {
    expect(findDict(data, 'target')).toEqual([1, 2, 3]);
  });

  it('stops at the first match when findOne is set', () => {
    expect(findDict(data, 'target', true)).toEqual([1]);
  });

  it('returns an empty array when the key is absent', () => {
    expect(findDict(data, 'missing')).toEqual([]);
  });

  it('handles null and primitive values without throwing', () => {
    expect(findDict({ a: null, b: 3, c: 'str' }, 'target')).toEqual([]);
  });
});

describe('getQueryId', () => {
  it('extracts the query id from a GraphQL URL', () => {
    expect(getQueryId('https://x.com/i/api/graphql/queryid/SearchTimeline')).toBe('queryid');
  });
});

describe('Result', () => {
  it('behaves like an array', () => {
    const result = new Result([1, 2, 3]);
    expect(result.length).toBe(3);
    expect(result[0]).toBe(1);
    expect([...result]).toEqual([1, 2, 3]);
    expect(result.map((n) => n * 2)).toEqual([2, 4, 6]);
  });

  it('exposes cursor aliases', () => {
    const result = new Result([1], null, 'next-cursor');
    expect(result.nextCursor).toBe('next-cursor');
    expect(result.token).toBe('next-cursor');
    expect(result.cursor).toBe('next-cursor');
  });

  it('returns an empty Result when there is no next page', async () => {
    const result = new Result([1]);
    expect((await result.next()).length).toBe(0);
    expect((await result.previous()).length).toBe(0);
  });

  it('calls the fetcher for the next page', async () => {
    const result = new Result([1], async () => new Result([2]), 'cursor');
    expect([...(await result.next())]).toEqual([2]);
  });

  it('map/filter return plain arrays, not half-built Results', () => {
    const result = new Result([1, 2, 3]);
    expect(result.filter((n) => n > 1)).toBeInstanceOf(Array);
    expect(result.filter((n) => n > 1)).not.toBeInstanceOf(Result);
  });
});

describe('buildTweetData', () => {
  it('lifts flat v1.1 fields into the legacy shape the models expect', () => {
    const built = buildTweetData({ id: '123', text: 'hello', favorite_count: 5 });
    expect(built.rest_id).toBe('123');
    expect(built.legacy.full_text).toBe('hello');
    expect(built.legacy.favorite_count).toBe(5);
  });

  it('prefers full_text over text when both are present', () => {
    const built = buildTweetData({ id: '1', text: 'short', full_text: 'long' });
    expect(built.legacy.full_text).toBe('long');
  });
});
