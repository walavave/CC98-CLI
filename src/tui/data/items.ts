import type { ContentItem } from "../tui-model.js";
import { renderUserGenderPrefix } from "./user-gender.js";
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
  const boardName = normalizeInlineText(String(topic.boardName ?? topic.BoardName ?? fallbackBoard?.title ?? "")).trim();
  const authorName = normalizeInlineText(String(topic.userName ?? topic.authorName ?? "")).trim() || "匿名";
  return {
    title: normalizeInlineText(String(topic.title ?? topic.Title ?? `#${topicId ?? ""}`)),
    meta: [
      boardName || undefined,
      authorName,
      topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
      topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
    ]
      .filter(Boolean)
      .join(" · "),
    detail: typeof topic.lastPostContent === "string" ? topic.lastPostContent.replace(/\s+/g, " ") : undefined,
    topicId,
    boardId,
    boardTitle: boardName || undefined,
    sortTime: timestampOf(topic.lastPostTime ?? topic.updateTime ?? topic.time ?? topic.createTime)
  };
}

export function recentPostItem(value: unknown): ContentItem {
  const post = asObject(value);
  const topicId = asNumber(post.topicId ?? post.TopicId);
  const boardId = asNumber(post.boardId ?? post.BoardId);
  const boardTitle = normalizeInlineText(String(post.boardName ?? post.BoardName ?? "")).trim();
  return {
    title: normalizeInlineText(String(post.title ?? post.topicTitle ?? `#${topicId ?? ""}`)),
    meta: [
      boardTitle || undefined,
      typeof post.floor === "number" ? `#${post.floor} 楼` : undefined,
      formatTime(post.time)
    ].filter(Boolean).join(" · "),
    detail: normalizePreview(String(post.content ?? "")),
    topicId,
    boardId,
    boardTitle: boardTitle || undefined,
    sortTime: timestampOf(post.time)
  };
}

export function historyTopicItem(value: unknown): ContentItem {
  const record = asObject(value);
  const topicId = asNumber(record.topicId ?? record.id ?? record.TopicId);
  const boardId = asNumber(record.boardId ?? record.BoardId);
  const boardTitle = normalizeInlineText(String(record.boardName ?? record.BoardName ?? "")).trim();
  return {
    title: normalizeInlineText(String(record.title ?? record.topicTitle ?? `#${topicId ?? ""}`)),
    meta: [
      boardTitle || undefined,
      formatTime(record.time ?? record.lastViewTime ?? record.updateTime)
    ].filter(Boolean).join(" · "),
    detail: normalizePreview(String(record.content ?? record.lastPostContent ?? "")),
    topicId,
    boardId,
    boardTitle: boardTitle || undefined,
    sortTime: timestampOf(record.time ?? record.lastViewTime ?? record.updateTime)
  };
}

export function basicUserItem(value: unknown): ContentItem {
  const user = asObject(value);
  const userId = asNumber(user.id ?? user.Id);
  return {
    title: `${renderUserGenderPrefix(user)}${String(user.name ?? user.userName ?? (userId !== undefined ? `#${userId}` : "用户"))}`,
    meta: userId !== undefined ? `user #${userId}` : undefined,
    detail: typeof user.introduction === "string" ? normalizePreview(user.introduction) : undefined,
    userId
  };
}

export function boardItem(value: unknown): ContentItem {
  const board = asObject(value);
  const boardId = asNumber(board.id ?? board.boardId ?? board.Id ?? board.BoardId);
  const section = String(board.categoryName ?? board.parentName ?? board.sectionName ?? "").trim();
  return {
    title: normalizeInlineText(String(board.name ?? board.title ?? (boardId !== undefined ? `#${boardId}` : "版面"))),
    meta: [section || undefined, boardId !== undefined ? `#${boardId}` : undefined].filter(Boolean).join(" · "),
    detail: typeof board.description === "string" ? normalizePreview(board.description) : undefined,
    boardId
  };
}
