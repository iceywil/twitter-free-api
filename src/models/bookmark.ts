/** Ported from twikit/bookmark.py */

import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';
import type { Result } from '../utils.js';
import type { Tweet } from './tweet.js';

export class BookmarkFolder {
  /** The ID of the folder. */
  readonly id: string;
  /** The name of the folder. */
  readonly name: string;
  /** Icon image data. */
  readonly media: Record<string, unknown>;

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.id;
    this.name = data.name;
    this.media = data.media;
  }

  /** Retrieves tweets from the folder. */
  async getTweets(cursor?: string): Promise<Result<Tweet>> {
    return this.client.getBookmarks({ cursor, folderId: this.id });
  }

  /** Renames the folder. */
  async edit(name: string): Promise<BookmarkFolder> {
    return this.client.editBookmarkFolder(this.id, name);
  }

  /** Deletes the folder. */
  async delete(): Promise<HttpResponse> {
    return this.client.deleteBookmarkFolder(this.id);
  }

  /** Adds a tweet to the folder. */
  async add(tweetId: string): Promise<HttpResponse> {
    return this.client.bookmarkTweet(tweetId, this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof BookmarkFolder && this.id === other.id;
  }

  toString(): string {
    return `<BookmarkFolder id="${this.id}">`;
  }
}
