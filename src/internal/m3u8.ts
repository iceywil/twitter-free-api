/**
 * Minimal HLS playlist parser.
 *
 * The Python library depends on `m3u8`; only the `#EXT-X-MEDIA` tags and the
 * segment URIs are ever read, so this covers exactly that.
 */

export interface M3U8Media {
  type: string | null;
  uri: string | null;
  groupId: string | null;
  name: string | null;
  language: string | null;
  attributes: Record<string, string>;
}

export interface M3U8Segment {
  uri: string;
  duration: number | null;
}

export interface M3U8Playlist {
  media: M3U8Media[];
  segments: M3U8Segment[];
}

export function parseM3U8(content: string): M3U8Playlist {
  const media: M3U8Media[] = [];
  const segments: M3U8Segment[] = [];
  const lines = content.split(/\r?\n/);

  let pendingDuration: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attributes = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      media.push({
        type: attributes.TYPE ?? null,
        uri: attributes.URI ?? null,
        groupId: attributes['GROUP-ID'] ?? null,
        name: attributes.NAME ?? null,
        language: attributes.LANGUAGE ?? null,
        attributes,
      });
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const value = Number.parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
      pendingDuration = Number.isNaN(value) ? null : value;
      continue;
    }

    if (line.startsWith('#')) continue;

    segments.push({ uri: line, duration: pendingDuration });
    pendingDuration = null;
  }

  return { media, segments };
}

/** Splits an attribute list, honouring quoted values that may contain commas. */
function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let key = '';
  let value = '';
  let inKey = true;
  let inQuotes = false;

  const commit = () => {
    if (key.trim() !== '') attributes[key.trim()] = value;
    key = '';
    value = '';
    inKey = true;
  };

  for (const char of input) {
    if (inKey) {
      if (char === '=') {
        inKey = false;
      } else {
        key += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      commit();
      continue;
    }
    value += char;
  }
  commit();

  return attributes;
}
