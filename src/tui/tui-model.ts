import type {
  AccountModalState,
  ConfirmDialogState,
  LoginFormState
} from "./account-modal.js";

export type ViewId = "hot" | "new" | "search" | "boards" | "following" | "favorite" | "messages" | "me" | "settings";
export type FocusColumn = "nav" | "content";
export type ModalType = "help" | "account" | "login" | "confirm" | "image" | "compose" | "emotion-picker" | null;
export type SearchFocus = "input" | "results";

export interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
}

export interface ContentItem {
  title: string;
  meta?: string;
  detail?: string;
  topicId?: number;
  boardId?: number;
  chatUserId?: number;
  sortTime?: number;
}

export interface TuiState {
  mode: "list" | "topic" | "settings";
  focus: FocusColumn;
  navIndex: number;
  itemIndex: number;
  scroll: number;
  sidebarWidth?: number;
  draggingSidebarDivider: boolean;
  loading: boolean;
  loadingMore: boolean;
  status: string;
  notification?: {
    message: string;
    expiresAt: number;
  };
  error?: string;
  account?: string;
  viewTitle: string;
  items: ContentItem[];
  overview: ContentItem[];
  parentList?: ListSnapshot;
  currentBoard?: BoardListState;
  currentChat?: ChatListState;
  currentSearch?: SearchListState;
  topic?: TopicReaderState;
  modal: ModalType;
  accountModal: AccountModalState;
  loginForm: LoginFormState;
  confirmDialog?: ConfirmDialogState;
  imageViewer?: ImageViewerState;
  composeDialog?: ComposeDialogState;
}

export interface ListSnapshot {
  title: string;
  items: ContentItem[];
  itemIndex: number;
  status: string;
}

export interface BoardListState {
  boardId: number;
  title: string;
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
  query: string;
  draft: string;
  loaded: number;
  size: number;
  hasMore: boolean;
  searched: boolean;
  focus: SearchFocus;
}

export interface TopicReaderState {
  topicId: number;
  title: string;
  meta: string;
  lines: string[];
  posts: TopicPostEntry[];
  loaded: number;
  size: number;
  hasMore: boolean;
  imageCount: number;
  linkCount: number;
  floorInput: string;
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
  draft: string;
  cursorIndex: number;
  preferredColumn?: number;
  submitting: boolean;
  emotionCategoryIndex: number;
  emotionSelectedIndex: number;
  emotionFocus: "sidebar" | "grid";
}

export interface TopicPostEntry {
  id?: number;
  floor?: number;
  author: string;
  time: string;
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
  kind: "header" | "divider" | "text" | "quote" | "image" | "link" | "blank";
  text: string;
  imageIndex?: number;
  imageUrl?: string;
  imagePreview?: string;
  imagePreviewRows?: number;
  imageBlockRows?: number;
  linkIndex?: number;
  linkUrl?: string;
}

export const navItems: NavItem[] = [
  { id: "hot", label: "十大", hint: "热门话题" },
  { id: "favorite", label: "收藏", hint: "版面帖子" },
  { id: "new", label: "最新", hint: "新帖流" },
  { id: "search", label: "搜索", hint: "主题检索" },
  { id: "boards", label: "版面", hint: "所有分区" },
  { id: "following", label: "关注", hint: "用户动态" },
  { id: "messages", label: "消息", hint: "未读与私信" },
  { id: "me", label: "我的", hint: "当前账号" },
  { id: "settings", label: "设置", hint: "账号与配置" }
];

export const settingsItems: ContentItem[] = [
  { title: "切换账号", meta: "account", detail: "选择或管理登录账号" },
  { title: "检查更新", meta: "update", detail: "检查 CC98-CLI 新版本" },
  { title: "缓存管理", meta: "cache", detail: "查看和清理本地缓存" },
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
    return post
      ? `${post.floor ?? "?"} 楼 · 第 ${line ? line.row + 1 : 1} 行`
      : `${state.topic.loaded} 楼已加载`;
  }
  if (state.mode === "settings") {
    return "设置";
  }
  if (state.currentSearch) {
    if (!state.currentSearch.searched) {
      return "搜索：输入关键词后 Enter 执行";
    }
    if (state.currentSearch.focus === "input") {
      return `搜索：${state.currentSearch.query || "未输入关键词"}`;
    }
    return state.currentSearch.hasMore
      ? `${state.items.length} 项，继续向下可加载更多`
      : `${state.items.length} 项`;
  }
  return `${state.items.length} 项`;
}
