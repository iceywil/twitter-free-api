import { describe, expect, it } from 'vitest';
import { parseM3U8 } from '../src/internal/m3u8.js';
import { parseWebVTT } from '../src/internal/webvtt.js';
import { detectMediaType } from '../src/internal/mediaType.js';
import { solveUiMetrics } from '../src/uiMetrics/index.js';

describe('parseM3U8', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="/subs/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360',
    '/video/360x640/playlist.m3u8',
    '#EXTINF:3.000,',
    '/segment1.ts',
    '',
  ].join('\n');

  it('parses EXT-X-MEDIA tags', () => {
    const { media } = parseM3U8(playlist);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe('SUBTITLES');
    expect(media[0].uri).toBe('/subs/en.m3u8');
    expect(media[0].language).toBe('en');
    expect(media[0].name).toBe('English');
  });

  it('parses segment URIs and durations, skipping comments', () => {
    const { segments } = parseM3U8(playlist);
    expect(segments.map((s) => s.uri)).toEqual([
      '/video/360x640/playlist.m3u8',
      '/segment1.ts',
    ]);
    expect(segments[1].duration).toBe(3);
  });

  it('keeps commas inside quoted attribute values', () => {
    const { media } = parseM3U8(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English, US",URI="/a.m3u8"'
    );
    expect(media[0].name).toBe('English, US');
    expect(media[0].uri).toBe('/a.m3u8');
  });

  it('returns empty collections for an empty playlist', () => {
    expect(parseM3U8('')).toEqual({ media: [], segments: [] });
  });
});

describe('parseWebVTT', () => {
  const vtt = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:04.000',
    'Hello there',
    '',
    '2',
    '00:01:05.500 --> 00:01:08.000',
    'Second line',
    'continues here',
    '',
  ].join('\n');

  it('parses captions with timings and text', () => {
    const { captions } = parseWebVTT(vtt);
    expect(captions).toHaveLength(2);
    expect(captions[0].start).toBe('00:00:01.000');
    expect(captions[0].end).toBe('00:00:04.000');
    expect(captions[0].text).toBe('Hello there');
    expect(captions[0].identifier).toBe('1');
  });

  it('joins multi-line caption text', () => {
    const { captions } = parseWebVTT(vtt);
    expect(captions[1].text).toBe('Second line\ncontinues here');
  });

  it('converts timestamps to seconds', () => {
    const { captions } = parseWebVTT(vtt);
    expect(captions[0].startInSeconds).toBe(1);
    expect(captions[1].startInSeconds).toBeCloseTo(65.5, 5);
  });

  it('is iterable, like webvtt-py', () => {
    expect([...parseWebVTT(vtt)]).toHaveLength(2);
  });

  it('returns no captions for a header-only file', () => {
    expect(parseWebVTT('WEBVTT\n\n').captions).toEqual([]);
  });
});

describe('detectMediaType', () => {
  const pad = (bytes: number[]): Buffer =>
    Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

  it('detects JPEG', () => {
    expect(detectMediaType(pad([0xff, 0xd8, 0xff]))?.mime).toBe('image/jpeg');
  });

  it('detects PNG', () => {
    expect(
      detectMediaType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime
    ).toBe('image/png');
  });

  it('detects GIF', () => {
    expect(detectMediaType(pad([...Buffer.from('GIF89a')]))?.mime).toBe('image/gif');
  });

  it('detects WEBP via the RIFF container', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.alloc(8),
    ]);
    expect(detectMediaType(buffer)?.mime).toBe('image/webp');
  });

  it('detects MP4 via the ftyp box', () => {
    const buffer = Buffer.concat([
      Buffer.alloc(4),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    expect(detectMediaType(buffer)?.mime).toBe('video/mp4');
  });

  it('detects QuickTime', () => {
    const buffer = Buffer.concat([
      Buffer.alloc(4),
      Buffer.from('ftypqt  '),
      Buffer.alloc(8),
    ]);
    expect(detectMediaType(buffer)?.mime).toBe('video/quicktime');
  });

  it('returns null for unknown and truncated input', () => {
    expect(detectMediaType(pad([0x00, 0x01, 0x02]))).toBeNull();
    expect(detectMediaType(Buffer.from([0xff]))).toBeNull();
  });
});

describe('solveUiMetrics', () => {
  it('runs the served function against the fake DOM', () => {
    const script = `
      var x = 1;
      function abc() { var e = document.createElement('div'); document.getElementsByTagName('body')[0].appendChild(e); return {rf: {a: 1}, s: "token"}; }
    `;
    expect(solveUiMetrics(script)).toBe('{"rf": {"a": 1}, "s": "token"}');
  });

  it('serializes nested arrays with Python-style spacing', () => {
    const script = `function abc() { return {a: [1, 2], b: "x"}; }`;
    expect(solveUiMetrics(script)).toBe('{"a": [1, 2], "b": "x"}');
  });

  it('throws when the expected function is absent', () => {
    expect(() => solveUiMetrics('var x = 1;')).toThrow(/No function pattern found/);
  });
});
