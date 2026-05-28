import type { TuiConfig } from "../config.js";
import { TokenStore } from "../storage/token-store.js";
import { appVersion } from "../version.js";
import { imagePreviewRows, loadImagePreview, supportsImagePreview } from "./image-preview.js";
import { getSidebarWidth } from "./renderer.js";
import { theme } from "./theme.js";
import {
  currentTopicPost,
  getStatus,
  settingsItems,
  type ContentItem,
  type TopicLineEntry,
  type TopicPostEntry,
  type TopicReaderState,
  type TuiState,
  type ViewId
} from "./tui-model.js";
import { renderMarkdownToLines, renderUbbToLines } from "./ubb-renderer.js";
import { CachedCc98Client } from "./cached-client.js";

export async function openTopic(
  client: CachedCc98Client,
  state: TuiState,
  topicId: number,
  render: () => void,
  config: TuiConfig,
  force = false,
  signal?: AbortSignal
): Promise<void> {
  state.mode = "topic";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.scroll = 0;
  state.topic = {
    topicId,
    title: `#${topicId}`,
    meta: "",
    lines: [],
    posts: [],
    loaded: 0,
    size: 10,
    hasMore: true,
    imageCount: 0,
    linkCount: 0,
    floorInput: ""
  };
  state.status = "正在打开帖子...";
  render();

  try {
    const [topicRaw, postsRaw] = await Promise.all([
      client.getTopic(topicId, force, signal),
      client.getTopicPosts(topicId, 0, 10, force, signal)
    ]);
    const topic = asObject(topicRaw);
    const posts = asArray(postsRaw);
    const reader = buildTopicReader(topicId, topic, posts, 10, config);
    state.topic = reader;
    state.viewTitle = reader.title;
    state.status = reader.hasMore
      ? "j/k 滚动  n/Space 下一页  h/Esc 返回  r 刷新"
      : "j/k 滚动  h/Esc 返回  r 刷新";
    void loadTopicImagePreviews(reader, render, config, state.sidebarWidth);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = state.parentList
      ? "版面读取失败；Esc/Backspace 返回版面列表  h 返回左栏  r 重试"
      : "版面读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function openBoard(
  client: CachedCc98Client,
  state: TuiState,
  boardId: number,
  boardTitle: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  if (pushParent) {
    state.parentList = {
      title: state.viewTitle,
      items: state.items,
      stats: state.stats,
      itemIndex: state.itemIndex,
      status: state.status
    };
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.topic = undefined;
  state.currentChat = undefined;
  state.currentBoard = { boardId, title: boardTitle };
  state.viewTitle = boardTitle;
  state.items = [];
  state.stats = [
    { title: "版面", detail: `#${boardId}` },
    { title: "缓存", detail: "topics 30s" }
  ];
  state.status = "正在读取版面帖子...";
  render();

  try {
    const topics = asArray(await client.getBoardTopics(boardId, 0, 12, false, force, signal));
    state.items = topics.map((topic) => topicItem(topic));
    state.stats = [
      { title: "版面", detail: `#${boardId}` },
      { title: "主题", detail: `${topics.length} 条` },
      { title: "缓存", detail: "topics 30s" }
    ];
    state.status = "版面帖子：j/k 选择  l 打开帖子  h 返回  r 刷新";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

export async function openChat(
  client: CachedCc98Client,
  state: TuiState,
  userId: number,
  title: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  if (pushParent) {
    state.parentList = {
      title: state.viewTitle,
      items: state.items,
      stats: state.stats,
      itemIndex: state.itemIndex,
      status: state.status
    };
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.topic = undefined;
  state.currentBoard = undefined;
  state.currentChat = { userId, title, loaded: 0, size: 10, hasMore: true };
  state.viewTitle = title;
  state.items = [];
  state.stats = [
    { title: "用户", detail: `#${userId}` },
    { title: "缓存", detail: "history 15s" }
  ];
  state.status = "正在读取私信...";
  render();

  try {
    const messages = asArray(await client.getChatHistory(userId, 0, 10, force, signal));
    state.items = chatMessageItems(messages, title, userId);
    state.currentChat.loaded = messages.length;
    state.currentChat.hasMore = messages.length === state.currentChat.size;
    state.itemIndex = Math.max(0, state.items.length - 1);
    state.stats = [
      { title: "用户", detail: `#${userId}` },
      { title: "消息", detail: `${messages.length} 条` },
      { title: "缓存", detail: "history 15s" }
    ];
    state.status = state.currentChat.hasMore
      ? "私信：j/k 滚动  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "私信：j/k 滚动  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "私信读取失败；Esc/Backspace 返回联系人  h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function loadNextChatPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  if (!state.currentChat || state.loadingMore || !state.currentChat.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在读取更早私信...";
  render();

  try {
    const chat = state.currentChat;
    const messages = asArray(await client.getChatHistory(chat.userId, chat.loaded, chat.size, false, signal));
    const olderItems = chatMessageItems(messages, chat.title, chat.userId);
    state.items = [...olderItems, ...state.items];
    state.itemIndex += olderItems.length;
    state.scroll += olderItems.length;
    chat.loaded += messages.length;
    chat.hasMore = messages.length === chat.size;
    state.stats = [
      { title: "用户", detail: `#${chat.userId}` },
      { title: "消息", detail: `${chat.loaded} 条` },
      { title: "缓存", detail: "history 15s" }
    ];
    state.status = chat.hasMore
      ? "私信：j/k 滚动  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "已到最早私信；j/k 滚动  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "更早私信读取失败；n/Space 重试  Esc/Backspace 返回联系人";
  } finally {
    state.loadingMore = false;
    render();
  }
}

export function restoreParentList(state: TuiState): void {
  if (!state.parentList) {
    return;
  }
  const parent = state.parentList;
  state.mode = "list";
  state.focus = "content";
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.topic = undefined;
  state.currentBoard = undefined;
  state.currentChat = undefined;
  state.parentList = undefined;
  state.viewTitle = parent.title;
  state.items = parent.items;
  state.stats = parent.stats;
  state.itemIndex = parent.itemIndex;
  state.status = parent.status;
}

export async function loadNextTopicPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  config: TuiConfig,
  signal?: AbortSignal,
  advanceAfterLoad = false
): Promise<void> {
  if (!state.topic || state.loadingMore || !state.topic.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在加载下一页...";
  render();

  try {
    const posts = asArray(await client.getTopicPosts(state.topic.topicId, state.topic.loaded, state.topic.size, false, signal));
    const next = renderPosts(posts, Math.max(36, currentTopicWidthEstimate(config, state.sidebarWidth)), config, state.topic.lines.length);
    state.topic.lines.push(...next.lines);
    state.topic.posts.push(...next.posts);
    state.topic.imageCount += next.imageCount;
    state.topic.linkCount += next.linkCount;
    void loadTopicImagePreviews(state.topic, render, config, state.sidebarWidth);
    state.topic.loaded += posts.length;
    state.topic.hasMore = posts.length === state.topic.size;
    if (advanceAfterLoad && posts.length > 0) {
      state.scroll = Math.min(Math.max(0, state.topic.lines.length - 1), state.scroll + 1);
    }
    state.status = state.topic.hasMore
      ? "j/k 滚动  n/Space 下一页  h/Esc 返回  r 刷新"
      : "已到最后一页  j/k 滚动  h/Esc 返回  r 刷新";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMore = false;
    render();
  }
}

export async function jumpToTopicFloor(
  client: CachedCc98Client,
  state: TuiState,
  floor: number,
  render: () => void,
  config: TuiConfig,
  signal?: AbortSignal
): Promise<void> {
  const topic = state.topic;
  if (!topic) {
    return;
  }

  const loaded = findTopicPostByFloor(topic, floor);
  if (loaded) {
    state.scroll = loaded.lineStart;
    state.status = getStatus(state);
    render();
    return;
  }

  const from = Math.floor((floor - 1) / topic.size) * topic.size;
  state.loadingMore = true;
  state.status = `正在读取 ${floor} 楼...`;
  render();

  try {
    const posts = asArray(await client.getTopicPosts(topic.topicId, from, topic.size, false, signal));
    const next = renderPosts(posts, Math.max(36, currentTopicWidthEstimate(config, state.sidebarWidth)), config, topic.lines.length);
    topic.lines.push(...next.lines);
    topic.posts.push(...next.posts);
    topic.posts.sort((left, right) => (left.floor ?? 0) - (right.floor ?? 0));
    topic.imageCount += next.imageCount;
    topic.linkCount += next.linkCount;
    void loadTopicImagePreviews(topic, render, config, state.sidebarWidth);
    topic.loaded = Math.max(topic.loaded, from + posts.length);
    topic.hasMore = posts.length === topic.size;
    const target = findTopicPostByFloor(topic, floor);
    if (target) {
      state.scroll = target.lineStart;
      state.status = getStatus(state);
    } else {
      state.status = `未找到 ${floor} 楼`;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    state.loadingMore = false;
    render();
  }
}

export function jumpRelativeTopicFloor(state: TuiState, delta: number): void {
  const topic = state.topic;
  if (!topic || topic.posts.length === 0) {
    return;
  }
  const current = currentTopicPost(topic, state.scroll);
  const currentIndex = current ? topic.posts.indexOf(current) : 0;
  const next = topic.posts[Math.min(topic.posts.length - 1, Math.max(0, currentIndex + delta))];
  if (next) {
    state.scroll = next.lineStart;
  }
}

export async function refreshAccounts(state: TuiState, tokenStore: TokenStore): Promise<void> {
  const accounts = await tokenStore.listAccounts();
  const current = await tokenStore.getCurrentAccountName();
  state.account = current;
  state.accountModal.accounts = accounts.map((account) => ({
    account: account.account,
    detail: account.displayName ?? account.username ?? (account.userId ? `#${account.userId}` : "本地账号"),
    isCurrent: account.account === current
  }));
  state.accountModal.selectedIndex = Math.min(
    state.accountModal.accounts.findIndex((account) => account.isCurrent),
    state.accountModal.accounts.length
  );
  if (state.accountModal.selectedIndex < 0) {
    state.accountModal.selectedIndex = 0;
  }
}

export function getDefaultAccountName(me: Record<string, unknown>, username: string): string {
  if (typeof me.name === "string" && me.name.trim()) {
    return me.name.trim();
  }
  if (typeof me.id === "number") {
    return String(me.id);
  }
  return username;
}

export function normalizeLoginMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^login failed:\s*/i, "");
  }
  return String(error);
}

export async function loadView(
  client: CachedCc98Client,
  view: ViewId,
  force: boolean,
  signal?: AbortSignal
): Promise<{
  title: string;
  items: ContentItem[];
  stats: ContentItem[];
  overview?: ContentItem[];
  status?: string;
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
        stats: unreadStats(unreadObject),
        overview: overviewStats(indexObject, unreadObject)
      };
    }
    case "new": {
      const topics = asArray(await client.getNewTopics(0, 12, force, signal));
      return {
        title: "最新",
        items: topics.map((topic) => topicItem(topic)),
        stats: [{ title: "新帖流", detail: `${topics.length} 条` }]
      };
    }
    case "boards": {
      const sections = asArray(await client.getAllBoards(force, signal));
      const boards = flattenBoards(sections).slice(0, 14);
      return {
        title: "版面",
        items: boards,
        stats: [{ title: "分区", detail: `${sections.length}` }, { title: "版面", detail: `${flattenBoards(sections).length}` }],
        status: "版面：j/k 选择  l 进入版面  h 返回  r 刷新"
      };
    }
    case "following": {
      const topics = asArray(await client.getFolloweeTopics(0, 12, force, signal));
      return {
        title: "关注",
        items: topics.map((topic) => topicItem(topic)),
        stats: [
          { title: "关注动态", detail: `${topics.length} 条` },
          { title: "缓存", detail: "30s" }
        ],
        status: "关注：j/k 选择  l 打开帖子  h 返回  r 刷新"
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
        stats: [
          { title: "收藏版面", detail: `${customBoards.length} 个` },
          { title: "主题", detail: `${items.length} 条` },
          { title: "缓存", detail: "boards 24h / topics 30s" }
        ],
        status: "收藏：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "messages": {
      const [unread, recent] = await Promise.all([
        client.getUnreadCount(force, signal),
        client.getRecentChats(0, 10, force, signal)
      ]);
      const unreadObject = asObject(unread);
      const chats = asArray(recent);
      const userNames = await loadChatUserNames(client, chats, force, signal);
      const unreadItems = unreadStats(unreadObject)
        .filter((entry) => entry.detail !== "0" && entry.detail !== "-")
        .map((entry) => ({
          title: `未读 ${entry.title}`,
          detail: entry.detail
        }));
      const chatItems = chats.length > 0
        ? chats.map((chat) => chatItem(chat, userNames))
        : [{ title: "暂无最近私信", meta: "recent-contact-users" }];
      return {
        title: "消息",
        items: [...unreadItems, ...chatItems],
        stats: unreadStats(unreadObject),
        status: "消息：j/k 选择  l 打开会话  h 返回  r 刷新"
      };
    }
    case "me": {
      const [me, cacheStats] = await Promise.all([
        client.getMe(force, signal),
        client.getCacheStats()
      ]);
      const meObject = asObject(me);
      return {
        title: "我的",
        items: [
          item("昵称", meObject.name),
          item("用户 ID", meObject.id),
          item("等级", meObject.levelTitle ?? meObject.groupName),
          item("发帖数", meObject.postCount),
          item("财富", meObject.wealth),
          item("关注", meObject.followCount),
          item("粉丝", meObject.fanCount),
          item("缓存文件", cacheStats.fileCacheEntries)
        ],
        stats: [
          { title: "登录状态", detail: "已登录" }
        ]
      };
    }
    case "settings": {
      const cacheStats = await client.getCacheStats();
      return {
        title: "设置",
        items: settingsItems,
        stats: [
          { title: "缓存", detail: `${cacheStats.fileCacheEntries} 文件` },
          { title: "版本", detail: `v${appVersion}` }
        ],
        status: "设置：j/k 选择  l 执行  h 返回"
      };
    }
  }
}

function currentTopicWidthEstimate(config: TuiConfig, sidebarWidthOverride?: number): number {
  const width = process.stdout.columns || Number(process.env.COLUMNS) || 80;
  const sidebarWidth = getSidebarWidth(width, sidebarWidthOverride);
  const sidebarRuleWidth = sidebarWidth > 0 ? 1 : 0;
  if (width < 78 || config.hideRightPanel) {
    return Math.max(24, width - sidebarWidth - sidebarRuleWidth);
  }
  const rightWidth = Math.floor(width * 0.30);
  return Math.max(24, width - sidebarWidth - sidebarRuleWidth - 1 - rightWidth);
}

async function loadTopicImagePreviews(
  topic: TopicReaderState,
  render: () => void,
  config: TuiConfig,
  sidebarWidthOverride?: number
): Promise<void> {
  if (!config.previewImages || !supportsImagePreview()) {
    return;
  }

  const width = Math.max(16, currentTopicWidthEstimate(config, sidebarWidthOverride) - 2);
  const imageLines = topic.posts
    .flatMap((post) => post.lines)
    .filter((line) => line.kind === "image" && line.imageUrl && !line.imagePreview);

  for (const line of imageLines) {
    try {
      const preview = await loadImagePreview(line.imageUrl ?? "", width, imagePreviewRows);
      if (preview) {
        line.imagePreview = preview;
        render();
      }
    } catch {
      // Keep the textual image placeholder if preview loading fails.
    }
  }
}

function buildTopicReader(
  topicId: number,
  topic: Record<string, unknown>,
  posts: unknown[],
  size: number,
  config: TuiConfig
): TopicReaderState {
  const title = normalizeInlineText(String(topic.title ?? `#${topicId}`));
  const meta = [
    topic.userName,
    topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
    topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
  ].filter(Boolean).join(" · ");
  const rendered = renderPosts(posts, currentTopicWidthEstimate(config), config);

  return {
    topicId,
    title,
    meta,
    lines: rendered.lines,
    posts: rendered.posts,
    loaded: posts.length,
    size,
    hasMore: posts.length === size,
    imageCount: rendered.imageCount,
    linkCount: rendered.linkCount,
    floorInput: ""
  };
}

function renderPosts(
  posts: unknown[],
  width: number,
  config: TuiConfig,
  lineOffset = 0
): {
  lines: string[];
  posts: TopicPostEntry[];
  imageCount: number;
  linkCount: number;
} {
  const lines: string[] = [];
  const entries: TopicPostEntry[] = [];
  let imageCount = 0;
  let linkCount = 0;

  posts.forEach((postRaw) => {
    const post = asObject(postRaw);
    const lineStart = lineOffset + lines.length;
    const postLines: TopicLineEntry[] = [];
    const floorNumber = asNumber(post.floor);
    const floor = floorNumber !== undefined ? `#${floorNumber}` : "#?";
    const author = String(post.userName ?? "匿名");
    const time = typeof post.time === "string" ? post.time.replace("T", " ").slice(0, 16) : "";
    const likeCount = asNumber(post.likeCount) ?? 0;
    const dislikeCount = asNumber(post.dislikeCount) ?? 0;
    const reactions = ` · ${likeCount} 赞 · ${dislikeCount} 踩`;
    const push = (
      text: string,
      kind: TopicLineEntry["kind"],
      extra: Partial<TopicLineEntry> = {}
    ) => {
      const line = lineOffset + lines.length;
      lines.push(text);
      postLines.push({
        line,
        row: postLines.length,
        floor: floorNumber,
        kind,
        text,
        ...extra
      });
    };

    push(`${floor} ${author}${time ? ` · ${time}` : ""}${reactions}`, "header");
    const contentWidth = Math.max(8, width - 2);
    push(theme.border.horizontal.repeat(contentWidth), "divider");

    const content = typeof post.content === "string" ? post.content : "";
    const contentType = asNumber(post.contentType) ?? 0;
    const rendered = contentType === 1
      ? renderMarkdownToLines(content, contentWidth, {
        imagePreviewRows: config.previewImages && supportsImagePreview() ? imagePreviewRows : 0
      })
      : renderUbbToLines(content, contentWidth, {
        imagePreviewRows: config.previewImages && supportsImagePreview() ? imagePreviewRows : 0
      });
    rendered.lines.forEach((renderedLine) => {
      const imageIndex = parseBracketIndex(renderedLine, "image");
      const linkIndex = parseBracketIndex(renderedLine, "link");
      const kind = renderedLine.trim() === ""
        ? "blank"
        : imageIndex !== undefined
          ? "image"
          : linkIndex !== undefined
            ? "link"
            : renderedLine.startsWith(theme.quote.prefix)
              ? "quote"
              : "text";
      push(renderedLine, kind, {
        imageIndex,
        imageUrl: imageIndex !== undefined ? rendered.images[imageIndex - 1] : undefined,
        linkIndex,
        linkUrl: linkIndex !== undefined ? rendered.links[linkIndex - 1] : undefined
      });
    });
    push("", "blank");
    const preview = rendered.lines.find((value) =>
      value.trim() &&
      !value.startsWith("[image ") &&
      !value.startsWith("[link ")
    ) ?? "";
    entries.push({
      id: asNumber(post.id),
      floor: floorNumber,
      author,
      time,
      likeCount,
      dislikeCount,
      rating: formatRating(post),
      preview,
      lineStart,
      lineEnd: lineOffset + lines.length - 1,
      imageCount: rendered.images.length,
      linkCount: rendered.links.length,
      images: rendered.images,
      links: rendered.links,
      lines: postLines
    });
    imageCount += rendered.images.length;
    linkCount += rendered.links.length;
  });

  return { lines, posts: entries, imageCount, linkCount };
}

function findTopicPostByFloor(topic: TopicReaderState, floor: number): TopicPostEntry | undefined {
  return topic.posts.find((entry) => entry.floor === floor);
}

function parseBracketIndex(value: string, label: "image" | "link"): number | undefined {
  const match = new RegExp(`\\[${label} (\\d+)`).exec(value);
  return match ? Number(match[1]) : undefined;
}

function formatRating(post: Record<string, unknown>): string | undefined {
  const value = post.rating ?? post.ratingCount ?? post.wealth ?? post.score;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function item(title: string, value: unknown, meta?: string): ContentItem {
  return {
    title,
    meta,
    detail: value === undefined || value === null ? "-" : String(value)
  };
}

function topicItem(value: unknown, fallbackBoard?: ContentItem): ContentItem {
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

async function loadChatUserNames(
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

function chatItem(value: unknown, userNames: Map<number, string>): ContentItem {
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

function chatMessageItems(messages: unknown[], otherName: string, otherUserId: number): ContentItem[] {
  return [...messages].reverse().map((messageRaw) => {
    const message = asObject(messageRaw);
    const receiverId = asNumber(message.receiverId ?? message.ReceiverId);
    const isMine = receiverId === otherUserId;
    const time = typeof message.time === "string"
      ? message.time.replace("T", " ").slice(0, 16)
      : "";
    const content = normalizePreview(String(message.content ?? message.Content ?? ""));
    return {
      title: isMine ? `我 -> ${otherName}` : `${otherName} -> 我`,
      meta: [time, receiverId !== undefined ? `receiver #${receiverId}` : undefined].filter(Boolean).join(" · "),
      detail: content || "(空消息)"
    };
  });
}

function unreadStats(value: Record<string, unknown>): ContentItem[] {
  return [
    item("系统", value.systemCount),
    item("@", value.atCount),
    item("回复", value.replyCount),
    item("私信", value.messageCount)
  ];
}

function overviewStats(index: Record<string, unknown>, unread: Record<string, unknown>): ContentItem[] {
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

async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
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

function flattenBoards(sections: unknown[]): ContentItem[] {
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

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePreview(value: string): string {
  return normalizeInline(value
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, " [图片] ")
    .replace(/\[upload(?:=[^\]]*)?\][\s\S]*?\[\/upload\]/gi, " [附件] ")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, _url: string, label: string) => ` ${label} `)
    .replace(/\[url\][\s\S]*?\[\/url\]/gi, " [链接] ")
    .replace(/<img\b[^>]*>/gi, " [图片] ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\[(?:\/)?(?:b|i|u|size|color|align|email|del|s|sub|sup|h\d?|quote|code)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[[a-z0-9]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\[\/[a-z0-9]+\]/gi, " "));
}

function timestampOf(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
