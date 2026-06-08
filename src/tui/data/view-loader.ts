import { CachedCc98Client } from "../cached-client.js";
import type { ContentItem, FeedListState, FollowingListState, ViewId } from "../tui-model.js";
import { settingsItems } from "../tui-model.js";
import { topicItem } from "./items.js";
import { initialSearchStatus } from "./search.js";
import { asArray, asObject } from "./utils.js";
import {
  chatItem,
  flattenBoards,
  hasUnreadChatItem,
  loadChatUnreadCounts,
  loadChatUserNames,
  loadNoticeItems,
  notificationCategoryItems,
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
  following?: FollowingListState;
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
      const topics = asArray(await client.getCustomBoardTopics(0, size + 1, force, signal));
      const items = topics.slice(0, size).map((topic) => topicItem(topic));
      const hasMore = topics.length > size;
      return {
        title: "关注",
        items,
        feed: {
          kind: "following-board",
          title: "关注",
          loaded: items.length,
          size,
          hasMore
        },
        following: {
          title: "关注",
          kind: "board",
          loaded: items.length,
          size,
          hasMore,
          focus: "tabs"
        },
        status: hasMore
          ? "关注版面：j/k 选择  l 打开帖子  n/Space 更多  上键切换标签  h 返回"
          : "关注版面：j/k 选择  l 打开帖子  上键切换标签  h 返回"
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
      const [replyPreviewItems, atPreviewItems, systemPreviewItems] = await Promise.all([
        loadNoticeItems(client, "reply", asArray(replyRaw), force, signal),
        loadNoticeItems(client, "at", asArray(atRaw), force, signal),
        loadNoticeItems(client, "system", asArray(systemRaw), force, signal)
      ]);
      const previews = new Map([
        ["reply", replyPreviewItems.at(0)],
        ["at", atPreviewItems.at(0)],
        ["system", systemPreviewItems.at(0)]
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
    case "messages": {
      const size = 10;
      const unread = asObject(await client.getUnreadCount(force, signal));
      const hasUnreadMessages = typeof unread.messageCount === "number" && unread.messageCount > 0;
      const recent = await client.getRecentChats(0, size + 1, force || hasUnreadMessages, signal);
      const chats = asArray(recent);
      const visibleChats = chats.slice(0, size);
      const userNames = await loadChatUserNames(client, chats, force, signal);
      let chatItems = visibleChats.length > 0
        ? visibleChats.map((chat) => chatItem(chat, userNames))
        : [{ title: "暂无最近私信", meta: "recent-contact-users" }];
      if (hasUnreadMessages && !hasUnreadChatItem(chatItems)) {
        const unreadCounts = await loadChatUnreadCounts(client, visibleChats, force, signal);
        chatItems = visibleChats.map((chat) => chatItem(chat, userNames, unreadCounts));
      }
      return {
        title: "消息",
        items: chatItems,
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
