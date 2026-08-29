/** Ported from twikit/message.py */

import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';

/** Represents a direct message. */
export class Message {
  /** The ID of the message. */
  readonly id: string;
  /** The timestamp of the message. */
  readonly time: string;
  /** The text content of the message. */
  readonly text: string;
  /** Attachment information. */
  readonly attachment: Record<string, unknown> | null;

  constructor(
    protected readonly client: Client,
    data: Record<string, any>,
    readonly senderId: string,
    readonly recipientId: string
  ) {
    this.id = data.id;
    this.time = data.time;
    this.text = data.text;
    this.attachment = data.attachment ?? null;
  }

  /**
   * Replies to the message.
   *
   * @param text The text content of the direct message.
   * @param mediaId Media ID of any attachment, from `client.uploadMedia()`.
   * @see Client.sendDm
   */
  async reply(text: string, mediaId?: string): Promise<Message> {
    const userId = await this.client.userId();
    const sendTo = userId === this.senderId ? this.recipientId : this.senderId;
    return this.client.sendDm(sendTo, text, mediaId, this.id);
  }

  /** Adds an emoji reaction to the message. */
  async addReaction(emoji: string): Promise<HttpResponse> {
    return this.client.addReactionToMessage(this.id, await this.conversationId(), emoji);
  }

  /** Removes an emoji reaction from the message. */
  async removeReaction(emoji: string): Promise<HttpResponse> {
    return this.client.removeReactionFromMessage(this.id, await this.conversationId(), emoji);
  }

  /**
   * Deletes the message.
   *
   * @see Client.deleteDm
   */
  async delete(): Promise<HttpResponse> {
    return this.client.deleteDm(this.id);
  }

  private async conversationId(): Promise<string> {
    const userId = await this.client.userId();
    const partnerId = userId === this.senderId ? this.recipientId : this.senderId;
    return `${partnerId}-${userId}`;
  }

  equals(other: unknown): boolean {
    return other instanceof Message && this.id === other.id;
  }

  toString(): string {
    return `<Message id="${this.id}">`;
  }
}
