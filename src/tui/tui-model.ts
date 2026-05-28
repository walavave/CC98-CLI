import type {
  AccountModalState,
  ConfirmDialogState,
  LoginFormState
} from "./account-modal.js";

export type ViewId = "hot" | "new" | "boards" | "following" | "favorite" | "messages" | "me" | "settings";
export type FocusColumn = "nav" | "content";
export type ModalType = "menu" | "help" | "account" | "login" | "confirm" | null;

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
  loading: boolean;
  loadingMore: boolean;
  status: string;
  error?: string;
  account?: string;
  viewTitle: string;
  items: ContentItem[];
  stats: ContentItem[];
  overview: ContentItem[];
  parentList?: ListSnapshot;
  currentBoard?: BoardListState;
  currentChat?: ChatListState;
  topic?: TopicReaderState;
  modal: ModalType;
  menuIndex: number;
  menuItems: MenuItem[];
  accountModal: AccountModalState;
  loginForm: LoginFormState;
  confirmDialog?: ConfirmDialogState;
}

export interface ListSnapshot {
  title: string;
  items: ContentItem[];
  stats: ContentItem[];
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

export interface TopicPostEntry {
  id?: number;
  floor?: number;
  author: string;
  time: string;
  likeCount: number;
  dislikeCount: number;
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
  linkIndex?: number;
  linkUrl?: string;
}

export interface MenuItem {
  label: string;
  key: string;
  action: string;
}

export const mascotMini = [
  "  ▄▄▄ ▄▄▄ ▄███",
  " ██▀█████▀█▄ ██",
  "█▀  ▀   ▀ ██ ██",
  "█  ██▄█  █▄▄ ██",
  "██ ▀    ████▄██",
  " ▀██▄▄██████▀"
];

export const navItems: NavItem[] = [
  { id: "hot", label: "十大", hint: "热门话题" },
  { id: "favorite", label: "收藏", hint: "版面帖子" },
  { id: "new", label: "最新", hint: "新帖流" },
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

export function lineKindLabel(kind: TopicLineEntry["kind"]): string {
  switch (kind) {
    case "header":
      return "楼层标题";
    case "divider":
      return "分隔线";
    case "quote":
      return "引用";
    case "image":
      return "图片";
    case "link":
      return "链接";
    case "blank":
      return "空行";
    case "text":
      return "正文";
  }
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
  return `${state.items.length} 项`;
}
