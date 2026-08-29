/** Ported from twikit/notification.py */

import type { Client } from '../client/client.js';
import type { Tweet } from './tweet.js';
import type { User } from './user.js';

export class Notification {
  /** The unique identifier of the notification. */
  readonly id: string;
  /** The timestamp of the notification in milliseconds. */
  readonly timestampMs: number;
  /** Icon data for the notification. */
  readonly icon: Record<string, unknown>;
  /** The message text of the notification. */
  readonly message: string;

  constructor(
    private readonly client: Client,
    data: Record<string, any>,
    /** The tweet associated with the notification. */
    readonly tweet: Tweet | null,
    /** The user who triggered the notification. */
    readonly fromUser: User | null
  ) {
    this.id = data.id;
    this.timestampMs = Number.parseInt(data.timestampMs, 10);
    this.icon = data.icon;
    this.message = data.message?.text;
  }

  equals(other: unknown): boolean {
    return other instanceof Notification && this.id === other.id;
  }

  toString(): string {
    return `<Notification id="${this.id}">`;
  }
}
