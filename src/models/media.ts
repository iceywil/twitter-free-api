/** Ported from twikit/media.py */

import { writeFile } from 'node:fs/promises';
import type { Client } from '../client/client.js';
import { parseM3U8, type M3U8Playlist } from '../internal/m3u8.js';
import { parseWebVTT, type WebVTT } from '../internal/webvtt.js';

/** Base class representing a media object attached to a tweet. */
export class Media {
  constructor(
    protected readonly client: Client,
    protected readonly data: Record<string, any>
  ) {}

  /** The media ID. */
  get id(): string {
    return this.data.id_str;
  }

  /** The display URL. */
  get displayUrl(): string {
    return this.data.display_url;
  }

  /** The expanded display URL. */
  get expandedUrl(): string {
    return this.data.expanded_url;
  }

  /** The media URL. */
  get mediaUrl(): string {
    return this.data.media_url_https;
  }

  /** The source tweet ID. */
  get sourceStatusId(): string {
    return this.data.source_status_id_str;
  }

  /** The ID of the user who posted the source tweet. */
  get sourceUserId(): string {
    return this.data.source_user_id_str;
  }

  /** The media type. */
  get type(): string {
    return this.data.type;
  }

  /** The URL of the media. */
  get url(): string {
    return this.data.url;
  }

  /** The available sizes of the media. */
  get sizes(): Record<string, unknown> {
    return this.data.sizes;
  }

  get originalInfo(): Record<string, any> {
    return this.data.original_info;
  }

  /** The width of the media. */
  get width(): number {
    return this.originalInfo?.width;
  }

  /** The height of the media. */
  get height(): number {
    return this.originalInfo?.height;
  }

  get focusRects(): unknown[] {
    return this.originalInfo?.focus_rects;
  }

  /** Fetches the raw media bytes. */
  async get(): Promise<Buffer> {
    const response = await this.client.http.get<Buffer>(this.mediaUrl, {
      responseType: 'arraybuffer',
    });
    return response.data;
  }

  /** Downloads the media and writes it to `outputPath`. */
  async download(outputPath: string): Promise<void> {
    await writeFile(outputPath, await this.get());
  }

  toString(): string {
    return `<${this.constructor.name} id=${this.id}>`;
  }
}

/** A photo media object. */
export class Photo extends Media {
  /** The features of the photo. */
  get features(): Record<string, unknown> {
    return this.data.features;
  }
}

/** A single media stream (one quality variant). */
export class Stream {
  constructor(
    private readonly client: Client,
    private readonly data: Record<string, any>
  ) {}

  /** The url of the stream. */
  get url(): string {
    return this.data.url;
  }

  /** The bitrate of the stream. */
  get bitrate(): number {
    return this.data.bitrate;
  }

  /** The mimetype of the stream content. */
  get contentType(): string {
    return this.data.content_type;
  }

  /** Retrieves the raw content of the stream. */
  async get(): Promise<Buffer> {
    const response = await this.client.http.get<Buffer>(this.url, {
      responseType: 'arraybuffer',
    });
    return response.data;
  }

  /** Downloads the stream content and saves it to `outputPath`. */
  async download(outputPath: string): Promise<void> {
    await writeFile(outputPath, await this.get());
  }

  toString(): string {
    return `<Stream url="${this.url}">`;
  }
}

/** An animated GIF media object. */
export class AnimatedGif extends Media {
  /** The video information of the GIF. */
  get videoInfo(): Record<string, any> {
    return this.data.video_info;
  }

  /** The aspect ratio of the GIF, as `[width, height]`. */
  get aspectRatio(): [number, number] {
    return this.videoInfo.aspect_ratio as [number, number];
  }

  /** The video streams for the GIF. */
  get streams(): Stream[] {
    return (this.videoInfo.variants ?? []).map(
      (streamData: Record<string, any>) => new Stream(this.client, streamData)
    );
  }
}

/**
 * A video media object.
 *
 * @example
 * const tweet = await client.getTweetById('00000000000');
 * const video = tweet.media[0] as Video;
 * await video.streams[0].download('output.mp4');
 */
export class Video extends Media {
  private playlist: M3U8Playlist | null = null;
  private subtitlesPlaylist: M3U8Playlist | null = null;
  private readonly baseUrl = 'https://video.twimg.com';

  /** The video information. */
  get videoInfo(): Record<string, any> {
    return this.data.video_info;
  }

  /** The aspect ratio of the video, as `[width, height]`. */
  get aspectRatio(): [number, number] {
    return this.videoInfo.aspect_ratio as [number, number];
  }

  /** The duration of the video in milliseconds. */
  get durationMillis(): number {
    return this.videoInfo.duration_millis;
  }

  private get variants(): Record<string, any>[] {
    return this.videoInfo?.variants ?? [];
  }

  /** The video streams (quality variants) for the video. */
  get streams(): Stream[] {
    return this.variants
      .filter((variant) => String(variant.content_type ?? '').startsWith('video'))
      .map((streamData) => new Stream(this.client, streamData));
  }

  private async getPlaylist(): Promise<M3U8Playlist | null> {
    if (this.playlist) return this.playlist;

    const m3u8Stream = this.variants.find(
      (variant) => variant.content_type === 'application/x-mpegURL'
    );
    if (!m3u8Stream) return null;

    const [response] = await this.client.get<string>(m3u8Stream.url);
    this.playlist = parseM3U8(String(response));
    return this.playlist;
  }

  private async getSubtitlesPlaylist(): Promise<M3U8Playlist | null> {
    if (this.subtitlesPlaylist) return this.subtitlesPlaylist;

    const playlist = await this.getPlaylist();
    if (!playlist) return null;

    const subtitlesMedia = playlist.media.find((item) => item.type === 'SUBTITLES');
    if (!subtitlesMedia?.uri) return null;

    const [response] = await this.client.get<string>(this.baseUrl + subtitlesMedia.uri);
    this.subtitlesPlaylist = parseM3U8(String(response));
    return this.subtitlesPlaylist;
  }

  /**
   * Retrieves the subtitles for the video, or `null` when it has none.
   *
   * @example
   * const subtitles = await video.getSubtitles();
   * for (const caption of subtitles ?? []) {
   *   console.log(caption.start, caption.end, caption.text);
   * }
   */
  async getSubtitles(): Promise<WebVTT | null> {
    const subtitlesPlaylist = await this.getSubtitlesPlaylist();
    if (!subtitlesPlaylist || subtitlesPlaylist.segments.length === 0) return null;

    const [response] = await this.client.get<string>(
      this.baseUrl + subtitlesPlaylist.segments[0].uri
    );
    return parseWebVTT(String(response));
  }
}

export type MediaType = Video | Photo | AnimatedGif;

export const MEDIA_TYPE_MAPPING = {
  video: Video,
  photo: Photo,
  animated_gif: AnimatedGif,
} as const;

export function mediaFromData(client: Client, data: Record<string, any>): MediaType | null {
  const type = data.type as keyof typeof MEDIA_TYPE_MAPPING;
  const MediaClass = MEDIA_TYPE_MAPPING[type];
  if (!MediaClass) {
    console.warn(`unknown media type: ${String(type)}`);
    return null;
  }
  return new MediaClass(client, data);
}
