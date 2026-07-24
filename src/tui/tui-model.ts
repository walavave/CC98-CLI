import type {
  AccountModalState,
  ConfirmDialogState,
  LoginFormState
} from "./account-modal.js";

export type ViewId = "hot" | "new" | "search" | "boards" | "following" | "notifications" | "messages" | "me" | "settings";
export type FocusColumn = "nav" | "content";
export type ModalType = "help" | "account" | "login" | "confirm" | "image" | "compose" | "emotion-picker" | "rating" | "hidden-patterns" | null;
export type SearchFocus = "tabs" | "input" | "results";
export type SearchKind = "topic" | "board" | "user" | "board-topic";
export type NoticeType = "system" | "at" | "reply";
export type FollowingFocus = "tabs" | "results";
export type FollowingKind = "board" | "user" | "favorite";

export interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
}

export interface ContentItem {
  title: string;
  meta?: string;
  detail?: string;
  action?: string;
  unread?: boolean;
  unreadCount?: number;
  topicId?: number;
  boardId?: number;
  boardTitle?: string;
  chatUserId?: number;
  userId?: number;
  sortTime?: number;
  /** UBB/MD rendered content for chat messages */
  chatContent?: {
    lines: string[];
    images: string[];
    /** Terminal image preview data, parallel to images. Undefined = not loaded */
    previews: Array<{ token: string; rows: number } | undefined>;
  };
}

export interface TuiState {
  mode: "list" | "topic" | "settings";
  focus: FocusColumn;
  navIndex: number;
  itemIndex: number;
  scroll: number;
  topicViewportScroll?: number;
  historyLimit: number;
  sidebarWidth?: number;
  draggingSidebarDivider: boolean;
  loading: boolean;
  loadingMore: boolean;
  status: string;
  notification?: {
    message: string;
    expiresAt: number;
  };
  unreadSummary?: {
    messageCount: number;
    notificationCount: number;
  };
  messageUnreadByUserId: Record<number, number>;
  error?: string;
  account?: string;
  viewTitle: string;
  items: ContentItem[];
  overview: ContentItem[];
  history: ViewSnapshot[];
  currentBoard?: BoardListState;
  currentFeed?: FeedListState;
  currentChat?: ChatListState;
  currentSearch?: SearchListState;
  currentFollowing?: FollowingListState;
  currentBoardDirectory?: BoardDirectoryState;
  currentUser?: UserProfileListState;
  topic?: TopicReaderState;
  modal: ModalType;
  accountModal: AccountModalState;
  loginForm: LoginFormState;
  confirmDialog?: ConfirmDialogState;
  imageViewer?: ImageViewerState;
  composeDialog?: ComposeDialogState;
  ratingDialog?: RatingDialogState;
  helpScroll: number;
  hiddenPatternsDialog?: { selectedIndex: number; custom: string; patterns: string[] };
}

export interface ListSnapshot {
  title: string;
  items: ContentItem[];
  itemIndex: number;
  scroll: number;
  status: string;
  currentBoard?: BoardListState;
  currentFeed?: FeedListState;
  currentChat?: ChatListState;
  currentSearch?: SearchListState;
  currentFollowing?: FollowingListState;
  currentBoardDirectory?: BoardDirectoryState;
  currentUser?: UserProfileListState;
}

export interface TopicSnapshot {
  viewTitle: string;
  status: string;
  scroll: number;
  topicViewportScroll?: number;
  topic: TopicReaderState;
  list: ListSnapshot;
}

export type ViewSnapshot =
  | { kind: "list"; value: ListSnapshot }
  | { kind: "topic"; value: TopicSnapshot };

export interface BoardListState {
  boardId: number;
  title?: string;
}

export interface FeedListState {
  kind: "new" | "following-board" | "following-user" | "following-favorite" | "notifications-system" | "notifications-at" | "notifications-reply" | "messages" | "me-profile" | "me-favorites" | "me-replies" | "me-history" | "me-fans";
  title: string;
  loaded: number;
  size: number;
  hasMore: boolean;
}

export interface ChatListState {
  userId: number;
  title: string;
  loaded: number;
  size: number;
  hasMore: boolean;
}

export interface SearchListState {
  title: string;
  kind: SearchKind;
  board?: BoardListState;
  query: string;
  draft: string;
  loaded: number;
  size: number;
  hasMore: boolean;
  searched: boolean;
  focus: SearchFocus;
}

export interface FollowingListState {
  title: string;
  kind: FollowingKind;
  loaded: number;
  size: number;
  hasMore: boolean;
  focus: FollowingFocus;
}

export interface BoardDirectorySection {
  title: string;
  items: ContentItem[];
}

export interface BoardDirectoryState {
  sections: BoardDirectorySection[];
  sectionIndex: number;
  focus: "tabs" | "results";
}

export interface UserProfileListState {
  userId: number;
  title: string;
  loaded: number;
  size: number;
  hasMore: boolean;
  isFollowed: boolean;
}

export interface TopicReaderState {
  topicId: number;
  title: string;
  meta: string;
  board?: BoardListState;
  isFavorite: boolean;
  forceRefresh: boolean;
  lines: string[];
  posts: TopicPostEntry[];
  loaded: number;
  size: number;
  hasMore: boolean;
  imageCount: number;
  linkCount: number;
  floorInput: string;
  vote?: TopicVoteState;
}

export interface ImageViewerState {
  images: string[];
  index: number;
  token?: string;
  renderSize?: {
    columns: number;
    rows: number;
  };
  loading: boolean;
  error?: string;
}

export interface ComposeDialogState {
  target: { kind: "topic"; topicId: number } | { kind: "chat"; userId: number; title: string };
  draft: string;
  draftUnits: string[];
  cursorIndex: number;
  preferredColumn?: number;
  submitting: boolean;
  emotionCategoryIndex: number;
  emotionSelectedIndex: number;
  emotionFocus: "sidebar" | "grid";
}

export interface TopicPostEntry {
  id?: number;
  userId?: number;
  floor?: number;
  isHot?: boolean;
  author: string;
  time: string;
  rawTime: string;
  rawContent: string;
  contentType: number;
  likeCount: number;
  dislikeCount: number;
  likeState: 0 | 1 | 2;
  rating?: string;
  preview: string;
  lineStart: number;
  lineEnd: number;
  imageCount: number;
  linkCount: number;
  images: string[];
  links: string[];
  lines: TopicLineEntry[];
}

export interface TopicLineEntry {
  line: number;
  row: number;
  floor?: number;
  isHot?: boolean;
  kind: "header" | "divider" | "text" | "quote" | "image" | "link" | "blank" | "vote-info" | "vote-option" | "vote-action" | "rating";
  text: string;
  postId?: number;
  imageIndex?: number;
  imageUrl?: string;
  imagePreview?: string;
  imagePreviewRows?: number;
  imageBlockRows?: number;
  linkIndex?: number;
  linkUrl?: string;
  linkSpans?: Array<{
    index: number;
    start: number;
    end: number;
    url: string;
  }>;
  voteOptionId?: number;
  voteAction?: "submit" | "reset";
}

export interface TopicVoteItem {
  id: number;
  description: string;
  count: number;
}

export interface TopicVoteRecord {
  userId?: number;
  userName?: string;
  items: number[];
  ip?: string;
  time?: string;
}

export interface TopicVoteState {
  topicId: number;
  voteItems: TopicVoteItem[];
  expiredTime: string;
  isAvailable: boolean;
  maxVoteCount: number;
  canVote: boolean;
  myRecord?: TopicVoteRecord;
  needVote: boolean;
  voteUserCount: number;
  selectedItems: number[];
  isSubmitting: boolean;
}

export const navItems: NavItem[] = [
  { id: "hot", label: "十大", hint: "热门话题" },
  { id: "new", label: "最新", hint: "新帖流" },
  { id: "search", label: "搜索", hint: "主题检索" },
  { id: "boards", label: "版面", hint: "所有分区" },
  { id: "following", label: "关注", hint: "版面用户收藏" },
  { id: "notifications", label: "通知", hint: "系统与回复" },
  { id: "messages", label: "消息", hint: "未读与私信" },
  { id: "me", label: "我的", hint: "当前账号" },
  { id: "settings", label: "设置", hint: "账号与配置" }
];

export const settingsItems: ContentItem[] = [
  { title: "切换账号", meta: "account", detail: "选择或管理登录账号" },
  { title: "检查更新", meta: "update", detail: "检查 CC98-CLI 新版本" },
  { title: "缓存管理", meta: "cache", detail: "查看和清理本地缓存" },
  { title: "一键隐藏", meta: "hidden-patterns", detail: "隐藏纯内容为 cy、bd 或 [ac01] 的帖子" },
  { title: "快捷键帮助", meta: "help", detail: "查看所有可用快捷键" },
  { title: "退出登录", meta: "logout", detail: "清除本地登录信息" }
];

export function currentTopicPost(topic: TopicReaderState, scroll: number): TopicPostEntry | undefined {
  return topic.posts.find((entry) => scroll >= entry.lineStart && scroll <= entry.lineEnd) ??
    [...topic.posts].reverse().find((entry) => entry.lineStart <= scroll) ??
    topic.posts[0];
}

export function currentTopicLine(topic: TopicReaderState, scroll: number): TopicLineEntry | undefined {
  const post = currentTopicPost(topic, scroll);
  if (!post) {
    return undefined;
  }
  return post.lines.find((entry) => entry.line === scroll) ??
    post.lines.find((entry) => entry.line > scroll && entry.kind !== "blank") ??
    post.lines.at(-1);
}

export function getStatus(state: TuiState): string {
  if (state.loading) {
    return "加载中...";
  }
  if (state.loadingMore) {
    return "加载更多...";
  }
  if (state.error) {
    return "出错了";
  }
  if (state.mode === "topic" && state.topic) {
    const post = currentTopicPost(state.topic, state.scroll);
    const line = currentTopicLine(state.topic, state.scroll);
    if (line?.kind === "vote-option" && state.topic.vote) {
      const selectedCount = state.topic.vote.selectedItems.length;
      return `投票选项 · 已选 ${selectedCount}/${state.topic.vote.maxVoteCount} · Enter 勾选`;
    }
    if (line?.kind === "vote-action" && state.topic.vote) {
      return line.voteAction === "submit"
        ? `提交投票 · 已选 ${state.topic.vote.selectedItems.length}/${state.topic.vote.maxVoteCount}`
        : "重置已选投票项";
    }
    return post
      ? `${post.floor ?? "?"} 楼 · 第 ${line ? line.row + 1 : 1} 行`
      : `${state.topic.loaded} 楼已加载`;
  }
  if (state.mode === "settings") {
    return "设置";
  }
  if (state.currentSearch) {
    const label = searchKindLabelForStatus(state.currentSearch);
    if (!state.currentSearch.searched) {
      return `搜索${label}：输入关键词后 Enter 执行`;
    }
    if (state.currentSearch.focus === "input") {
      return `搜索${label}：${state.currentSearch.query || "未输入关键词"}`;
    }
    return state.currentSearch.hasMore
      ? `${label}结果 ${state.items.length} 项，继续向下可加载更多`
      : `${label}结果 ${state.items.length} 项`;
  }
  if (state.currentFollowing) {
    const label = followingKindLabelForStatus(state.currentFollowing.kind);
    return state.currentFollowing.hasMore
      ? `关注${label} ${state.items.length} 项，继续向下可加载更多`
      : `关注${label} ${state.items.length} 项`;
  }
  return `${state.items.length} 项`;
}

function searchKindLabelForStatus(search: SearchListState): string {
  switch (search.kind) {
    case "topic":
      return "主题";
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "board-topic":
      return search.board ? `版内 ${search.board.title ?? `#${search.board.boardId}`}` : "版内";
  }
}

export interface RatingDialogState {
  postId: number;
  type: 1 | 2;
  reasons: Array<{ id: number; name: string }>;
  selectedReasonId: number;
}

function followingKindLabelForStatus(kind: FollowingKind): string {
  switch (kind) {
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "favorite":
      return "收藏";
  }
}
