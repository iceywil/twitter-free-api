/** Ported from twikit/client/gql.py */

import {
  BOOKMARK_FOLDER_TIMELINE_FEATURES,
  COMMUNITY_NOTE_FEATURES,
  COMMUNITY_TWEETS_FEATURES,
  FEATURES,
  JOIN_COMMUNITY_FEATURES,
  LIST_FEATURES,
  NOTE_TWEET_FEATURES,
  SIMILAR_POSTS_FEATURES,
  TWEET_RESULTS_BY_REST_IDS_FEATURES,
  TWEET_RESULT_BY_REST_ID_FEATURES,
  USER_FEATURES,
  USER_HIGHLIGHTS_TWEETS_FEATURES,
} from '../constants.js';
import type { HttpResponse, RequestOptions } from '../internal/http.js';
import { flattenParams, getQueryId } from '../utils.js';
import { Endpoint } from './endpoints.js';

export { Endpoint };

type Variables = Record<string, unknown>;
type Features = Record<string, boolean>;
export type ApiResult<T = any> = [T, HttpResponse];

/** The subset of the client that `GQLClient` needs; `Client` and `GuestClient` both satisfy it. */
export interface GQLBase {
  readonly baseHeaders: Record<string, string>;
  get<T = any>(url: string, options?: RequestOptions): Promise<ApiResult<T>>;
  post<T = any>(url: string, options?: RequestOptions): Promise<ApiResult<T>>;
}

export class GQLClient {
  constructor(private readonly base: GQLBase) {}

  async gqlGet<T = any>(
    url: string,
    variables: Variables,
    features?: Features | null,
    headers?: Record<string, string> | null,
    extraParams?: Record<string, unknown> | null,
    options: RequestOptions = {}
  ): Promise<ApiResult<T>> {
    const params: Record<string, unknown> = { variables };
    if (features != null) params.features = features;
    if (extraParams != null) Object.assign(params, extraParams);
    return this.base.get<T>(url, {
      ...options,
      params: flattenParams(params),
      headers: headers ?? this.base.baseHeaders,
    });
  }

  async gqlPost<T = any>(
    url: string,
    variables: Variables,
    features?: Features | null,
    headers?: Record<string, string> | null,
    extraData?: Record<string, unknown> | null,
    options: RequestOptions = {}
  ): Promise<ApiResult<T>> {
    const data: Record<string, unknown> = { variables, queryId: getQueryId(url) };
    if (features != null) data.features = features;
    if (extraData != null) Object.assign(data, extraData);
    return this.base.post<T>(url, {
      ...options,
      json: data,
      headers: headers ?? this.base.baseHeaders,
    });
  }

  // -- tweets ----------------------------------------------------------------

  searchTimeline(query: string, product: string, count: number, cursor: string | null) {
    const variables: Variables = {
      rawQuery: query,
      count,
      querySource: 'typed_query',
      product,
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.SEARCH_TIMELINE, variables, FEATURES);
  }

  similarPosts(tweetId: string) {
    return this.gqlGet(Endpoint.SIMILAR_POSTS, { tweet_id: tweetId }, SIMILAR_POSTS_FEATURES);
  }

  createTweet(
    isNoteTweet: boolean,
    text: string,
    mediaEntities: unknown[],
    pollUri: string | null,
    replyTo: string | null,
    attachmentUrl: string | null,
    communityId: string | null,
    shareWithFollowers: boolean,
    richtextOptions: unknown[] | null,
    editTweetId: string | null,
    limitMode: string | null
  ) {
    const variables: Variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: mediaEntities, possibly_sensitive: false },
      semantic_annotation_ids: [],
    };

    if (pollUri != null) variables.card_uri = pollUri;

    if (replyTo != null) {
      variables.reply = { in_reply_to_tweet_id: replyTo, exclude_reply_user_ids: [] };
    }
    if (limitMode != null) variables.conversation_control = { mode: limitMode };
    if (attachmentUrl != null) variables.attachment_url = attachmentUrl;

    if (communityId != null) {
      variables.semantic_annotation_ids = [
        { entity_id: communityId, group_id: '8', domain_id: '31' },
      ];
      variables.broadcast = shareWithFollowers;
    }

    let noteTweet = isNoteTweet;
    if (richtextOptions != null) {
      noteTweet = true;
      variables.richtext_options = { richtext_tags: richtextOptions };
    }
    if (editTweetId != null) {
      variables.edit_options = { previous_tweet_id: editTweetId };
    }

    const endpoint = noteTweet ? Endpoint.CREATE_NOTE_TWEET : Endpoint.CREATE_TWEET;
    const features = noteTweet ? NOTE_TWEET_FEATURES : FEATURES;
    return this.gqlPost(endpoint, variables, features);
  }

  createScheduledTweet(scheduledAt: number, text: string, mediaIds: string[] | null) {
    const variables: Variables = {
      post_tweet_request: {
        auto_populate_reply_metadata: false,
        status: text,
        exclude_reply_user_ids: [],
        media_ids: mediaIds,
      },
      execute_at: scheduledAt,
    };
    return this.gqlPost(Endpoint.CREATE_SCHEDULED_TWEET, variables);
  }

  deleteTweet(tweetId: string) {
    return this.gqlPost(Endpoint.DELETE_TWEET, { tweet_id: tweetId, dark_request: false });
  }

  userByScreenName(screenName: string) {
    const variables: Variables = { screen_name: screenName, withSafetyModeUserFields: false };
    const params = { fieldToggles: { withAuxiliaryUserLabels: false } };
    return this.gqlGet(Endpoint.USER_BY_SCREEN_NAME, variables, USER_FEATURES, null, params);
  }

  /**
   * The authenticated user. Used to resolve our own id now that the v1.1
   * account endpoints are gone.
   */
  viewer() {
    return this.gqlGet(Endpoint.VIEWER, { withCommunitiesMemberships: true });
  }

  userByRestId(userId: string) {
    const variables: Variables = { userId, withSafetyModeUserFields: true };
    return this.gqlGet(Endpoint.USER_BY_REST_ID, variables, USER_FEATURES);
  }

  tweetDetail(tweetId: string, cursor: string | null) {
    const variables: Variables = {
      focalTweetId: tweetId,
      with_rux_injections: false,
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor != null) variables.cursor = cursor;
    const params = { fieldToggles: { withAuxiliaryUserLabels: false } };
    return this.gqlGet(Endpoint.TWEET_DETAIL, variables, FEATURES, null, params);
  }

  fetchScheduledTweets() {
    return this.gqlGet(Endpoint.FETCH_SCHEDULED_TWEETS, { ascending: true });
  }

  deleteScheduledTweet(tweetId: string) {
    return this.gqlPost(Endpoint.DELETE_SCHEDULED_TWEET, { scheduled_tweet_id: tweetId });
  }

  private tweetEngagements(
    tweetId: string,
    count: number,
    cursor: string | null,
    endpoint: string
  ) {
    const variables: Variables = { tweetId, count, includePromotedContent: true };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(endpoint, variables, FEATURES);
  }

  retweeters(tweetId: string, count: number, cursor: string | null) {
    return this.tweetEngagements(tweetId, count, cursor, Endpoint.RETWEETERS);
  }

  favoriters(tweetId: string, count: number, cursor: string | null) {
    return this.tweetEngagements(tweetId, count, cursor, Endpoint.FAVORITERS);
  }

  birdWatchOneNote(noteId: string) {
    return this.gqlGet(
      Endpoint.FETCH_COMMUNITY_NOTE,
      { note_id: noteId },
      COMMUNITY_NOTE_FEATURES
    );
  }

  private getUserTweetsRequest(
    userId: string,
    count: number,
    cursor: string | null,
    endpoint: string
  ) {
    const variables: Variables = {
      userId,
      count,
      includePromotedContent: true,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(endpoint, variables, FEATURES);
  }

  userTweets(userId: string, count: number, cursor: string | null) {
    return this.getUserTweetsRequest(userId, count, cursor, Endpoint.USER_TWEETS);
  }

  userTweetsAndReplies(userId: string, count: number, cursor: string | null) {
    return this.getUserTweetsRequest(userId, count, cursor, Endpoint.USER_TWEETS_AND_REPLIES);
  }

  userMedia(userId: string, count: number, cursor: string | null) {
    return this.getUserTweetsRequest(userId, count, cursor, Endpoint.USER_MEDIA);
  }

  userLikes(userId: string, count: number, cursor: string | null) {
    return this.getUserTweetsRequest(userId, count, cursor, Endpoint.USER_LIKES);
  }

  userHighlightsTweets(userId: string, count: number, cursor: string | null) {
    const variables: Variables = {
      userId,
      count,
      includePromotedContent: true,
      withVoice: true,
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(
      Endpoint.USER_HIGHLIGHTS_TWEETS,
      variables,
      USER_HIGHLIGHTS_TWEETS_FEATURES,
      this.base.baseHeaders
    );
  }

  private homeTimelineRequest(
    endpoint: string,
    count: number,
    seenTweetIds: string[] | null,
    cursor: string | null
  ) {
    const variables: Variables = {
      count,
      includePromotedContent: true,
      latestControlAvailable: true,
      requestContext: 'launch',
      withCommunity: true,
      seenTweetIds: seenTweetIds ?? [],
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlPost(endpoint, variables, FEATURES);
  }

  homeTimeline(count: number, seenTweetIds: string[] | null, cursor: string | null) {
    return this.homeTimelineRequest(Endpoint.HOME_TIMELINE, count, seenTweetIds, cursor);
  }

  homeLatestTimeline(count: number, seenTweetIds: string[] | null, cursor: string | null) {
    return this.homeTimelineRequest(Endpoint.HOME_LATEST_TIMELINE, count, seenTweetIds, cursor);
  }

  favoriteTweet(tweetId: string) {
    return this.gqlPost(Endpoint.FAVORITE_TWEET, { tweet_id: tweetId });
  }

  unfavoriteTweet(tweetId: string) {
    return this.gqlPost(Endpoint.UNFAVORITE_TWEET, { tweet_id: tweetId });
  }

  retweet(tweetId: string) {
    return this.gqlPost(Endpoint.CREATE_RETWEET, { tweet_id: tweetId, dark_request: false });
  }

  deleteRetweet(tweetId: string) {
    return this.gqlPost(Endpoint.DELETE_RETWEET, {
      source_tweet_id: tweetId,
      dark_request: false,
    });
  }

  // -- bookmarks -------------------------------------------------------------

  createBookmark(tweetId: string) {
    return this.gqlPost(Endpoint.CREATE_BOOKMARK, { tweet_id: tweetId });
  }

  bookmarkTweetToFolder(tweetId: string, folderId: string) {
    return this.gqlPost(Endpoint.BOOKMARK_TO_FOLDER, {
      tweet_id: tweetId,
      bookmark_collection_id: folderId,
    });
  }

  deleteBookmark(tweetId: string) {
    return this.gqlPost(Endpoint.DELETE_BOOKMARK, { tweet_id: tweetId });
  }

  bookmarks(count: number, cursor: string | null) {
    const variables: Variables = { count, includePromotedContent: true };
    const features = { ...FEATURES, graphql_timeline_v2_bookmark_timeline: true };
    if (cursor != null) variables.cursor = cursor;
    return this.base.get(Endpoint.BOOKMARKS, {
      params: flattenParams({ variables, features }),
      headers: this.base.baseHeaders,
    });
  }

  bookmarkFolderTimeline(count: number, cursor: string | null, folderId: string) {
    const variables: Variables = {
      count,
      includePromotedContent: true,
      bookmark_collection_id: folderId,
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(
      Endpoint.BOOKMARK_FOLDER_TIMELINE,
      variables,
      BOOKMARK_FOLDER_TIMELINE_FEATURES
    );
  }

  deleteAllBookmarks() {
    return this.gqlPost(Endpoint.BOOKMARKS_ALL_DELETE, {});
  }

  bookmarkFoldersSlice(cursor: string | null) {
    const inner: Variables = {};
    if (cursor != null) inner.cursor = cursor;
    // Upstream nests `variables` inside `variables` here; kept as-is so the
    // request matches the Python library byte for byte.
    return this.gqlGet(Endpoint.BOOKMARK_FOLDERS_SLICE, { variables: inner });
  }

  editBookmarkFolder(folderId: string, name: string) {
    return this.gqlPost(Endpoint.EDIT_BOOKMARK_FOLDER, {
      bookmark_collection_id: folderId,
      name,
    });
  }

  deleteBookmarkFolder(folderId: string) {
    return this.gqlPost(Endpoint.DELETE_BOOKMARK_FOLDER, {
      bookmark_collection_id: folderId,
    });
  }

  createBookmarkFolder(name: string) {
    return this.gqlPost(Endpoint.CREATE_BOOKMARK_FOLDER, { name });
  }

  // -- friendships -----------------------------------------------------------

  private friendships(userId: string, count: number, endpoint: string, cursor: string | null) {
    const variables: Variables = { userId, count, includePromotedContent: false };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(endpoint, variables, FEATURES);
  }

  followers(userId: string, count: number, cursor: string | null) {
    return this.friendships(userId, count, Endpoint.FOLLOWERS, cursor);
  }

  blueVerifiedFollowers(userId: string, count: number, cursor: string | null) {
    return this.friendships(userId, count, Endpoint.BLUE_VERIFIED_FOLLOWERS, cursor);
  }

  followersYouKnow(userId: string, count: number, cursor: string | null) {
    return this.friendships(userId, count, Endpoint.FOLLOWERS_YOU_KNOW, cursor);
  }

  following(userId: string, count: number, cursor: string | null) {
    return this.friendships(userId, count, Endpoint.FOLLOWING, cursor);
  }

  userCreatorSubscriptions(userId: string, count: number, cursor: string | null) {
    return this.friendships(userId, count, Endpoint.USER_CREATOR_SUBSCRIPTIONS, cursor);
  }

  // -- direct messages -------------------------------------------------------

  userDmReactionMutationAddMutation(messageId: string, conversationId: string, emoji: string) {
    return this.gqlPost(Endpoint.USER_DM_REACTION_MUTATION_ADD_MUTATION, {
      messageId,
      conversationId,
      reactionTypes: ['Emoji'],
      emojiReactions: [emoji],
    });
  }

  userDmReactionMutationRemoveMutation(
    messageId: string,
    conversationId: string,
    emoji: string
  ) {
    return this.gqlPost(Endpoint.USER_DM_REACTION_MUTATION_REMOVE_MUTATION, {
      conversationId,
      messageId,
      reactionTypes: ['Emoji'],
      emojiReactions: [emoji],
    });
  }

  dmMessageDeleteMutation(messageId: string) {
    return this.gqlPost(Endpoint.DM_MESSAGE_DELETE_MUTATION, { messageId });
  }

  addParticipantsMutation(groupId: string, userIds: string[]) {
    return this.gqlPost(Endpoint.ADD_PARTICIPANTS_MUTATION, {
      addedParticipants: userIds,
      conversationId: groupId,
    });
  }

  // -- lists -----------------------------------------------------------------

  createList(name: string, description: string, isPrivate: boolean) {
    return this.gqlPost(
      Endpoint.CREATE_LIST,
      { isPrivate, name, description },
      LIST_FEATURES
    );
  }

  editListBanner(listId: string, mediaId: string) {
    return this.gqlPost(Endpoint.EDIT_LIST_BANNER, { listId, mediaId }, LIST_FEATURES);
  }

  deleteListBanner(listId: string) {
    return this.gqlPost(Endpoint.DELETE_LIST_BANNER, { listId }, LIST_FEATURES);
  }

  updateList(
    listId: string,
    name: string | null,
    description: string | null,
    isPrivate: boolean | null
  ) {
    const variables: Variables = { listId };
    if (name != null) variables.name = name;
    if (description != null) variables.description = description;
    if (isPrivate != null) variables.isPrivate = isPrivate;
    return this.gqlPost(Endpoint.UPDATE_LIST, variables, LIST_FEATURES);
  }

  listAddMember(listId: string, userId: string) {
    return this.gqlPost(Endpoint.LIST_ADD_MEMBER, { listId, userId }, LIST_FEATURES);
  }

  listRemoveMember(listId: string, userId: string) {
    return this.gqlPost(Endpoint.LIST_REMOVE_MEMBER, { listId, userId }, LIST_FEATURES);
  }

  listManagementPaceTimeline(count: number, cursor: string | null) {
    const variables: Variables = { count };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.LIST_MANAGEMENT_PACE_TIMELINE, variables, FEATURES);
  }

  listByRestId(listId: string) {
    return this.gqlGet(Endpoint.LIST_BY_REST_ID, { listId }, LIST_FEATURES);
  }

  listLatestTweetsTimeline(listId: string, count: number, cursor: string | null) {
    const variables: Variables = { listId, count };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.LIST_LATEST_TWEETS_TIMELINE, variables, FEATURES);
  }

  private listUsers(endpoint: string, listId: string, count: number, cursor: string | null) {
    const variables: Variables = { listId, count };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(endpoint, variables, FEATURES);
  }

  listMembers(listId: string, count: number, cursor: string | null) {
    return this.listUsers(Endpoint.LIST_MEMBERS, listId, count, cursor);
  }

  listSubscribers(listId: string, count: number, cursor: string | null) {
    return this.listUsers(Endpoint.LIST_SUBSCRIBERS, listId, count, cursor);
  }

  // -- communities -----------------------------------------------------------

  searchCommunity(query: string, cursor: string | null) {
    const variables: Variables = { query };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.SEARCH_COMMUNITY, variables);
  }

  communityQuery(communityId: string) {
    const features = {
      c9s_list_members_action_api_enabled: false,
      c9s_superc9s_indication_enabled: false,
    };
    return this.gqlGet(Endpoint.COMMUNITY_QUERY, { communityId }, features);
  }

  communityMediaTimeline(communityId: string, count: number, cursor: string | null) {
    const variables: Variables = { communityId, count, withCommunity: true };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.COMMUNITY_MEDIA_TIMELINE, variables, COMMUNITY_TWEETS_FEATURES);
  }

  communityTweetsTimeline(
    communityId: string,
    rankingMode: string,
    count: number,
    cursor: string | null
  ) {
    const variables: Variables = { communityId, count, withCommunity: true, rankingMode };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(Endpoint.COMMUNITY_TWEETS_TIMELINE, variables, COMMUNITY_TWEETS_FEATURES);
  }

  communitiesMainPageTimeline(count: number, cursor: string | null) {
    const variables: Variables = { count, withCommunity: true };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(
      Endpoint.COMMUNITIES_MAIN_PAGE_TIMELINE,
      variables,
      COMMUNITY_TWEETS_FEATURES
    );
  }

  joinCommunity(communityId: string) {
    return this.gqlPost(Endpoint.JOIN_COMMUNITY, { communityId }, JOIN_COMMUNITY_FEATURES);
  }

  leaveCommunity(communityId: string) {
    return this.gqlPost(Endpoint.LEAVE_COMMUNITY, { communityId }, JOIN_COMMUNITY_FEATURES);
  }

  requestToJoinCommunity(communityId: string, answer: string | null) {
    return this.gqlPost(
      Endpoint.REQUEST_TO_JOIN_COMMUNITY,
      { communityId, answer: answer ?? '' },
      JOIN_COMMUNITY_FEATURES
    );
  }

  private getCommunityUsers(
    endpoint: string,
    communityId: string,
    count: number,
    cursor: string | null
  ) {
    const variables: Variables = { communityId, count };
    const features = { responsive_web_graphql_timeline_navigation_enabled: true };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(endpoint, variables, features);
  }

  membersSliceTimelineQuery(communityId: string, count: number, cursor: string | null) {
    return this.getCommunityUsers(
      Endpoint.MEMBERS_SLICE_TIMELINE_QUERY,
      communityId,
      count,
      cursor
    );
  }

  moderatorsSliceTimelineQuery(communityId: string, count: number, cursor: string | null) {
    return this.getCommunityUsers(
      Endpoint.MODERATORS_SLICE_TIMELINE_QUERY,
      communityId,
      count,
      cursor
    );
  }

  communityTweetSearchModuleQuery(
    communityId: string,
    query: string,
    count: number,
    cursor: string | null
  ) {
    const variables: Variables = {
      count,
      query,
      communityId,
      includePromotedContent: false,
      withBirdwatchNotes: true,
      withVoice: false,
      isListMemberTargetUserId: '0',
      withCommunity: false,
      withSafetyModeUserFields: true,
    };
    if (cursor != null) variables.cursor = cursor;
    return this.gqlGet(
      Endpoint.COMMUNITY_TWEET_SEARCH_MODULE_QUERY,
      variables,
      COMMUNITY_TWEETS_FEATURES
    );
  }

  tweetResultsByRestIds(tweetIds: string[]) {
    const variables: Variables = {
      tweetIds,
      includePromotedContent: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withCommunity: true,
    };
    return this.gqlGet(
      Endpoint.TWEET_RESULTS_BY_REST_IDS,
      variables,
      TWEET_RESULTS_BY_REST_IDS_FEATURES
    );
  }

  // -- guest client ----------------------------------------------------------

  tweetResultByRestId(tweetId: string) {
    const variables: Variables = {
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    };
    const params = {
      fieldToggles: {
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
      },
    };
    return this.gqlGet(
      Endpoint.TWEET_RESULT_BY_REST_ID,
      variables,
      TWEET_RESULT_BY_REST_ID_FEATURES,
      null,
      params
    );
  }
}
