import { emotionPreviewRows, isEmotionAssetPath, loadEmotionPreview, measureEmotionPreview } from "../emotion-preview.js";
import { imagePreviewRows, loadImagePreview, measureImagePreview, supportsImagePreview } from "../image-preview.js";
import { getSidebarWidth } from "../renderer.js";
import { theme } from "../theme.js";
import {
  currentTopicPost,
  getStatus,
  type TopicLineEntry,
  type TopicPostEntry,
  type TopicReaderState,
  type TuiState,
  type BoardListState
} from "../tui-model.js";
import { renderMarkdownToLines, renderUbbToLines } from "../ubb-renderer.js";
import { CachedCc98Client } from "../cached-client.js";
import type { TuiConfig } from "../../config.js";
import { asArray, asBoolean, asNumber, asObject, isAbortError, normalizeInlineText } from "./utils.js";

export async function openTopic(
  client: CachedCc98Client,
  state: TuiState,
  topicId: number,
  render: () => void,
  config: TuiConfig,
  force = false,
  signal?: AbortSignal,
  boardContext?: BoardListState
): Promise<void> {
  state.mode = "topic";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.scroll = 0;
  state.imageViewer = undefined;
  state.currentBoard = boardContext ?? state.currentBoard;
  state.topic = {
    topicId,
    title: `#${topicId}`,
    meta: "",
    isFavorite: false,
    forceRefresh: force,
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
    const [topicRaw, postsRaw, favoriteRaw] = await Promise.all([
      client.getTopic(topicId, force, signal),
      client.getTopicPosts(topicId, 0, 10, force, signal),
      client.getTopicFavoriteState(topicId, force)
    ]);
    const topic = asObject(topicRaw);
    const posts = asArray(postsRaw);
    state.currentBoard = topicBoardContext(topic) ?? state.currentBoard;
    const reader = buildTopicReader(topicId, topic, posts, 10, config, asBoolean(favoriteRaw) ?? false);
    reader.forceRefresh = force;
    state.topic = reader;
    state.viewTitle = reader.title;
    void loadTopicImagePreviews(state, render, config, state.sidebarWidth);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = state.history.length > 0
      ? "版面读取失败；Esc/Backspace 返回版面列表  h 返回左栏  r 重试"
      : "版面读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    if (!state.error && state.mode === "topic" && state.topic) {
      state.status = getStatus(state);
    }
    render();
  }
}

function topicBoardContext(topic: Record<string, unknown>): BoardListState | undefined {
  const boardId = asNumber(topic.boardId ?? topic.BoardId);
  const boardTitle = normalizeInlineText(String(topic.boardName ?? topic.BoardName ?? "")).trim();
  if (boardId === undefined || !boardTitle) {
    return undefined;
  }
  return { boardId, title: boardTitle };
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
    const previousPostCount = state.topic.posts.length;
    const posts = asArray(await client.getTopicPosts(
      state.topic.topicId,
      state.topic.loaded,
      state.topic.size,
      state.topic.forceRefresh,
      signal
    ));
    appendTopicPosts(state.topic, posts, config, state.sidebarWidth);
    void loadTopicImagePreviews(state, render, config, state.sidebarWidth);
    state.topic.loaded += posts.length;
    state.topic.hasMore = posts.length === state.topic.size;
    if (advanceAfterLoad && posts.length > 0) {
      const nextPost = state.topic.posts[previousPostCount];
      if (nextPost) {
        state.scroll = nextPost.lineStart;
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMore = false;
    if (!state.error && state.mode === "topic" && state.topic) {
      state.status = getStatus(state);
    }
    render();
  }
}

export async function jumpToTopicFloor(
  client: CachedCc98Client,
  state: TuiState,
  floor: number,
  render: () => void,
  config: TuiConfig,
  signal?: AbortSignal,
  force = false
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
    const posts = asArray(await client.getTopicPosts(
      topic.topicId,
      from,
      topic.size,
      topic.forceRefresh || force,
      signal
    ));
    appendTopicPosts(topic, posts, config, state.sidebarWidth);
    topic.posts.sort((left, right) => (left.floor ?? 0) - (right.floor ?? 0));
    void loadTopicImagePreviews(state, render, config, state.sidebarWidth);
    topic.loaded = Math.max(topic.loaded, from + posts.length);
    topic.hasMore = posts.length === topic.size;
    const target = findTopicPostByFloor(topic, floor);
    if (target) {
      state.scroll = target.lineStart;
    } else {
      state.status = `未找到 ${floor} 楼`;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    state.loadingMore = false;
    if (!state.error && findTopicPostByFloor(topic, floor)) {
      state.status = getStatus(state);
    }
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

function currentTopicWidthEstimate(sidebarWidthOverride?: number): number {
  const width = process.stdout.columns || Number(process.env.COLUMNS) || 80;
  const sidebarWidth = getSidebarWidth(width, sidebarWidthOverride);
  const sidebarRuleWidth = sidebarWidth > 0 ? 1 : 0;
  return Math.max(24, width - sidebarWidth - sidebarRuleWidth);
}

async function loadTopicImagePreviews(
  state: TuiState,
  render: () => void,
  config: TuiConfig,
  sidebarWidthOverride?: number
): Promise<void> {
  const topic = state.topic;
  if (!topic || !config.previewImages) {
    return;
  }

  const width = Math.max(12, currentTopicWidthEstimate(sidebarWidthOverride) - 4);
  const imageLines = topic.posts
    .flatMap((post) => post.lines)
    .filter((line) =>
      line.kind === "image" &&
      line.imageUrl
    );
  const previewEnabled = supportsImagePreview();

  for (const line of imageLines) {
    try {
      if (state.topic !== topic) {
        return;
      }

      const maxRows = isEmotionAssetPath(line.imageUrl ?? "") ? emotionPreviewRows : imagePreviewRows;

      if (!line.imagePreviewRows) {
        const measured = isEmotionAssetPath(line.imageUrl ?? "")
          ? await measureEmotionPreview(line.imageUrl ?? "", width)
          : await measureImagePreview(line.imageUrl ?? "", width, maxRows);
        if (state.topic !== topic) {
          return;
        }
        if (measured) {
          line.imagePreviewRows = measured.rows;
          adjustTopicImageBlockHeight(topic, line, measured.rows, state);
          render();
        }
      }

      if (!previewEnabled || line.imagePreview) {
        continue;
      }

      const rows = Math.max(1, Math.min(maxRows, line.imagePreviewRows ?? line.imageBlockRows ?? maxRows));
      const preview = isEmotionAssetPath(line.imageUrl ?? "")
        ? await loadEmotionPreview(line.imageUrl ?? "", width)
        : await loadImagePreview(line.imageUrl ?? "", width, rows);
      if (state.topic !== topic) {
        return;
      }
      if (preview) {
        line.imagePreview = preview.token;
        line.imagePreviewRows = preview.size.rows;
        adjustTopicImageBlockHeight(topic, line, preview.size.rows, state);
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
  config: TuiConfig,
  isFavorite: boolean
): TopicReaderState {
  const title = normalizeInlineText(String(topic.title ?? `#${topicId}`));
  const meta = [
    topic.userName,
    topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
    topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
  ].filter(Boolean).join(" · ");
  const rendered = renderPosts(posts, currentTopicWidthEstimate(), config);

  return {
    topicId,
    title,
    meta,
    isFavorite,
    forceRefresh: false,
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

function appendTopicPosts(
  topic: TopicReaderState,
  posts: unknown[],
  config: TuiConfig,
  sidebarWidthOverride?: number
): void {
  const next = renderPosts(
    posts,
    Math.max(36, currentTopicWidthEstimate(sidebarWidthOverride)),
    config,
    topic.lines.length
  );
  topic.lines.push(...next.lines);
  topic.posts.push(...next.posts);
  topic.imageCount += next.imageCount;
  topic.linkCount += next.linkCount;
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
    const likeState = normalizeLikeState(post.likeState);
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
        imagePreviewRows: config.previewImages ? imagePreviewRows : 0
      })
      : renderUbbToLines(content, contentWidth, {
        imagePreviewRows: config.previewImages ? imagePreviewRows : 0
      });
    rendered.lines.forEach((renderedLine, index) => {
      const imageIndex = parseBracketIndex(renderedLine, "image");
      const linkIndex = parseBracketIndex(renderedLine, "link");
      const imageBlockRows = imageIndex !== undefined ? imageBlockHeight(rendered.lines, index) : undefined;
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
        imageBlockRows,
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
      userId: asNumber(post.userId),
      floor: floorNumber,
      author,
      time,
      likeCount,
      dislikeCount,
      likeState,
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

function normalizeLikeState(value: unknown): 0 | 1 | 2 {
  return value === 1 || value === 2 ? value : 0;
}

function findTopicPostByFloor(topic: TopicReaderState, floor: number): TopicPostEntry | undefined {
  return topic.posts.find((entry) => entry.floor === floor);
}

function imageBlockHeight(lines: string[], start: number): number {
  let height = 1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("[image ") || line.trim() !== "") {
      break;
    }
    height += 1;
  }
  return height;
}

function adjustTopicImageBlockHeight(
  topic: TopicReaderState,
  line: TopicLineEntry,
  nextRows: number,
  state: TuiState
): void {
  const post = topic.posts.find((entry) => entry.lines.includes(line));
  if (!post) {
    return;
  }

  const startRow = line.row;
  const currentRows = Math.max(1, line.imageBlockRows ?? 1);
  const targetRows = Math.max(1, nextRows);
  if (currentRows === targetRows) {
    line.imageBlockRows = targetRows;
    return;
  }

  const originalLine = line.line;
  const removeCount = Math.min(currentRows, Math.max(1, post.lines.length - startRow));
  const delta = targetRows - currentRows;
  const filler = Array.from({ length: targetRows - 1 }, (): TopicLineEntry => ({
    line: 0,
    row: 0,
    floor: line.floor,
    kind: "blank",
    text: ""
  }));

  line.imageBlockRows = targetRows;
  post.lines.splice(startRow, removeCount, line, ...filler);
  rebuildTopicLines(topic);

  if (originalLine < state.scroll) {
    state.scroll = Math.max(0, state.scroll + delta);
  }
}

function rebuildTopicLines(topic: TopicReaderState): void {
  const lines: string[] = [];
  topic.posts.forEach((post) => {
    post.lineStart = lines.length;
    post.lines.forEach((entry, row) => {
      entry.row = row;
      entry.line = lines.length;
      lines.push(entry.text);
    });
    post.lineEnd = Math.max(post.lineStart, lines.length - 1);
  });
  topic.lines = lines;
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
