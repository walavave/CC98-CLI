import { basicUserItem, historyTopicItem, recentPostItem, topicItem } from "./items.js";
import { asArray, asNumber, asObject, formatTime, normalizeInlineText, normalizePreview } from "./utils.js";
import type { ContentItem, TuiState } from "../tui-model.js";
import { CachedCc98Client } from "../cached-client.js";

export async function loadChatUserNames(
  client: CachedCc98Client,
  chats: unknown[],
  force: boolean,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const ids = chats
    .map((chat) => asNumber(asObject(chat).userId ?? asObject(chat).UserId))
    .filter((id): id is number => id !== undefined);
  const users = asArray(await client.getBasicUsers(ids, force, signal));
  return new Map(users.map((userRaw) => {
    const user = asObject(userRaw);
    const id = asNumber(user.id ?? user.Id);
    const name = String(user.name ?? user.Name ?? (id !== undefined ? `#${id}` : "用户"));
    return [id, name] as const;
  }).filter((entry): entry is readonly [number, string] => entry[0] !== undefined));
}

export function chatItem(value: unknown, userNames: Map<number, string>): ContentItem {
  const chat = asObject(value);
  const userId = asNumber(chat.userId ?? chat.UserId);
  const name = userId !== undefined ? userNames.get(userId) : undefined;
  return {
    title: String(name ?? chat.name ?? chat.userName ?? userId ?? "私信"),
    meta: userId !== undefined ? `user #${userId}` : undefined,
    detail: normalizePreview(String(chat.lastContent ?? chat.lastMessage ?? chat.content ?? "")),
    chatUserId: userId
  };
}

export function chatMessageItems(messages: unknown[], otherName: string, otherUserId: number): ContentItem[] {
  return [...messages].reverse().map((messageRaw) => {
    const message = asObject(messageRaw);
    const receiverId = asNumber(message.receiverId ?? message.ReceiverId);
    const isMine = receiverId === otherUserId;
    const time = typeof message.time === "string"
      ? message.time.replace("T", " ").slice(0, 16)
      : "";
    const content = normalizeInlineText(String(message.content ?? message.Content ?? ""));
    return {
      title: isMine ? `我 -> ${otherName}` : `${otherName} -> 我`,
      meta: [time, receiverId !== undefined ? `receiver #${receiverId}` : undefined].filter(Boolean).join(" · "),
      detail: content || "(空消息)"
    };
  });
}

export function buildUserProfileItems(profile: Record<string, unknown>): ContentItem[] {
  const userId = asNumber(profile.id);
  const name = String(profile.name ?? profile.userName ?? (userId !== undefined ? `#${userId}` : "用户")).trim() || "用户";
  const group = String(profile.displayTitle ?? profile.privilege ?? profile.levelTitle ?? "").trim();
  const introduction = normalizePreview(String(profile.introduction ?? ""));

  return [
    {
      title: name,
      meta: [userId !== undefined ? `#${userId}` : undefined, group || undefined].filter(Boolean).join(" · "),
      detail: introduction || "这个用户没有留下简介。"
    },
    item("发帖数", profile.postCount),
    item("粉丝数", profile.fanCount),
    item("关注数", profile.followCount),
    item("威望", profile.prestige),
    item("财富值", profile.wealth),
    item("风评", profile.popularity),
    item("收到的赞", profile.receivedLikeCount),
    item("注册时间", formatTime(profile.registerTime)),
    item("最后登录", formatTime(profile.lastLogOnTime))
  ];
}

export function describeUserProfileStatus(state: TuiState): string {
  if (state.currentFeed?.kind === "me-profile") {
    return state.currentUser?.hasMore
      ? "个人主页：j/k 浏览  l 打开主题  n/Space 更多主题  Esc/Backspace 返回"
      : "个人主页：j/k 浏览  l 打开主题  Esc/Backspace 返回";
  }
  const action = state.currentUser?.isFollowed ? "a 取关" : "a 关注";
  return state.currentUser?.hasMore
    ? `用户页：j/k 浏览  l 打开主题  ${action}  n/Space 更多主题  Esc/Backspace 返回`
    : `用户页：j/k 浏览  l 打开主题  ${action}  Esc/Backspace 返回`;
}

export function unreadStats(value: Record<string, unknown>): ContentItem[] {
  return [
    item("系统", value.systemCount),
    item("@", value.atCount),
    item("回复", value.replyCount),
    item("私信", value.messageCount)
  ];
}

export function overviewStats(index: Record<string, unknown>, unread: Record<string, unknown>): ContentItem[] {
  const unreadTotal = ["systemCount", "atCount", "replyCount", "messageCount"].reduce((total, key) => {
    const value = unread[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  return [
    item("今日主题", index.todayTopicCount),
    item("今日回复", index.todayCount),
    item("在线", index.onlineUserCount),
    item("用户", index.userCount),
    item("未读", unreadTotal)
  ];
}

export async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function flattenBoards(sections: unknown[]): ContentItem[] {
  const boards: ContentItem[] = [];
  for (const section of sections) {
    const sectionObject = asObject(section);
    const sectionName = String(sectionObject.name ?? sectionObject.title ?? "分区");
    const candidates = [sectionObject.boards, sectionObject.children, sectionObject.boardList];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      for (const board of candidate) {
        const boardObject = asObject(board);
        boards.push({
          title: String(boardObject.name ?? boardObject.title ?? `#${boardObject.id ?? ""}`),
          meta: `${sectionName}${boardObject.id !== undefined ? ` · #${boardObject.id}` : ""}`,
          detail: typeof boardObject.description === "string" ? boardObject.description : undefined,
          boardId: typeof boardObject.id === "number" ? boardObject.id : undefined
        });
      }
    }
  }
  return boards;
}

export async function loadFeedPageItems(
  client: CachedCc98Client,
  feed: NonNullable<TuiState["currentFeed"]>,
  force: boolean,
  signal?: AbortSignal
): Promise<{ items: ContentItem[]; received: number }> {
  switch (feed.kind) {
    case "me-profile":
      return { items: [], received: 0 };
    case "new": {
      const topics = asArray(await client.getNewTopics(feed.loaded, feed.size + 1, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "following": {
      const topics = asArray(await client.getFolloweeTopics(feed.loaded, feed.size + 1, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "messages": {
      const chats = asArray(await client.getRecentChats(feed.loaded, feed.size + 1, force, signal));
      const visibleChats = chats.slice(0, feed.size);
      const userNames = await loadChatUserNames(client, visibleChats, force, signal);
      return { items: visibleChats.map((chat) => chatItem(chat, userNames)), received: chats.length };
    }
    case "me-favorites": {
      const topics = asArray(await client.getFavoriteTopics(feed.loaded, feed.size + 1, 1, 0, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "me-replies": {
      const response = asObject(await client.getRecentPosts(feed.loaded, feed.size + 1, force, signal));
      const posts = asArray(response.data ?? response.posts ?? response);
      return { items: posts.slice(0, feed.size).map((post) => recentPostItem(post)), received: posts.length };
    }
    case "me-history": {
      const response = asObject(await client.getBrowseHistory(feed.loaded, feed.size + 1, force, signal));
      const records = asArray(response.data ?? response.posts ?? response);
      return { items: records.slice(0, feed.size).map((record) => historyTopicItem(record)), received: records.length };
    }
    case "me-fans": {
      const ids = asArray(await client.getFriendIds("follower", feed.loaded, feed.size, force, signal))
        .filter((id): id is number => typeof id === "number");
      const users = asArray(await client.getBasicUsers(ids, force, signal));
      return { items: users.map((user) => basicUserItem(user)), received: ids.length };
    }
  }
}

function item(title: string, value: unknown, meta?: string): ContentItem {
  return {
    title,
    meta,
    detail: value === undefined || value === null ? "-" : String(value)
  };
}
