import { CachedCc98Client } from "../cached-client.js";
import type { ContentItem, FeedListState, ViewId } from "../tui-model.js";
import { settingsItems } from "../tui-model.js";
import { topicItem } from "./items.js";
import { initialSearchStatus } from "./search.js";
import { asArray, asNumber, asObject } from "./utils.js";
import {
  chatItem,
  flattenBoards,
  loadChatUserNames,
  mapLimit,
  notificationCategoryItems,
  noticeItems,
  overviewStats
} from "./view-items.js";

export async function loadView(
  client: CachedCc98Client,
  view: ViewId,
  force: boolean,
  signal?: AbortSignal
): Promise<{
  title: string;
  items: ContentItem[];
  overview?: ContentItem[];
  status?: string;
  feed?: FeedListState;
}> {
  switch (view) {
    case "hot": {
      const [index, unread] = await Promise.all([
        client.getForumIndex(force, signal),
        client.getUnreadCount(force, signal)
      ]);
      const indexObject = asObject(index);
      const unreadObject = asObject(unread);
      const hotTopics = asArray(indexObject.hotTopic ?? indexObject.manualHotTopic);
      return {
        title: "十大",
        items: hotTopics.map((topic) => topicItem(topic)),
        overview: overviewStats(indexObject, unreadObject)
      };
    }
    case "new": {
      const size = 12;
      const topics = asArray(await client.getNewTopics(0, size + 1, force, signal));
      const items = topics.slice(0, size).map((topic) => topicItem(topic));
      const hasMore = topics.length > size;
      return {
        title: "最新",
        items,
        feed: {
          kind: "new",
          title: "最新",
          loaded: items.length,
          size,
          hasMore
        },
        status: hasMore
          ? "最新：j/k 选择  l 打开帖子  n/Space 更多  h 返回  r 刷新"
          : "最新：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "search":
      return {
        title: "搜索",
        items: [],
        status: initialSearchStatus("topic")
      };
    case "boards": {
      const sections = asArray(await client.getAllBoards(force, signal));
      const allBoards = flattenBoards(sections);
      return {
        title: "版面",
        items: allBoards.slice(0, 14),
        status: "版面：j/k 选择  l 进入版面  h 返回  r 刷新"
      };
    }
    case "following": {
      const size = 12;
      const topics = asArray(await client.getFolloweeTopics(0, size + 1, force, signal));
      const items = topics.slice(0, size).map((topic) => topicItem(topic));
      const hasMore = topics.length > size;
      return {
        title: "关注",
        items,
        feed: {
          kind: "following",
          title: "关注",
          loaded: items.length,
          size,
          hasMore
        },
        status: hasMore
          ? "关注：j/k 选择  l 打开帖子  n/Space 更多  h 返回  r 刷新"
          : "关注：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "notifications": {
      const [unreadRaw, replyRaw, atRaw, systemRaw] = await Promise.all([
        client.getUnreadCount(force, signal),
        client.getNotices("reply", 0, 1, force, signal),
        client.getNotices("at", 0, 1, force, signal),
        client.getNotices("system", 0, 1, force, signal)
      ]);
      const unreadObject = asObject(unreadRaw);
      const items = notificationCategoryItems(unreadObject);
      const previews = new Map([
        ["reply", noticeItems("reply", asArray(replyRaw)).at(0)],
        ["at", noticeItems("at", asArray(atRaw)).at(0)],
        ["system", noticeItems("system", asArray(systemRaw)).at(0)]
      ]);
      return {
        title: "通知",
        items: items.map((item) => {
          const action = item.action?.replace(/^notice\./, "");
          const preview = action ? previews.get(action) : undefined;
          return {
            ...item,
            detail: preview?.title ?? item.detail
          };
        }),
        status: "通知：j/k 选择  l 查看列表  h 返回  r 刷新"
      };
    }
    case "favorite": {
      const [meRaw, sectionsRaw] = await Promise.all([
        client.getMe(force, signal),
        client.getAllBoards(false, signal)
      ]);
      const customBoards = asArray(asObject(meRaw).customBoards).filter((id): id is number => typeof id === "number");
      const allBoards = flattenBoards(asArray(sectionsRaw));
      const boardById = new Map(allBoards.filter((board) => board.boardId !== undefined).map((board) => [board.boardId, board]));
      const topicGroups = await mapLimit(customBoards, 3, async (boardId) => {
        const board = boardById.get(boardId);
        const topics = asArray(await client.getBoardTopics(boardId, 0, 3, false, force, signal));
        return topics.map((topic) => topicItem(topic, board));
      });
      const items = topicGroups.flat().sort((left, right) => (right.sortTime ?? 0) - (left.sortTime ?? 0)).slice(0, 18);
      return {
        title: "收藏",
        items,
        status: "收藏：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "messages": {
      const size = 10;
      const [unread, recent] = await Promise.all([
        client.getUnreadCount(force, signal),
        client.getRecentChats(0, size + 1, force, signal)
      ]);
      const unreadObject = asObject(unread);
      const chats = asArray(recent);
      const visibleChats = chats.slice(0, size);
      const userNames = await loadChatUserNames(client, chats, force, signal);
      const messageCount = typeof unreadObject.messageCount === "number" ? unreadObject.messageCount : 0;
      const unreadItems = messageCount > 0
        ? [{ title: "未读私信", detail: String(messageCount) }]
        : [];
      const chatItems = visibleChats.length > 0
        ? visibleChats.map((chat) => chatItem(chat, userNames))
        : [{ title: "暂无最近私信", meta: "recent-contact-users" }];
      return {
        title: "消息",
        items: [...unreadItems, ...chatItems],
        feed: {
          kind: "messages",
          title: "消息",
          loaded: visibleChats.length,
          size,
          hasMore: chats.length > size
        },
        status: chats.length > size
          ? "消息：j/k 选择  l 打开会话  n/Space 更多联系人  h 返回  r 刷新"
          : "消息：j/k 选择  l 打开会话  h 返回  r 刷新"
      };
    }
    case "me": {
      const meObject = asObject(await client.getMe(force, signal));
      return {
        title: "我的",
        items: [
          {
            title: "个人主页",
            detail: String(meObject.name ?? meObject.id ?? "打开当前账号的用户页"),
            action: "me.profile"
          },
          { title: "我的收藏", detail: "查看已收藏的主题", action: "me.favorites" },
          { title: "我的回复", detail: "查看最近回复的帖子", action: "me.replies" },
          { title: "我的足迹", detail: "查看浏览记录", action: "me.history" },
          { title: "我的粉丝", detail: "查看关注你的用户", action: "me.fans" }
        ],
        status: "我的：j/k 选择  l 进入  h 返回  r 刷新"
      };
    }
    case "settings":
      return {
        title: "设置",
        items: settingsItems,
        status: "设置：j/k 选择  l 执行  h 返回"
      };
  }
}
