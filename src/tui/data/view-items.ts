import { basicUserItem, historyTopicItem, recentPostItem, topicItem } from "./items.js";
import { renderUserGenderPrefix } from "./user-gender.js";
import { asArray, asNumber, asObject, formatTime, normalizeInlineText, normalizePreview, timestampOf } from "./utils.js";
import type { ContentItem, NoticeType, TuiState } from "../tui-model.js";
import { CachedCc98Client } from "../cached-client.js";
import { renderUbbToLines } from "../media/ubb-renderer.js";

export async function loadChatUserNames(
  client: CachedCc98Client,
  chats: unknown[],
  force: boolean,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const ids = chats
    .map((chat) => asNumber(asObject(chat).userId ?? asObject(chat).UserId))
    .filter((id): id is number => id !== undefined);
  const uniqueIds = [...new Set(ids)];
  const userNames = new Map<number, string>();

  try {
    const users = asArray(await client.getBasicUsers(uniqueIds, force, signal));
    for (const userRaw of users) {
      const user = asObject(userRaw);
      const id = asNumber(user.id ?? user.Id);
      if (id === undefined) {
        continue;
      }
      userNames.set(id, String(user.name ?? user.Name ?? `#${id}`));
    }
  } catch {
    // Fall through to per-user resolution below.
  }

  const missingIds = uniqueIds.filter((id) => !userNames.has(id));
  await mapLimit(missingIds, 3, async (id) => {
    try {
      const users = asArray(await client.getBasicUsers([id], force, signal));
      const user = asObject(users[0]);
      const resolvedId = asNumber(user.id ?? user.Id) ?? id;
      userNames.set(resolvedId, String(user.name ?? user.Name ?? `#${resolvedId}`));
    } catch {
      userNames.set(id, `ID不存在 #${id}`);
    }
  });

  return userNames;
}

export async function loadChatUnreadCounts(
  client: CachedCc98Client,
  chats: unknown[],
  force: boolean,
  signal?: AbortSignal
): Promise<Map<number, number>> {
  const candidates = chats
    .map((chat) => asObject(chat))
    .map((chat) => asNumber(chat.userId ?? chat.UserId))
    .filter((id): id is number => id !== undefined);

  const counts = new Map<number, number>();
  await mapLimit([...new Set(candidates)], 3, async (userId) => {
    try {
      const messages = asArray(await client.getChatHistory(userId, 0, 30, force, signal));
      const unreadCount = messages.reduce<number>((total, messageRaw) => {
        const message = asObject(messageRaw);
        const senderId = asNumber(message.senderId ?? message.SenderId);
        const isRead = message.isRead ?? message.IsRead;
        return total + (senderId === userId && isRead === false ? 1 : 0);
      }, 0);
      counts.set(userId, unreadCount);
    } catch {
      counts.set(userId, 0);
    }
  });

  return counts;
}

export function chatItem(value: unknown, userNames: Map<number, string>, unreadCounts?: Map<number, number>): ContentItem {
  const chat = asObject(value);
  const userId = asNumber(chat.userId ?? chat.UserId);
  const name = userId !== undefined ? userNames.get(userId) : undefined;
  const unreadCount = userId !== undefined
    ? unreadCounts?.get(userId) ?? extractChatUnreadCount(chat)
    : extractChatUnreadCount(chat);
  const unread = unreadCount > 0;
  return {
    title: String(name ?? chat.name ?? chat.userName ?? userId ?? "私信"),
    meta: userId !== undefined ? `user #${userId}` : undefined,
    detail: normalizePreview(String(chat.lastContent ?? chat.lastMessage ?? chat.content ?? "")),
    chatUserId: userId,
    unread,
    unreadCount
  };
}

export function hasUnreadChatItem(items: ContentItem[]): boolean {
  return items.some((item) => item.chatUserId !== undefined && (item.unread || (item.unreadCount ?? 0) > 0));
}

export function chatMessageItems(
  messages: unknown[],
  otherName: string,
  otherUserId: number,
  width?: number
): ContentItem[] {
  const renderWidth = width ?? 80;
  return [...messages].reverse().map((messageRaw) => {
    const message = asObject(messageRaw);
    const receiverId = asNumber(message.receiverId ?? message.ReceiverId);
    const isMine = receiverId === otherUserId;
    const time = typeof message.time === "string"
      ? message.time.replace("T", " ").slice(0, 16)
      : "";
    const rawContent = String(message.content ?? message.Content ?? "");
    const content = normalizeInlineText(rawContent);
    const rendered = rawContent ? renderUbbToLines(rawContent, renderWidth) : undefined;
    return {
      title: isMine ? `我 -> ${otherName}` : `${otherName} -> 我`,
      meta: [time, receiverId !== undefined ? `receiver #${receiverId}` : undefined].filter(Boolean).join(" · "),
      detail: content || "(空消息)",
      chatContent: rendered
        ? {
            lines: rendered.lines,
            images: rendered.images,
            previews: new Array(rendered.images.length)
          }
        : undefined
    };
  });
}

function extractChatUnreadCount(chat: Record<string, unknown>): number {
  const rawCount = asNumber(
    chat.unreadCount
    ?? chat.UnreadCount
    ?? chat.messageCount
    ?? chat.MessageCount
    ?? chat.count
    ?? chat.Count
  );
  if (rawCount !== undefined && rawCount > 0) {
    return rawCount;
  }
  return (chat.isRead ?? chat.IsRead) === false ? 1 : 0;
}

export function buildUserProfileItems(profile: Record<string, unknown>): ContentItem[] {
  const userId = asNumber(profile.id);
  const name = String(profile.name ?? profile.userName ?? (userId !== undefined ? `#${userId}` : "用户")).trim() || "用户";
  const group = String(profile.displayTitle ?? profile.privilege ?? profile.levelTitle ?? "").trim();
  const introduction = normalizePreview(String(profile.introduction ?? ""));
  const title = `${renderUserGenderPrefix(profile)}${name}`;

  return [
    {
      title,
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
      ? "个人主页：n/Space 更多主题  Esc/Backspace 返回"
      : "个人主页：Esc/Backspace 返回";
  }
  const action = state.currentUser?.isFollowed ? "a 取关" : "a 关注";
  const messageAction = "s 私信";
  return state.currentUser?.hasMore
    ? `用户页：${action}  ${messageAction}  n/Space 更多主题  Esc/Backspace 返回`
    : `用户页：${action}  ${messageAction}  Esc/Backspace 返回`;
}

export function unreadStats(value: Record<string, unknown>): ContentItem[] {
  return [
    item("系统", value.systemCount),
    item("@", value.atCount),
    item("回复", value.replyCount),
    item("私信", value.messageCount)
  ];
}

export function notificationCategoryItems(value: Record<string, unknown>): ContentItem[] {
  return [
    noticeCategoryItem("reply", "回复通知", value.replyCount, "别人回复了你的主题或帖子"),
    noticeCategoryItem("at", "@通知", value.atCount, "别人提到了你"),
    noticeCategoryItem("system", "系统通知", value.systemCount, "系统公告和个人系统消息")
  ];
}

export function noticeItems(type: NoticeType, values: unknown[]): ContentItem[] {
  switch (type) {
    case "reply":
      return values.map((value) => replyNoticeItem(value));
    case "at":
      return values.map((value) => atNoticeItem(value));
    case "system":
      return values.map((value) => systemNoticeItem(value));
  }
}

export async function loadNoticeItems(
  client: CachedCc98Client,
  type: NoticeType,
  values: unknown[],
  force: boolean,
  signal?: AbortSignal
): Promise<ContentItem[]> {
  if (type === "system") {
    return noticeItems(type, values);
  }

  const notices = values.map((value) => asObject(value));
  const topicIds = [...new Set(
    notices
      .map((notice) => asNumber(notice.topicId ?? notice.TopicId))
      .filter((id): id is number => id !== undefined)
  )];
  const topics = topicIds.length > 0 ? asArray(await client.getBasicTopics(topicIds, force, signal)) : [];
  const topicMap = new Map<number, Record<string, unknown>>();
  for (const topicRaw of topics) {
    const topic = asObject(topicRaw);
    const topicId = asNumber(topic.id ?? topic.Id);
    if (topicId !== undefined) {
      topicMap.set(topicId, topic);
    }
  }

  const boardIds = [...new Set(
    notices.map((notice) => {
      const topicId = asNumber(notice.topicId ?? notice.TopicId);
      const topic = topicId !== undefined ? topicMap.get(topicId) : undefined;
      return asNumber(notice.boardId ?? notice.BoardId ?? topic?.boardId ?? topic?.BoardId);
    }).filter((id): id is number => id !== undefined && id > 0)
  )];
  const boardMap = new Map<number, string>();
  await mapLimit(boardIds, 4, async (boardId) => {
    try {
      const board = asObject(await client.getBoardInfo(boardId, force, signal));
      const boardName = normalizeInlineText(String(board.name ?? board.title ?? "")).trim();
      if (boardName) {
        boardMap.set(boardId, boardName);
      }
    } catch {
      // Leave board name unresolved when the board is gone or inaccessible.
    }
  });

  const enriched = notices.map((notice) => enrichThreadNotice(notice, topicMap, boardMap));
  return type === "reply"
    ? enriched.map((notice) => replyNoticeItem(notice))
    : enriched.map((notice) => atNoticeItem(notice));
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
    case "following-board": {
      const topics = asArray(await client.getCustomBoardTopics(feed.loaded, feed.size + 1, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "following-user": {
      const topics = asArray(await client.getFolloweeTopics(feed.loaded, feed.size + 1, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "following-favorite": {
      const topics = asArray(await client.getFavoriteUpdates(feed.loaded, feed.size + 1, force, signal));
      return { items: topics.slice(0, feed.size).map((topic) => topicItem(topic)), received: topics.length };
    }
    case "notifications-system": {
      const notices = asArray(await client.getNotices("system", feed.loaded, feed.size + 1, force, signal));
      return { items: await loadNoticeItems(client, "system", notices.slice(0, feed.size), force, signal), received: notices.length };
    }
    case "notifications-at": {
      const notices = asArray(await client.getNotices("at", feed.loaded, feed.size + 1, force, signal));
      return { items: await loadNoticeItems(client, "at", notices.slice(0, feed.size), force, signal), received: notices.length };
    }
    case "notifications-reply": {
      const notices = asArray(await client.getNotices("reply", feed.loaded, feed.size + 1, force, signal));
      return { items: await loadNoticeItems(client, "reply", notices.slice(0, feed.size), force, signal), received: notices.length };
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
      const users = asArray(await client.getUsers(ids));
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

function noticeCategoryItem(type: NoticeType, title: string, unread: unknown, detail: string): ContentItem {
  const count = typeof unread === "number" ? unread : Number(unread ?? 0);
  return {
    title,
    meta: count > 0 ? `${count} 条未读` : "已读完",
    detail,
    action: `notice.${type}`,
    unread: count > 0,
    unreadCount: Math.max(0, count)
  };
}

function replyNoticeItem(value: unknown): ContentItem {
  const notice = asObject(value);
  const topicId = asNumber(notice.topicId ?? notice.TopicId);
  const boardId = asNumber(notice.boardId ?? notice.BoardId);
  const userId = asNumber(notice.userId ?? notice.UserId);
  const boardTitle = normalizeInlineText(String(notice.boardName ?? notice.BoardName ?? "")).trim();
  const userName = normalizeInlineText(String(notice.userName ?? notice.UserName ?? "")).trim() || "有人";
  const topicTitle = normalizeInlineText(String(
    notice.topicTitle
    ?? notice.TopicTitle
    ?? "未知主题（该主题已被删除或者无权限获取）"
  )).trim();
  const floor = asNumber(notice.floor ?? notice.Floor);
  const isRead = notice.isRead ?? notice.IsRead;

  return {
    title: topicTitle || `${userName} 回复了你`,
    meta: [
      "回复通知",
      userName,
      boardTitle || undefined,
      floor !== undefined ? `#${floor} 楼` : undefined,
      formatTime(notice.time ?? notice.Time)
    ].filter(Boolean).join(" · "),
    detail: `${userName} 回复了你`,
    topicId,
    boardId,
    boardTitle: boardTitle || undefined,
    userId,
    sortTime: timestampOf(notice.time ?? notice.Time),
    unread: isRead === false
  };
}

function atNoticeItem(value: unknown): ContentItem {
  const notice = asObject(value);
  const topicId = asNumber(notice.topicId ?? notice.TopicId);
  const boardId = asNumber(notice.boardId ?? notice.BoardId);
  const userId = asNumber(notice.userId ?? notice.UserId);
  const boardTitle = normalizeInlineText(String(notice.boardName ?? notice.BoardName ?? "")).trim();
  const userName = normalizeInlineText(String(notice.userName ?? notice.UserName ?? "")).trim() || "有人";
  const topicTitle = normalizeInlineText(String(
    notice.topicTitle
    ?? notice.TopicTitle
    ?? "未知主题（该主题已被删除或者无权限获取）"
  )).trim();
  const floor = asNumber(notice.floor ?? notice.Floor);
  const isRead = notice.isRead ?? notice.IsRead;

  return {
    title: topicTitle || `${userName} @了你`,
    meta: [
      "@通知",
      userName,
      boardTitle || undefined,
      floor !== undefined ? `#${floor} 楼` : undefined,
      formatTime(notice.time ?? notice.Time)
    ].filter(Boolean).join(" · "),
    detail: `${userName} 在帖子里提到了你`,
    topicId,
    boardId,
    boardTitle: boardTitle || undefined,
    userId,
    sortTime: timestampOf(notice.time ?? notice.Time),
    unread: isRead === false
  };
}

function systemNoticeItem(value: unknown): ContentItem {
  const notice = asObject(value);
  const topicId = asNumber(notice.topicId ?? notice.TopicId);
  const title = normalizeInlineText(String(notice.title ?? notice.Title ?? "系统通知")).trim() || "系统通知";
  const content = normalizePreview(String(notice.content ?? notice.Content ?? ""));
  const floor = asNumber(notice.floor ?? notice.Floor);
  const isRead = notice.isRead ?? notice.IsRead;

  return {
    title,
    meta: [
      "系统通知",
      floor !== undefined ? `#${floor} 楼` : undefined,
      formatTime(notice.time ?? notice.Time)
    ].filter(Boolean).join(" · "),
    detail: content || "查看系统通知详情",
    topicId,
    sortTime: timestampOf(notice.time ?? notice.Time),
    unread: isRead === false
  };
}

function enrichThreadNotice(
  notice: Record<string, unknown>,
  topicMap: Map<number, Record<string, unknown>>,
  boardMap: Map<number, string>
): Record<string, unknown> {
  const topicId = asNumber(notice.topicId ?? notice.TopicId);
  const topic = topicId !== undefined ? topicMap.get(topicId) : undefined;
  const postBasicInfo = asObject(notice.postBasicInfo ?? notice.PostBasicInfo);
  const boardId = asNumber(notice.boardId ?? notice.BoardId ?? topic?.boardId ?? topic?.BoardId);
  const boardName = normalizeInlineText(String(
    notice.boardName
    ?? notice.BoardName
    ?? topic?.boardName
    ?? topic?.BoardName
    ?? (boardId !== undefined ? boardMap.get(boardId) : "")
  )).trim();
  const topicTitle = normalizeInlineText(String(
    notice.topicTitle
    ?? notice.TopicTitle
    ?? topic?.title
    ?? topic?.Title
    ?? ""
  )).trim();

  return {
    ...notice,
    boardId,
    boardName: boardName || undefined,
    topicTitle: topicTitle || undefined,
    floor: notice.floor ?? notice.Floor ?? postBasicInfo.floor ?? postBasicInfo.Floor ?? (topicId ? 1 : undefined),
    userId: notice.userId ?? notice.UserId ?? postBasicInfo.userId ?? postBasicInfo.UserId ?? -1,
    userName: notice.userName ?? notice.UserName ?? postBasicInfo.userName ?? postBasicInfo.UserName ?? "有人"
  };
}
