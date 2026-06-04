import { Cc98Client } from "../api/client.js";
import { CacheStore } from "../storage/cache-store.js";

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;

export class CachedCc98Client {
  readonly cache: CacheStore;

  constructor(
    private readonly client: Cc98Client,
    cache?: CacheStore
  ) {
    this.cache = cache ?? new CacheStore();
  }

  getForumIndex(force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet("forum:index", 30 * second, () => this.client.getForumIndex({ signal }), { force });
  }

  getUnreadCount(force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet("user:unread", 10 * second, () => this.client.getUnreadCount({ signal }), { force });
  }

  getAllBoards(force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet("forum:boards", 24 * hour, () => this.client.getAllBoards({ signal }), { force });
  }

  getBoardInfo(boardId: number, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`board:info:${boardId}`, 24 * hour, () => this.client.getBoardInfo(boardId, { signal }), { force });
  }

  getBoardTopics(boardId: number, from = 0, size = 20, best = false, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `board:topics:${boardId}:${from}:${size}:${best ? "best" : "normal"}`,
      30 * second,
      () => this.client.getBoardTopics(boardId, from, size, best, { signal }),
      { force }
    );
  }

  getNewTopics(from = 0, size = 12, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`topic:new:${from}:${size}`, 20 * second, () => this.client.getNewTopics(from, size, { signal }), { force });
  }

  searchTopics(keyword: string, from = 0, size = 10, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `topic:search:${keyword}:${from}:${size}`,
      20 * second,
      () => this.client.searchTopics(keyword, from, size, { signal }),
      { force }
    );
  }

  getFolloweeTopics(from = 0, size = 12, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`user:followee-topic:${from}:${size}`, 30 * second, () => this.client.getMoment(from, size, { signal }), { force });
  }

  getFavoriteUpdates(from = 0, size = 12, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`user:favorite-updates:${from}:${size}`, 15 * second, () => this.client.getFavoriteUpdates(from, size, { signal }), { force });
  }

  getFavoriteTopics(from = 0, size = 11, order = 1, groupId = 0, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `topic:favorite:${from}:${size}:${order}:${groupId}`,
      20 * second,
      () => this.client.getFavoriteTopics(from, size, order, groupId, { signal }),
      { force }
    );
  }

  getRecentPosts(from = 0, size = 11, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `user:recent-post:${from}:${size}`,
      20 * second,
      () => this.client.getRecentPosts(from, size, { signal }),
      { force }
    );
  }

  getBrowseHistory(from = 0, size = 11, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `user:browse-history:${from}:${size}`,
      20 * second,
      () => this.client.getBrowseHistory(from, size, { signal }),
      { force }
    );
  }

  getFriendIds(type: "follower" | "followee", from = 0, size = 10, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `user:friend-ids:${type}:${from}:${size}`,
      20 * second,
      () => this.client.getFriendIds(type, from, size, { signal }),
      { force }
    );
  }

  getRecentChats(from = 0, size = 10, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`message:recent:${from}:${size}`, 15 * second, () => this.client.getRecentChats(from, size, { signal }), { force });
  }

  getChatHistory(userId: number, from = 0, size = 10, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `message:history:${userId}:${from}:${size}`,
      15 * second,
      () => this.client.getChatHistory(userId, from, size, { signal }),
      { force }
    );
  }

  getBasicUsers(ids: number[], force = false, signal?: AbortSignal): Promise<unknown> {
    const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
    if (uniqueIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.cache.getOrSet(`user:basic:${uniqueIds.join(",")}`, 10 * minute, () => this.client.getBasicUsers(uniqueIds, { signal }), { force });
  }

  getMe(force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet("user:me", 60 * second, () => this.client.getMe({ signal }), { force });
  }

  getUserProfile(userId: number, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`user:profile:${userId}`, 60 * second, () => this.client.getUserProfile(userId, { signal }), { force });
  }

  getUserFollowState(userId: number, force = false): Promise<unknown> {
    return this.cache.getOrSet(`user:follow-state:${userId}`, 10 * second, () => this.client.isUserFollowed(userId), { force });
  }

  getRecentTopics(userId: number | undefined, from = 0, size = 11, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `user:recent-topic:${userId ?? "me"}:${from}:${size}`,
      30 * second,
      () => this.client.getRecentTopics(userId, from, size, { signal }),
      { force }
    );
  }

  getTopic(topicId: number, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(`topic:meta:${topicId}`, 60 * second, () => this.client.getTopic(topicId, { signal }), { force });
  }

  getTopicFavoriteState(topicId: number, force = false): Promise<unknown> {
    return this.cache.getOrSet(`topic:favorite-state:${topicId}`, 10 * second, () => this.client.isTopicFavorite(topicId), { force });
  }

  getTopicPosts(topicId: number, from = 0, size = 10, force = false, signal?: AbortSignal): Promise<unknown> {
    const ttl = from === 0 ? 60 * second : 10 * minute;
    return this.cache.getOrSet(
      `topic:posts:${topicId}:${from}:${size}`,
      ttl,
      () => this.client.getTopicPosts(topicId, from, size, { signal }),
      { force }
    );
  }

  getPostReactionState(postId: number, force = false, signal?: AbortSignal): Promise<unknown> {
    return this.cache.getOrSet(
      `post:reaction-state:${postId}`,
      10 * second,
      () => this.client.getPostReactionState(postId),
      { force }
    );
  }

  async reactToPost(postId: number, isLike: boolean): Promise<unknown> {
    const result = await this.client.reactToPost(postId, isLike);
    await this.cache.delete(`post:reaction-state:${postId}`);
    return result;
  }

  async favoriteTopic(topicId: number): Promise<unknown> {
    const result = await this.client.favoriteTopic(topicId);
    await this.cache.delete(`topic:favorite-state:${topicId}`);
    return result;
  }

  async unfavoriteTopic(topicId: number): Promise<unknown> {
    const result = await this.client.unfavoriteTopic(topicId);
    await this.cache.delete(`topic:favorite-state:${topicId}`);
    return result;
  }

  async followUser(userId: number): Promise<unknown> {
    const result = await this.client.followUser(userId);
    await this.cache.delete(`user:follow-state:${userId}`);
    await this.cache.delete(`user:profile:${userId}`);
    return result;
  }

  async unfollowUser(userId: number): Promise<unknown> {
    const result = await this.client.unfollowUser(userId);
    await this.cache.delete(`user:follow-state:${userId}`);
    await this.cache.delete(`user:profile:${userId}`);
    return result;
  }

  async sendMessage(userId: number, content: string): Promise<unknown> {
    const result = await this.client.sendMessage(userId, content);
    await this.cache.delete(`message:history:${userId}:0:10`);
    await this.cache.delete(`message:history:${userId}:0:20`);
    await this.cache.delete(`message:recent:0:10`);
    return result;
  }

  replyTopic(topicId: number, content: string, parentId?: number): Promise<unknown> {
    return this.client.replyTopic(topicId, content, parentId);
  }

  /**
   * Clear all caches (memory + file)
   */
  async clearCache(): Promise<void> {
    await this.cache.clearAll();
  }

  /**
   * Run cache cleanup and return statistics
   */
  async cleanupCache(): Promise<{ removed: number; kept: number }> {
    return this.cache.cleanupFileCache();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    memoryEntries: number;
    inflightRequests: number;
    fileCacheEntries: number;
  }> {
    return this.cache.getStats();
  }
}
