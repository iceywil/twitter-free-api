
import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';
import { buildUserData, type Result } from '../utils.js';
import { Message } from './message.js';
import { User } from './user.js';

/** Represents a group DM conversation. */
export class Group {
  /** The name of the group. */
  readonly name: string | null;
  /** The members of the group. */
  readonly members: User[];

  constructor(
    private readonly client: Client,
    readonly id: string,
    data: Record<string, any>
  ) {
    const conversationTimeline = data.conversation_timeline;
    const conversations = conversationTimeline?.conversations ?? {};
    this.name =
      Object.keys(conversations).length > 0 ? conversations[id]?.name ?? null : null;

    const users = Object.values<Record<string, any>>(conversationTimeline?.users ?? {});
    this.members = users.map((user) => new User(client, buildUserData(user)));
  }

  /**
   * Retrieves the DM conversation history in the group.
   *
   * @param maxId If specified, retrieves messages older than this message ID.
   * @example
   * const messages = await group.getHistory();
   * const moreMessages = await messages.next();
   */
  async getHistory(maxId?: string): Promise<Result<GroupMessage>> {
    return this.client.getGroupDmHistory(this.id, maxId);
  }

  /** Adds members to the group. */
  async addMembers(userIds: string[]): Promise<HttpResponse> {
    return this.client.addMembersToGroup(this.id, userIds);
  }

  /** Changes the group name. */
  async changeName(name: string): Promise<HttpResponse> {
    return this.client.changeGroupName(this.id, name);
  }

  /**
   * Sends a message to the group.
   *
   * @param text The text content of the direct message.
   * @param mediaId Media ID of any attachment, from `client.uploadMedia()`.
   * @param replyTo Message ID to reply to.
   */
  async sendMessage(text: string, mediaId?: string, replyTo?: string): Promise<GroupMessage> {
    return this.client.sendDmToGroup(this.id, text, mediaId, replyTo);
  }

  /** Re-fetches this group and returns the fresh instance. */
  async update(): Promise<Group> {
    return this.client.getGroup(this.id);
  }

  toString(): string {
    return `<Group id="${this.id}">`;
  }
}

/** Represents a direct message sent within a group. */
export class GroupMessage extends Message {
  constructor(
    client: Client,
    data: Record<string, any>,
    senderId: string,
    /** The ID of the group. */
    readonly groupId: string
  ) {
    super(client, data, senderId, '');
  }

  /** Gets the group the message was sent to. */
  async group(): Promise<Group> {
    return this.client.getGroup(this.groupId);
  }

  /**
   * Replies to the message.
   *
   * @see Client.sendDmToGroup
   */
  override async reply(text: string, mediaId?: string): Promise<GroupMessage> {
    return this.client.sendDmToGroup(this.groupId, text, mediaId, this.id);
  }

  /** Adds an emoji reaction to the message. */
  override async addReaction(emoji: string): Promise<HttpResponse> {
    return this.client.addReactionToMessage(this.id, this.groupId, emoji);
  }

  /** Removes an emoji reaction from the message. */
  override async removeReaction(emoji: string): Promise<HttpResponse> {
    return this.client.removeReactionFromMessage(this.id, this.groupId, emoji);
  }

  override toString(): string {
    return `<GroupMessage id="${this.id}">`;
  }
}
