/**
 * Minimal WebVTT parser.
 *
 * Replaces the Python library's `webvtt-py` dependency. Exposes the same three
 * fields the upstream examples read off each caption: `start`, `end`, `text`.
 */

export interface Caption {
  /** Start timestamp, as written in the file (e.g. `00:00:01.000`). */
  start: string;
  /** End timestamp, as written in the file. */
  end: string;
  /** Caption text, with multi-line captions joined by newlines. */
  text: string;
  /** Start time in seconds. */
  startInSeconds: number;
  /** End time in seconds. */
  endInSeconds: number;
  /** The optional cue identifier preceding the timing line. */
  identifier: string | null;
}

export interface WebVTT {
  captions: Caption[];
  [Symbol.iterator](): Iterator<Caption>;
}

const TIMING_LINE = /^(\S+)\s+-->\s+(\S+)/;

export function parseWebVTT(content: string): WebVTT {
  const captions: Caption[] = [];
  const lines = content.split(/\r?\n/);

  let index = 0;
  // Skip the "WEBVTT" signature line and any header metadata.
  while (index < lines.length && lines[index].trim() !== '') index += 1;

  let identifier: string | null = null;

  for (; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === '') {
      identifier = null;
      continue;
    }
    if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      continue;
    }

    const match = TIMING_LINE.exec(line);
    if (!match) {
      // A line before a timing line is the cue identifier.
      identifier = line;
      continue;
    }

    const textLines: string[] = [];
    index += 1;
    for (; index < lines.length && lines[index].trim() !== ''; index += 1) {
      textLines.push(lines[index].trim());
    }

    captions.push({
      start: match[1],
      end: match[2],
      text: textLines.join('\n'),
      startInSeconds: timestampToSeconds(match[1]),
      endInSeconds: timestampToSeconds(match[2]),
      identifier,
    });
    identifier = null;
  }

  return {
    captions,
    [Symbol.iterator]() {
      return captions[Symbol.iterator]();
    },
  };
}

function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map((part) => Number.parseFloat(part.replace(',', '.')));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}
