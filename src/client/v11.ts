/** Ported from twikit/client/v11.py */

import FormData from 'form-data';
import { TOKEN } from '../constants.js';
import type { RequestOptions } from '../internal/http.js';
import type { ApiResult } from './gql.js';
import { V11Endpoint } from './v11Endpoints.js';

export { V11Endpoint };

/** The subset of the client that `V11Client` needs. */
export interface V11Base {
  readonly baseHeaders: Record<string, string>;
  getCsrfToken(): string | undefined;
  request<T = any>(method: string, url: string, options?: RequestOptions): Promise<ApiResult<T>>;
  get<T = any>(url: string, options?: RequestOptions): Promise<ApiResult<T>>;
  post<T = any>(url: string, options?: RequestOptions): Promise<ApiResult<T>>;
}

/** Drops keys whose value is `null`/`undefined`, as upstream does before sending. */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) result[key] = value;
  }
  return result;
}

const FRIENDSHIP_FLAGS = {
  include_profile_interstitial_type: 1,
  include_blocking: 1,
  include_blocked_by: 1,
  include_followed_by: 1,
  include_want_retweets: 1,
  include_mute_edge: 1,
  include_can_dm: 1,
  include_can_media_tag: 1,
  include_ext_is_blue_verified: 1,
  include_ext_verified_type: 1,
  include_ext_profile_image_shape: 1,
  skip_status: 1,
} as const;

export class V11Client {
  constructor(private readonly base: V11Base) {}

  private get formHeaders(): Record<string, string> {
    return {
      ...this.base.baseHeaders,
      'content-type': 'application/x-www-form-urlencoded',
    };
  }

  guestActivate() {
    const headers = { ...this.base.baseHeaders };
    delete headers['X-Twitter-Active-User'];
    delete headers['X-Twitter-Auth-Type'];
    return this.base.post(V11Endpoint.GUEST_ACTIVATE, { headers, data: {} });
  }

  accountLogout() {
    return this.base.post(V11Endpoint.ACCOUNT_LOGOUT, { headers: this.base.baseHeaders });
  }

  onboardingTask(
    guestToken: string,
    token: string | null,
    subtaskInputs: unknown[] | null,
    data: Record<string, unknown> = {},
    options: RequestOptions = {}
  ) {
    const body: Record<string, unknown> = { ...data };
    if (token != null) body.flow_token = token;
    if (subtaskInputs != null) body.subtask_inputs = subtaskInputs;

    const headers: Record<string, string> = {
      'x-guest-token': guestToken,
      Authorization: `Bearer ${TOKEN}`,
    };

    const csrfToken = this.base.getCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
    }

    return this.base.post(V11Endpoint.ONBOARDING_TASK, { ...options, json: body, headers });
  }

  ssoInit(provider: string, guestToken: string) {
    const headers: Record<string, string> = {
      ...this.base.baseHeaders,
      'x-guest-token': guestToken,
    };
    delete headers['X-Twitter-Active-User'];
    delete headers['X-Twitter-Auth-Type'];
    return this.base.post(V11Endpoint.ONBOARDING_SSO_INIT, { json: { provider }, headers });
  }

  settings() {
    return this.base.get(V11Endpoint.SETTINGS, { headers: this.base.baseHeaders });
  }

  // -- media upload ----------------------------------------------------------

  uploadMedia(method: string, isLongVideo: boolean, options: RequestOptions = {}) {
    const endpoint = isLongVideo ? V11Endpoint.UPLOAD_MEDIA_2 : V11Endpoint.UPLOAD_MEDIA;
    return this.base.request(method, endpoint, options);
  }

  uploadMediaInit(
    mediaType: string,
    totalBytes: number,
    mediaCategory: string | null,
    isLongVideo: boolean
  ) {
    const params: Record<string, unknown> = {
      command: 'INIT',
      total_bytes: totalBytes,
      media_type: mediaType,
    };
    if (mediaCategory != null) params.media_category = mediaCategory;

    return this.uploadMedia('POST', isLongVideo, {
      params,
      headers: this.base.baseHeaders,
    });
  }

  uploadMediaAppend(
    isLongVideo: boolean,
    mediaId: string,
    segmentIndex: number,
    chunk: Buffer
  ) {
    const params = {
      command: 'APPEND',
      media_id: mediaId,
      segment_index: segmentIndex,
    };

    const headers = { ...this.base.baseHeaders };
    delete headers['content-type'];

    const form = new FormData();
    form.append('media', chunk, {
      filename: 'blob',
      contentType: 'application/octet-stream',
    });

    return this.uploadMedia('POST', isLongVideo, { params, headers, form });
  }

  uploadMediaFinalize(isLongVideo: boolean, mediaId: string) {
    return this.uploadMedia('POST', isLongVideo, {
      params: { command: 'FINALIZE', media_id: mediaId },
      headers: this.base.baseHeaders,
    });
  }

  uploadMediaStatus(isLongVideo: boolean, mediaId: string) {
    return this.uploadMedia('GET', isLongVideo, {
      params: { command: 'STATUS', media_id: mediaId },
      headers: this.base.baseHeaders,
    });
  }

  createMediaMetadata(
    mediaId: string,
    altText: string | null,
    sensitiveWarning: string[] | null
  ) {
    const data: Record<string, unknown> = { media_id: mediaId };
    if (altText != null) data.alt_text = { text: altText };
    if (sensitiveWarning != null) data.sensitive_media_warning = sensitiveWarning;
    return this.base.post(V11Endpoint.CREATE_MEDIA_METADATA, {
      json: data,
      headers: this.base.baseHeaders,
    });
  }

  // -- polls -----------------------------------------------------------------

  createCard(choices: string[], durationMinutes: number) {
    const cardData: Record<string, unknown> = {
      'twitter:card': `poll${choices.length}choice_text_only`,
      'twitter:api:api:endpoint': '1',
      'twitter:long:duration_minutes': durationMinutes,
    };
    choices.forEach((choice, index) => {
      cardData[`twitter:string:choice${index + 1}_label`] = choice;
    });

    return this.base.post(V11Endpoint.CREATE_CARD, {
      data: { card_data: JSON.stringify(cardData) },
      headers: this.formHeaders,
    });
  }

  vote(selectedChoice: string, cardUri: string, tweetId: string, cardName: string) {
    const data = {
      'twitter:string:card_uri': cardUri,
      'twitter:long:original_tweet_id': tweetId,
      'twitter:string:response_card_name': cardName,
      'twitter:string:cards_platform': 'Web-12',
      'twitter:string:selected_choice': selectedChoice,
    };
    return this.base.post(V11Endpoint.VOTE, { data, headers: this.formHeaders });
  }

  // -- geo -------------------------------------------------------------------

  reverseGeocode(
    lat: number,
    long: number,
    accuracy: string | number | null,
    granularity: string | null,
    maxResults: number | null
  ) {
    const params = compact({ lat, long, accuracy, granularity, max_results: maxResults });
    return this.base.get(V11Endpoint.REVERSE_GEOCODE, {
      params,
      headers: this.base.baseHeaders,
    });
  }

  searchGeo(
    lat: number | null,
    long: number | null,
    query: string | null,
    ip: string | null,
    granularity: string | null,
    maxResults: number | null
  ) {
    const params = compact({ lat, long, query, ip, granularity, max_results: maxResults });
    return this.base.get(V11Endpoint.SEARCH_GEO, { params, headers: this.base.baseHeaders });
  }

  getPlace(id: string) {
    return this.base.get(V11Endpoint.GET_PLACE(id), { headers: this.base.baseHeaders });
  }

  // -- friendships / blocks / mutes ------------------------------------------

  createFriendships(userId: string) {
    return this.base.post(V11Endpoint.CREATE_FRIENDSHIPS, {
      data: { ...FRIENDSHIP_FLAGS, user_id: userId },
      headers: this.formHeaders,
    });
  }

  destroyFriendships(userId: string) {
    return this.base.post(V11Endpoint.DESTROY_FRIENDSHIPS, {
      data: { ...FRIENDSHIP_FLAGS, user_id: userId },
      headers: this.formHeaders,
    });
  }

  createBlocks(userId: string) {
    return this.base.post(V11Endpoint.CREATE_BLOCKS, {
      data: { user_id: userId },
      headers: this.formHeaders,
    });
  }

  destroyBlocks(userId: string) {
    return this.base.post(V11Endpoint.DESTROY_BLOCKS, {
      data: { user_id: userId },
      headers: this.formHeaders,
    });
  }

  createMutes(userId: string) {
    return this.base.post(V11Endpoint.CREATE_MUTES, {
      data: { user_id: userId },
      headers: this.formHeaders,
    });
  }

  destroyMutes(userId: string) {
    return this.base.post(V11Endpoint.DESTROY_MUTES, {
      data: { user_id: userId },
      headers: this.formHeaders,
    });
  }

  // -- trends ----------------------------------------------------------------

  guide(
    category: string,
    count: number,
    additionalRequestParams: Record<string, unknown> | null
  ) {
    const params: Record<string, unknown> = {
      count,
      include_page_configuration: true,
      initial_tab_id: category,
    };
    if (additionalRequestParams != null) Object.assign(params, additionalRequestParams);
    return this.base.get(V11Endpoint.GUIDE, { params, headers: this.base.baseHeaders });
  }

  availableTrends() {
    return this.base.get(V11Endpoint.AVAILABLE_TRENDS, { headers: this.base.baseHeaders });
  }

  placeTrends(woeid: number) {
    return this.base.get(V11Endpoint.PLACE_TRENDS, {
      params: { id: woeid },
      headers: this.base.baseHeaders,
    });
  }

  private friendships(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    endpoint: string,
    cursor: string | null
  ) {
    const params: Record<string, unknown> = { count };
    if (userId != null) {
      params.user_id = userId;
    } else if (screenName != null) {
      params.screen_name = screenName;
    }
    if (cursor != null) params.cursor = cursor;
    return this.base.get(endpoint, { params, headers: this.base.baseHeaders });
  }

  followersList(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    cursor: string | null
  ) {
    return this.friendships(userId, screenName, count, V11Endpoint.FOLLOWERS_LIST, cursor);
  }

  friendsList(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    cursor: string | null
  ) {
    return this.friendships(userId, screenName, count, V11Endpoint.FRIENDS_LIST, cursor);
  }

  private friendshipIds(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    endpoint: string,
    cursor: string | null
  ) {
    const params: Record<string, unknown> = { count };
    if (userId != null) {
      params.user_id = userId;
    } else if (screenName != null) {
      // Upstream guards this branch on `user_id` rather than `screen_name`, so it
      // never fires there; sending the screen name is the evident intent.
      params.screen_name = screenName;
    }
    if (cursor != null) params.cursor = cursor;
    return this.base.get(endpoint, { params, headers: this.base.baseHeaders });
  }

  followersIds(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    cursor: string | null
  ) {
    return this.friendshipIds(userId, screenName, count, V11Endpoint.FOLLOWERS_IDS, cursor);
  }

  friendsIds(
    userId: string | null,
    screenName: string | null,
    count: number | null,
    cursor: string | null
  ) {
    return this.friendshipIds(userId, screenName, count, V11Endpoint.FRIENDS_IDS, cursor);
  }

  // -- direct messages -------------------------------------------------------

  dmNew(
    conversationId: string,
    text: string,
    mediaId: string | null,
    replyTo: string | null
  ) {
    const data: Record<string, unknown> = {
      cards_platform: 'Web-12',
      conversation_id: conversationId,
      dm_users: false,
      include_cards: 1,
      include_quote_count: true,
      recipient_ids: false,
      text,
    };
    if (mediaId != null) data.media_id = mediaId;
    if (replyTo != null) data.reply_to_dm_id = replyTo;

    return this.base.post(V11Endpoint.DM_NEW, { json: data, headers: this.base.baseHeaders });
  }

  dmInbox() {
    return this.base.get(V11Endpoint.DM_INBOX, { headers: this.base.baseHeaders });
  }

  dmConversation(conversationId: string, maxId: string | null) {
    const params: Record<string, unknown> = {
      context: 'FETCH_DM_CONVERSATION_HISTORY',
      include_conversation_info: true,
    };
    if (maxId != null) params.max_id = maxId;

    return this.base.get(V11Endpoint.DM_CONVERSATION(conversationId), {
      params,
      headers: this.base.baseHeaders,
    });
  }

  conversationUpdateName(groupId: string, name: string) {
    return this.base.post(V11Endpoint.CONVERSATION_UPDATE_NAME(groupId), {
      data: { name },
      headers: this.formHeaders,
    });
  }

  // -- notifications ---------------------------------------------------------

  private notifications(endpoint: string, count: number, cursor: string | null) {
    const params: Record<string, unknown> = { count };
    if (cursor != null) params.cursor = cursor;
    return this.base.get(endpoint, { params, headers: this.base.baseHeaders });
  }

  notificationsAll(count: number, cursor: string | null) {
    return this.notifications(V11Endpoint.NOTIFICATIONS_ALL, count, cursor);
  }

  notificationsVerified(count: number, cursor: string | null) {
    return this.notifications(V11Endpoint.NOTIFICATIONS_VERIFIED, count, cursor);
  }

  notificationsMentions(count: number, cursor: string | null) {
    return this.notifications(V11Endpoint.NOTIFICATIONS_MENTIONS, count, cursor);
  }

  // -- streaming -------------------------------------------------------------

  livePipelineUpdateSubscriptions(
    session: string,
    subscribe: string,
    unsubscribe: string
  ) {
    const headers = {
      ...this.formHeaders,
      'LivePipeline-Session': session,
    };
    return this.base.post(V11Endpoint.LIVE_PIPELINE_UPDATE_SUBSCRIPTIONS, {
      data: { sub_topics: subscribe, unsub_topics: unsubscribe },
      headers,
    });
  }

  userState() {
    return this.base.get(V11Endpoint.USER_STATE, { headers: this.base.baseHeaders });
  }
}
