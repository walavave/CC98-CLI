import type { FeedListState } from "../tui-model.js";

export function describeFeedStatus(feed: FeedListState): string {
  switch (feed.kind) {
    case "me-profile":
      return feed.hasMore
        ? "个人主页：n/Space 更多主题  Esc/Backspace 返回  h 返回左栏"
        : "个人主页：Esc/Backspace 返回  h 返回左栏";
    case "new":
      return feed.hasMore
        ? "最新：j/k 选择  l 打开帖子  n/Space 更多  h 返回  r 刷新"
        : "最新：j/k 选择  l 打开帖子  h 返回  r 刷新";
    case "following-board":
      return feed.hasMore
        ? "关注版面：j/k 选择  l 打开帖子  n/Space 更多  上键切换标签  h 返回"
        : "关注版面：j/k 选择  l 打开帖子  上键切换标签  h 返回";
    case "following-user":
      return feed.hasMore
        ? "关注用户：j/k 选择  l 打开帖子  n/Space 更多  上键切换标签  h 返回"
        : "关注用户：j/k 选择  l 打开帖子  上键切换标签  h 返回";
    case "following-favorite":
      return feed.hasMore
        ? "关注收藏：j/k 选择  l 打开帖子  n/Space 更多  上键切换标签  h 返回"
        : "关注收藏：j/k 选择  l 打开帖子  上键切换标签  h 返回";
    case "notifications-system":
      return feed.hasMore
        ? "系统通知：j/k 选择  l 打开关联内容  n/Space 更多  Esc/Backspace 返回  h 返回左栏  r 刷新"
        : "系统通知：j/k 选择  l 打开关联内容  Esc/Backspace 返回  h 返回左栏  r 刷新";
    case "notifications-at":
      return feed.hasMore
        ? "@通知：j/k 选择  l 打开关联内容  n/Space 更多  Esc/Backspace 返回  h 返回左栏  r 刷新"
        : "@通知：j/k 选择  l 打开关联内容  Esc/Backspace 返回  h 返回左栏  r 刷新";
    case "notifications-reply":
      return feed.hasMore
        ? "回复通知：j/k 选择  l 打开关联内容  n/Space 更多  Esc/Backspace 返回  h 返回左栏  r 刷新"
        : "回复通知：j/k 选择  l 打开关联内容  Esc/Backspace 返回  h 返回左栏  r 刷新";
    case "messages":
      return feed.hasMore
        ? "消息：j/k 选择  l 打开会话  n/Space 更多联系人  h 返回  r 刷新"
        : "消息：j/k 选择  l 打开会话  h 返回  r 刷新";
    case "me-favorites":
      return "我的收藏：d 取消收藏  a 管理分组  s 移动分组";
    case "me-replies":
      return feed.hasMore
        ? "我的回复：j/k 选择  l 打开帖子  n/Space 更多  Esc/Backspace 返回  h 返回左栏"
        : "我的回复：j/k 选择  l 打开帖子  Esc/Backspace 返回  h 返回左栏";
    case "me-history":
      return feed.hasMore
        ? "我的足迹：j/k 选择  l 打开帖子  n/Space 更多  Esc/Backspace 返回  h 返回左栏"
        : "我的足迹：j/k 选择  l 打开帖子  Esc/Backspace 返回  h 返回左栏";
    case "me-fans":
      return feed.hasMore
        ? "我的粉丝：j/k 选择  l 打开用户页  n/Space 更多  Esc/Backspace 返回  h 返回左栏"
        : "我的粉丝：j/k 选择  l 打开用户页  Esc/Backspace 返回  h 返回左栏";
  }
}
