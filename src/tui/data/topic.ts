import { emotionPreviewRows, isEmotionAssetPath, loadEmotionPreview, measureEmotionPreview } from "../media/emotion-preview.js";
import { imagePreviewRows, loadImagePreview, measureImagePreview, supportsImagePreview } from "../media/image-preview.js";
import { getSidebarWidth } from "../renderer.js";
import { theme } from "../render-core/theme.js";
import { pushCurrentViewSnapshot } from "./navigation-state.js";
import {
  currentTopicPost,
  getStatus,
  type TopicLineEntry,
  type TopicPostEntry,
  type TopicReaderState,
  type TopicVoteRecord,
  type TopicVoteState,
  type TuiState,
  type BoardListState
} from "../tui-model.js";
import { renderMarkdownToLines, renderUbbToLines } from "../media/ubb-renderer.js";
import { CachedCc98Client } from "../cached-client.js";
import type { TuiConfig } from "../../config.js";
import { asArray, asBoolean, asNumber, asObject, isAbortError, normalizeInlineText } from "./utils.js";
import { extractInlineLinkSpans, stripInternalLinkMarkup } from "../link.js";
import { setTopicScrollLine } from "../topic-scroll.js";

export async function openTopic(
  client: CachedCc98Client,
  state: TuiState,
  topicId: number,
  render: () => void,
  config: TuiConfig,
  force = false,
  signal?: AbortSignal,
  boardContext?: BoardListState,
  pushParent = true
): Promise<void> {
  if (pushParent) {
    pushCurrentViewSnapshot(state);
  }

  state.mode = "topic";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  setTopicScrollLine(state, 0);
  state.imageViewer = undefined;
  state.currentBoard = boardContext ?? state.currentBoard;
  state.topic = {
    topicId,
    title: `#${topicId}`,
    meta: "",
    board: boardContext ?? state.currentBoard,
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
    const [topicRaw, postsRaw, favoriteRaw, hotRaw] = await Promise.all([
      client.getTopic(topicId, force, signal),
      client.getTopicPosts(topicId, 0, 10, force, signal),
      client.getTopicFavoriteState(topicId, force),
      client.getHotPosts(topicId, { signal })
    ]);
    const topic = asObject(topicRaw);
    const apiPosts = asArray(postsRaw);
    const hotPosts = asArray(hotRaw);
    const hotFloors = new Set(hotPosts.map((p) => asNumber(asObject(p).floor)).filter((f) => f !== undefined));
    const posts = hotPosts.length > 0 && apiPosts.length > 0
      ? [apiPosts[0], ...hotPosts, ...apiPosts.slice(1)]
      : apiPosts;
    const vote = asBoolean(topic.isVote ?? topic.IsVote)
      ? parseTopicVote(await client.getTopicVote(topicId, force))
      : undefined;
    const resolvedBoard = await resolveTopicBoardContext(client, topicBoardContext(topic) ?? state.currentBoard, force, signal);
    state.currentBoard = resolvedBoard;
    const reader = buildTopicReader(topicId, topic, posts, 10, apiPosts.length, config, asBoolean(favoriteRaw) ?? false, resolvedBoard, vote, hotFloors);
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
  if (boardId === undefined) {
    return undefined;
  }
  return { boardId, title: boardTitle || undefined };
}

async function resolveTopicBoardContext(
  client: CachedCc98Client,
  board: BoardListState | undefined,
  force = false,
  signal?: AbortSignal
): Promise<BoardListState | undefined> {
  if (!board || board.title) {
    return board;
  }

  try {
    const boardInfo = asObject(await client.getBoardInfo(board.boardId, force, signal));
    const title = normalizeInlineText(String(boardInfo.name ?? boardInfo.title ?? "")).trim();
    return title ? { boardId: board.boardId, title } : board;
  } catch {
    return board;
  }
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
        setTopicScrollLine(state, nextPost.lineStart);
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
    setTopicScrollLine(state, loaded.lineStart);
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
      setTopicScrollLine(state, target.lineStart);
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
    setTopicScrollLine(state, next.lineStart);
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
  loaded: number,
  config: TuiConfig,
  isFavorite: boolean,
  board?: BoardListState,
  vote?: TopicVoteState,
  hotFloors?: Set<number>
): TopicReaderState {
  const title = normalizeInlineText(String(topic.title ?? `#${topicId}`));
  const meta = [
    board?.title ?? (board ? `#${board.boardId}` : undefined),
    topic.userName,
    topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
    topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
  ].filter(Boolean).join(" · ");
  const rendered = renderPosts(posts, currentTopicWidthEstimate(), config, 0, vote, hotFloors);

  return {
    topicId,
    title,
    meta,
    board,
    isFavorite,
    forceRefresh: false,
    lines: rendered.lines,
    posts: rendered.posts,
    loaded,
    size,
    hasMore: loaded === size,
    imageCount: rendered.imageCount,
    linkCount: rendered.linkCount,
    floorInput: "",
    vote
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
  lineOffset = 0,
  vote?: TopicVoteState,
  hotFloors?: Set<number>
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
    const isHot = hotFloors && floorNumber !== undefined && hotFloors.has(floorNumber);
    const floor = floorNumber !== undefined ? `#${floorNumber}` : "#?";
    const author = String(post.userName ?? "匿名");
    const rawTime = typeof post.time === "string" ? post.time.replace("T", " ").slice(0, 19) : "";
    const time = rawTime ? rawTime.slice(0, 16) : "";
    const likeCount = asNumber(post.likeCount) ?? 0;
    const dislikeCount = asNumber(post.dislikeCount) ?? 0;
    const likeState = normalizeLikeState(post.likeState);
    const reactions = ` · ${likeCount} 赞 · ${dislikeCount} 踩`;
    const rating = formatAwards(post);
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

    push(`${floor} ${author}${time ? ` · ${time}` : ""}${reactions}`, "header", { isHot });
    const contentWidth = Math.max(8, width - 2);
    push(theme.border.horizontal.repeat(contentWidth), "divider");

    const content = typeof post.content === "string" ? post.content : "";
    const contentType = asNumber(post.contentType) ?? 0;
    if (floorNumber === 1 && vote) {
      renderVoteSection(vote, push);
      push("", "blank");
    }

    const rendered = contentType === 1
      ? renderMarkdownToLines(content, contentWidth, {
        imagePreviewRows: config.previewImages ? imagePreviewRows : 0
      })
      : renderUbbToLines(content, contentWidth, {
        imagePreviewRows: config.previewImages ? imagePreviewRows : 0
      });
    rendered.lines.forEach((renderedLine, index) => {
      const { text: displayLine, spans } = extractInlineLinkSpans(renderedLine);
      const imageIndex = parseBracketIndex(renderedLine, "image");
      const linkSpans = spans
        .map((span) => {
          const url = rendered.links[span.index - 1];
          return url ? { ...span, url } : undefined;
        })
        .filter((span): span is NonNullable<typeof span> => span !== undefined);
      const firstLinkSpan = linkSpans[0];
      const imageBlockRows = imageIndex !== undefined ? imageBlockHeight(rendered.lines.map(stripInternalLinkMarkup), index) : undefined;
      const kind = displayLine.trim() === ""
        ? "blank"
        : imageIndex !== undefined
          ? "image"
          : linkSpans.length > 0
            ? "link"
            : displayLine.startsWith(theme.quote.prefix)
              ? "quote"
              : "text";
      push(displayLine, kind, {
        imageIndex,
        imageUrl: imageIndex !== undefined ? rendered.images[imageIndex - 1] : undefined,
        imageBlockRows,
        linkIndex: firstLinkSpan?.index,
        linkUrl: firstLinkSpan?.url,
        linkSpans
      });
    });
    const postId = asNumber(post.id);
    if (rating) {
      push(rating, "rating", { isHot, postId });
    }
    push("", "blank");
    const preview = rendered.lines.find((value) =>
      value.trim() &&
      !value.startsWith("[image ") &&
      stripInternalLinkMarkup(value).trim()
    ) ?? "";
    entries.push({
      id: asNumber(post.id),
      userId: asNumber(post.userId),
      floor: floorNumber,
      author,
      time,
      rawTime,
      rawContent: content,
      contentType,
      likeCount,
      dislikeCount,
      likeState,
      rating: formatAwards(post),
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

function renderVoteSection(vote: TopicVoteState, push: (text: string, kind: TopicLineEntry["kind"], extra?: Partial<TopicLineEntry>) => void): void {
  const needVoteBeforeResult = vote.needVote && !vote.myRecord && vote.isAvailable;
  push("【投票】", "vote-info");
  for (const item of vote.voteItems) {
    const checked = vote.selectedItems.includes(item.id) ? "x" : " ";
    const selectedLimitReached = !vote.selectedItems.includes(item.id) && vote.selectedItems.length >= vote.maxVoteCount;
    const blocked = !vote.canVote || selectedLimitReached;
    const percent = needVoteBeforeResult ? undefined : `${((item.count * 100) / Math.max(vote.voteUserCount, 1)).toFixed(2)}%`;
    const suffix = needVoteBeforeResult ? "" : ` · ${item.count} 人${percent ? ` / ${percent}` : ""}`;
    push(`[${checked}] ${item.description}${suffix}${blocked ? " · 不可选" : ""}`, "vote-option", { voteOptionId: item.id });
  }

  push(`截止：${formatVoteTime(vote.expiredTime)}`, "vote-info");
  push(`最多可投 ${vote.maxVoteCount} 项，已有 ${vote.voteUserCount} 人参与`, "vote-info");
  const hint = voteMessage(vote);
  if (hint) {
    push(hint, "vote-info");
  }
  if (vote.canVote) {
    push("[提交投票]", "vote-action", { voteAction: "submit" });
    push("[重置选择]", "vote-action", { voteAction: "reset" });
  }
}

function voteMessage(vote: TopicVoteState): string | undefined {
  if (vote.canVote && vote.needVote) {
    return "该投票在过期前需要先投票才能查看结果。";
  }
  if (vote.myRecord && vote.myRecord.items.length > 0) {
    return `你已投票：${vote.myRecord.items.join("，")}`;
  }
  if (!vote.canVote && !vote.isAvailable) {
    return "该投票已结束。";
  }
  return undefined;
}

function formatVoteTime(value: string): string {
  return value ? value.replace("T", " ").slice(0, 19) : "-";
}

function parseTopicVote(raw: unknown): TopicVoteState | undefined {
  const vote = asObject(raw);
  const topicId = asNumber(vote.topicId);
  const voteItems = asArray(vote.voteItems)
    .map((entry) => asObject(entry))
    .map((item) => ({
      id: asNumber(item.id) ?? 0,
      description: normalizeInlineText(String(item.description ?? "")),
      count: asNumber(item.count) ?? 0
    }))
    .filter((item) => item.id > 0 && item.description);
  if (topicId === undefined || voteItems.length === 0) {
    return undefined;
  }

  const myRecordRaw = asObject(vote.myRecord);
  const myRecordItems = asArray(myRecordRaw.items).map((item) => asNumber(item)).filter((item): item is number => item !== undefined);
  const myRecord: TopicVoteRecord | undefined = myRecordItems.length > 0 || Object.keys(myRecordRaw).length > 0
    ? {
      userId: asNumber(myRecordRaw.userId),
      userName: typeof myRecordRaw.userName === "string" ? myRecordRaw.userName : undefined,
      items: myRecordItems,
      ip: typeof myRecordRaw.ip === "string" ? myRecordRaw.ip : undefined,
      time: typeof myRecordRaw.time === "string" ? myRecordRaw.time : undefined
    }
    : undefined;

  return {
    topicId,
    voteItems,
    expiredTime: typeof vote.expiredTime === "string" ? vote.expiredTime : "",
    isAvailable: asBoolean(vote.isAvailable) ?? false,
    maxVoteCount: Math.max(1, asNumber(vote.maxVoteCount) ?? 1),
    canVote: asBoolean(vote.canVote) ?? false,
    myRecord,
    needVote: asBoolean(vote.needVote) ?? false,
    voteUserCount: Math.max(0, asNumber(vote.voteUserCount) ?? 0),
    selectedItems: myRecord?.items ?? [],
    isSubmitting: false
  };
}

export function updateTopicVote(topic: TopicReaderState, vote: TopicVoteState, config: TuiConfig, sidebarWidthOverride?: number): void {
  topic.vote = vote;
  const width = Math.max(36, currentTopicWidthEstimate(sidebarWidthOverride));
  const rawPosts = topic.posts.map((post) => ({
    id: post.id,
    userId: post.userId,
    floor: post.floor,
    userName: post.author,
    time: post.rawTime.replace(" ", "T"),
    content: post.rawContent,
    contentType: post.contentType,
    likeCount: post.likeCount,
    dislikeCount: post.dislikeCount,
    likeState: post.likeState,
    rating: post.rating
  }));
  const rerendered = renderPosts(rawPosts, width, config, 0, vote);
  topic.lines = rerendered.lines;
  topic.posts = rerendered.posts;
  topic.imageCount = rerendered.imageCount;
  topic.linkCount = rerendered.linkCount;
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
  if (state.topicViewportScroll !== undefined && originalLine < state.topicViewportScroll) {
    state.topicViewportScroll = Math.max(0, state.topicViewportScroll + delta);
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

function formatAwards(post: Record<string, unknown>): string | undefined {
  // Support pre-computed rating string passed through re-render
  if (typeof post.rating === "string") return post.rating;
  const allAwards = asArray(post.awards) as Array<Record<string, unknown>>;
  if (allAwards.length === 0) return undefined;

  let up = 0;
  let down = 0;
  let wealth = 0;
  let prestige = 0;

  for (const a of allAwards) {
    const c = String(a.content ?? "").trim();
    if (/风评/.test(c)) {
      if (c.includes("-")) down += 1;
      else up += 1;
    } else if (/财富/.test(c)) {
      const m = c.match(/([+-]?\d+)/);
      if (m) wealth += Number(m[1]);
    } else if (/威望/.test(c)) {
      const m = c.match(/([+-]?\d+)/);
      if (m) prestige += Number(m[1]);
    }
  }

  const parts: string[] = [];
  if (up > 0 || down > 0) {
    const arrow = [up > 0 ? `↑${up}` : "", down > 0 ? `↓${down}` : ""].filter(Boolean).join(" ");
    parts.push(`风评 ${arrow}`);
  }
  if (wealth !== 0) parts.push(`财富 ${wealth > 0 ? "+" : ""}${wealth}`);
  if (prestige !== 0) parts.push(`威望 ${prestige > 0 ? "+" : ""}${prestige}`);
  return parts.length > 0 ? parts.join("  ") : undefined;
}
