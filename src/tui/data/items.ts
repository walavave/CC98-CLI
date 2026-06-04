import type { ContentItem } from "../tui-model.js";
import {
  asNumber,
  asObject,
  formatTime,
  normalizeInlineText,
  normalizePreview,
  timestampOf
} from "./utils.js";

export function topicItem(value: unknown, fallbackBoard?: ContentItem): ContentItem {
  const topic = asObject(value);
  const topicId = asNumber(topic.id ?? topic.Id);
  const boardId = asNumber(topic.boardId ?? topic.BoardId) ?? fallbackBoard?.boardId;
  const boardName = topic.boardName ?? topic.BoardName ?? fallbackBoard?.title;
  const authorName = normalizeInlineText(String(topic.userName ?? topic.authorName ?? "")).trim() || "匿名";
  return {
    title: normalizeInlineText(String(topic.title ?? topic.Title ?? `#${topicId ?? ""}`)),
    meta: [
      boardName,
      authorName,
      topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
      topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
    ]
      .filter(Boolean)
      .join(" · "),
    detail: typeof topic.lastPostContent === "string" ? topic.lastPostContent.replace(/\s+/g, " ") : undefined,
    topicId,
    boardId,
    sortTime: timestampOf(topic.lastPostTime ?? topic.updateTime ?? topic.time ?? topic.createTime)
  };
}

export function recentPostItem(value: unknown): ContentItem {
  const post = asObject(value);
  const topicId = asNumber(post.topicId ?? post.TopicId);
  const boardId = asNumber(post.boardId ?? post.BoardId);
  return {
    title: normalizeInlineText(String(post.title ?? post.topicTitle ?? `#${topicId ?? ""}`)),
    meta: [
      post.boardName,
      typeof post.floor === "number" ? `#${post.floor} 楼` : undefined,
      formatTime(post.time)
    ].filter(Boolean).join(" · "),
    detail: normalizePreview(String(post.content ?? "")),
    topicId,
    boardId,
    sortTime: timestampOf(post.time)
  };
}

export function historyTopicItem(value: unknown): ContentItem {
  const record = asObject(value);
  const topicId = asNumber(record.topicId ?? record.id ?? record.TopicId);
  const boardId = asNumber(record.boardId ?? record.BoardId);
  return {
    title: normalizeInlineText(String(record.title ?? record.topicTitle ?? `#${topicId ?? ""}`)),
    meta: [
      record.boardName,
      formatTime(record.time ?? record.lastViewTime ?? record.updateTime)
    ].filter(Boolean).join(" · "),
    detail: normalizePreview(String(record.content ?? record.lastPostContent ?? "")),
    topicId,
    boardId,
    sortTime: timestampOf(record.time ?? record.lastViewTime ?? record.updateTime)
  };
}

export function basicUserItem(value: unknown): ContentItem {
  const user = asObject(value);
  const userId = asNumber(user.id ?? user.Id);
  return {
    title: String(user.name ?? user.userName ?? (userId !== undefined ? `#${userId}` : "用户")),
    meta: userId !== undefined ? `user #${userId}` : undefined,
    detail: typeof user.introduction === "string" ? normalizePreview(user.introduction) : undefined,
    userId
  };
}
