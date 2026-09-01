/**
 * free-twitter-api — a Twitter/X client for TypeScript that needs no API key.
 *
 * A Twitter/X API wrapper that needs no API key.
 *
 */

export const VERSION = '0.1.0';

// -- clients -----------------------------------------------------------------
export { Client, type ClientOptions, type LoginOptions } from './client/client.js';
export { GQLClient, Endpoint, type ApiResult, type GQLBase } from './client/gql.js';
export { V11Client, V11Endpoint, type V11Base } from './client/v11.js';
export {
  GuestClient,
  GuestTweet,
  GuestUser,
  guestTweetFromData,
  type GuestClientOptions,
  type GuestCommunityNote,
} from './guest/index.js';

// -- models ------------------------------------------------------------------
export { BookmarkFolder } from './models/bookmark.js';
export {
  Community,
  CommunityMember,
  type CommunityCreator,
  type CommunityRule,
} from './models/community.js';
export { Place, placesFromResponse } from './models/geo.js';
export { Group, GroupMessage } from './models/group.js';
export { TwitterList, List } from './models/list.js';
export {
  AnimatedGif,
  Media,
  MEDIA_TYPE_MAPPING,
  Photo,
  Stream,
  Video,
  mediaFromData,
  type MediaType,
} from './models/media.js';
export { Message } from './models/message.js';
export { Notification } from './models/notification.js';
export {
  StreamingSession,
  Topic,
  eventFromData,
  payloadFromData,
  type ConfigEvent,
  type DMTypingEvent,
  type DMUpdateEvent,
  type Payload,
  type StreamEvent,
  type StreamEventType,
  type SubscriptionsEvent,
  type TweetEngagementEvent,
} from './models/streaming.js';
export {
  Location,
  PlaceTrend,
  Trend,
  type PlaceTrends,
} from './models/trend.js';
export {
  CommunityNote,
  Poll,
  ScheduledTweet,
  Tweet,
  TweetTombstone,
  tweetFromData,
  type CommunityNoteSummary,
  type PollChoice,
} from './models/tweet.js';
export { User } from './models/user.js';

// -- captcha -----------------------------------------------------------------
export {
  CaptchaSolver,
  Capsolver,
  parseUnlockHtml,
  type CapsolverOptions,
  type UnlockHTML,
} from './captcha/index.js';

// -- errors ------------------------------------------------------------------
export {
  AccountLocked,
  AccountSuspended,
  BadRequest,
  CouldNotTweet,
  DuplicateTweet,
  ERROR_CODE_TO_EXCEPTION,
  Forbidden,
  InvalidMedia,
  NotFound,
  RequestTimeout,
  ServerError,
  TooManyRequests,
  TweetNotAvailable,
  TwitterException,
  Unauthorized,
  UserNotFound,
  UserUnavailable,
  raiseExceptionsFromResponse,
  type ApiError,
} from './errors.js';

// -- utilities ---------------------------------------------------------------
export {
  Flow,
  Result,
  b64ToStr,
  buildQuery,
  buildTweetData,
  buildUserData,
  findDict,
  findEntryByType,
  flattenParams,
  getQueryId,
  timestampToDate,
  type Fetcher,
  type Filters,
  type SearchOptions,
} from './utils.js';

export { HttpSession, type HttpResponse, type RequestOptions } from './internal/http.js';
export { detectMediaType, type DetectedType } from './internal/mediaType.js';
export { parseM3U8, type M3U8Playlist } from './internal/m3u8.js';
export { parseWebVTT, type Caption, type WebVTT } from './internal/webvtt.js';

// -- low-level ---------------------------------------------------------------
export { ClientTransaction } from './transaction/index.js';
export { solveUiMetrics } from './uiMetrics/index.js';
export * as constants from './constants.js';
