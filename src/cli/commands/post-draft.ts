import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Cc98Client } from "../../api/client.js";

const execFileAsync = promisify(execFile);

interface DraftFrontMatter {
  title?: string;
  tag1?: string;
  tag2?: string;
}

interface ParsedMarkdownDraft {
  title: string;
  content: string;
  tag1?: string;
  tag2?: string;
  uploadedImages: number;
}

interface BoardResolution {
  boardId: number;
  boardName?: string;
}

interface PostDraftOptions {
  browser?: string;
}

export async function openTopicPostDraft(
  client: Cc98Client,
  boardRef: string,
  markdownFilePath: string,
  options: PostDraftOptions = {}
): Promise<void> {
  const board = await resolveBoardReference(client, boardRef);
  const draft = await buildMarkdownDraft(client, markdownFilePath);
  const workDir = await mkdtemp(join(tmpdir(), "cc98-post-draft-"));
  const titlePath = join(workDir, "title.txt");
  const bodyPath = join(workDir, "body.md");
  const metaPath = join(workDir, "draft.json");
  await writeFile(titlePath, `${draft.title}\n`, "utf8");
  await writeFile(bodyPath, `${draft.content}\n`, "utf8");
  await writeFile(metaPath, `${JSON.stringify({
    boardId: board.boardId,
    boardName: board.boardName,
    title: draft.title,
    tag1: draft.tag1,
    tag2: draft.tag2,
    uploadedImages: draft.uploadedImages,
    bodyPath,
    titlePath
  }, null, 2)}\n`, "utf8");

  const editorUrl = `https://www.cc98.org/editor/postTopic/${board.boardId}`;
  const launch = await launchEditor({
    url: editorUrl,
    title: draft.title,
    body: draft.content,
    browser: options.browser
  });

  const boardLabel = board.boardName ? `${board.boardName} (#${board.boardId})` : `#${board.boardId}`;
  console.log(`已打开 CC98 发帖页：${boardLabel}`);
  console.log(`已上传 ${draft.uploadedImages} 张本地图片，并生成草稿文件：`);
  console.log(`标题：${titlePath}`);
  console.log(`正文：${bodyPath}`);
  console.log(`元信息：${metaPath}`);
  if (launch.mode === "safari-autofill") {
    console.log("已请求 Safari 自动切换到 Markdown 编辑器并填入标题/正文。");
  } else {
    console.log("请手动将草稿内容粘贴到编辑器中。");
  }
  if (draft.tag1 || draft.tag2) {
    console.log(`标签建议：${draft.tag1 ?? "-"} / ${draft.tag2 ?? "-"}`);
  }
}

/**
 * Post a topic directly via API without opening a browser.
 * Resolves tag names to IDs for boards that require them.
 */
export async function postTopicDirectly(
  client: Cc98Client,
  boardRef: string,
  markdownFilePath: string,
  cliTag1?: string,
  cliTag2?: string,
  ubb = false
): Promise<void> {
  const board = await resolveBoardReference(client, boardRef);
  const draft = await buildMarkdownDraft(client, markdownFilePath);

  // CLI tags override front matter tags
  const tag1 = cliTag1 ?? draft.tag1;
  const tag2 = cliTag2 ?? draft.tag2;

  // Resolve tag names to IDs if provided, or check if board requires them
  let tag1Id: number | undefined;
  let tag2Id: number | undefined;
  if (tag1 || tag2) {
    const tags = await client.getBoardTags(board.boardId);
    if (tag1) {
      tag1Id = resolveTagId(tags, tag1);
      if (!tag1Id) throw new Error(`无法在版面 ${board.boardName ?? board.boardId} 中找到标签 "${tag1}"。`);
    }
    if (tag2) {
      tag2Id = resolveTagId(tags, tag2);
      if (!tag2Id) throw new Error(`无法在版面 ${board.boardName ?? board.boardId} 中找到标签 "${tag2}"。`);
    }
  } else {
    // No tags specified — check if board requires them
    const tags = await client.getBoardTags(board.boardId);
    const layers = (tags as Record<string, unknown>).layers as number | undefined;
    if (layers && layers > 0) {
      const { layer1, layer2 } = listTagNames(tags);
      let tagHint = `可用标签：${layer1.join(", ")}`;
      if (layer2.length > 0) tagHint += `\n      二级标签：${[...new Set(layer2)].join(", ")}`;
      throw new Error(
        `版面"${board.boardName ?? board.boardId}"要求填写 ${layers} 层标签。\n` +
        `用法：cc98 post <board> <file.md> <tag1>` +
        (layers > 1 ? ` <tag2>` : ``) + `\n` +
        `或在 markdown 文件顶部添加 front matter：\n` +
        `  ---\n` +
        `  tag1: <标签名>\n` +
        (layers > 1 ? `  tag2: <标签名>\n` : ``) +
        `  ---\n\n` +
        tagHint
      );
    }
  }

  const topicId = await client.createTopic(board.boardId, {
    title: draft.title,
    content: draft.content,
    ...(tag1Id !== undefined ? { tag1: tag1Id } : {}),
    ...(tag2Id !== undefined ? { tag2: tag2Id } : {}),
    ...(ubb ? { contentType: 0 } : {})
  });

  const boardLabel = board.boardName ? `${board.boardName} (#${board.boardId})` : `#${board.boardId}`;
  console.log(`帖子已成功发布到 ${boardLabel}`);
  console.log(`主题 ID: ${topicId}`);
  console.log(`链接: https://www.cc98.org/topic/${topicId}`);
  if (draft.uploadedImages > 0) {
    console.log(`已上传 ${draft.uploadedImages} 张本地图片`);
  }
}

/**
 * Walk the tag-v2 tree and collect all tag names (for error messages).
 */
function listTagNames(tagData: unknown): { layer1: string[]; layer2: string[] } {
  const record = tagData as Record<string, unknown>;
  const tags = Array.isArray(record.tags) ? record.tags as Array<Record<string, unknown>> : [];
  const layer1: string[] = [];
  const layer2: string[] = [];
  for (const tag of tags) {
    if (typeof tag.name === "string") layer1.push(tag.name);
    const subs = Array.isArray(tag.subTags) ? tag.subTags as Array<Record<string, unknown>> : [];
    for (const sub of subs) {
      if (typeof sub.name === "string") layer2.push(sub.name);
    }
  }
  return { layer1, layer2 };
}

/**
 * Walk the tag-v2 tree returned by /board/{id}/tag-v2 and find a tag ID by name.
 * Handles nested tags (layer 1 and layer 2).
 */
function resolveTagId(tagData: unknown, name: string): number | undefined {
  const record = tagData as Record<string, unknown>;
  const tags = Array.isArray(record.tags) ? record.tags : [];

  for (const tag of tags as Array<Record<string, unknown>>) {
    // Direct match on top-level tag
    if (typeof tag.name === "string" && tag.name === name && typeof tag.id === "number") {
      return tag.id;
    }
    // Check sub-tags
    const subTags = Array.isArray(tag.subTags) ? tag.subTags as Array<Record<string, unknown>> : [];
    for (const sub of subTags) {
      if (typeof sub.name === "string" && sub.name === name && typeof sub.id === "number") {
        return sub.id;
      }
    }
  }
  return undefined;
}

async function resolveBoardReference(client: Cc98Client, boardRef: string): Promise<BoardResolution> {
  if (/^\d+$/.test(boardRef)) {
    const boardId = Number(boardRef);
    const boardInfo = await asObject(await client.getBoardInfo(boardId));
    const boardName = stringOrUndefined(boardInfo.name ?? boardInfo.title);
    return { boardId, boardName };
  }

  const normalized = boardRef.trim().toLowerCase();
  const allBoards = collectBoards(await client.getAllBoards());
  const exact = allBoards.find((board) => board.name.toLowerCase() === normalized);
  if (exact) {
    return {
      boardId: exact.boardId,
      boardName: exact.name
    };
  }

  const contains = allBoards.filter((board) => board.name.toLowerCase().includes(normalized));
  if (contains.length === 1) {
    return {
      boardId: contains[0].boardId,
      boardName: contains[0].name
    };
  }

  const searchResult = await client.searchBoards(boardRef);
  const searchBoards = collectBoards(searchResult);
  if (searchBoards.length === 1) {
    return {
      boardId: searchBoards[0].boardId,
      boardName: searchBoards[0].name
    };
  }

  const suggestions = (contains.length > 0 ? contains : searchBoards)
    .slice(0, 8)
    .map((board) => `${board.name} (#${board.boardId})`);
  if (suggestions.length > 0) {
    throw new Error(`unable to resolve board "${boardRef}". Did you mean: ${suggestions.join(", ")}?`);
  }
  throw new Error(`unable to resolve board "${boardRef}". Run "cc98 forum boards" to inspect board ids.`);
}

async function buildMarkdownDraft(client: Cc98Client, markdownFilePath: string): Promise<ParsedMarkdownDraft> {
  const absolutePath = resolve(markdownFilePath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = parseMarkdownSource(source, absolutePath);
  const uploadedUrls = new Map<string, string>();
  const content = await replaceMarkdownLocalImages(parsed.content, dirname(absolutePath), async (imagePath) => {
    const existing = uploadedUrls.get(imagePath);
    if (existing) {
      return existing;
    }
    const file = await imageFileFromPath(imagePath);
    const uploaded = await client.uploadFile(file);
    const imageUrl = uploaded[0];
    if (!imageUrl) {
      throw new Error(`failed to upload image: ${imagePath}`);
    }
    uploadedUrls.set(imagePath, imageUrl);
    return imageUrl;
  });

  if (content.length > 8000) {
    throw new Error(`draft content is too long after image replacement (${content.length} characters, limit 8000).`);
  }

  return {
    title: parsed.title,
    content,
    tag1: parsed.frontMatter.tag1,
    tag2: parsed.frontMatter.tag2,
    uploadedImages: uploadedUrls.size
  };
}

function parseMarkdownSource(source: string, absolutePath: string): {
  title: string;
  content: string;
  frontMatter: DraftFrontMatter;
} {
  let body = source.replace(/^\uFEFF/, "");
  const frontMatter = parseFrontMatter(body);
  if (frontMatter) {
    body = frontMatter.body;
  }

  let title = frontMatter?.data.title?.trim();
  if (!title) {
    const headingMatch = body.match(/^\s*#\s+(.+?)\s*$/m);
    if (headingMatch?.[1]) {
      title = headingMatch[1].trim();
      body = removeFirstMarkdownHeading(body, headingMatch[0]);
    }
  }
  if (!title) {
    title = basename(absolutePath, extname(absolutePath));
  }

  const content = body.trim();
  if (!content) {
    throw new Error("markdown file is empty after extracting the title.");
  }

  return {
    title,
    content,
    frontMatter: frontMatter?.data ?? {}
  };
}

function parseFrontMatter(source: string): { data: DraftFrontMatter; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) {
    return undefined;
  }

  const data: DraftFrontMatter = {};
  for (const rawLine of (match[1] ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const keyMatch = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
    if (!keyMatch) {
      continue;
    }
    const key = keyMatch[1].toLowerCase();
    const value = keyMatch[2].trim().replace(/^["']|["']$/g, "");
    if (key === "title") {
      data.title = value;
    } else if (key === "tag1" || key === "tag") {
      data.tag1 = value;
    } else if (key === "tag2") {
      data.tag2 = value;
    }
  }

  return {
    data,
    body: source.slice(match[0].length)
  };
}

function removeFirstMarkdownHeading(body: string, headingLine: string): string {
  const index = body.indexOf(headingLine);
  if (index < 0) {
    return body;
  }
  const before = body.slice(0, index);
  const after = body.slice(index + headingLine.length).replace(/^\r?\n/, "").replace(/^\r?\n/, "");
  return `${before}${after}`;
}

async function replaceMarkdownLocalImages(
  content: string,
  baseDir: string,
  upload: (resolvedPath: string) => Promise<string>
): Promise<string> {
  const markdownMatches = Array.from(content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g));
  let next = content;

  for (const match of markdownMatches) {
    const rawTarget = match[2] ?? "";
    const target = extractMarkdownLinkTarget(rawTarget);
    if (!target) {
      continue;
    }
    const resolved = resolveMarkdownImagePath(target, baseDir);
    if (!resolved) {
      continue;
    }
    const uploadedUrl = await upload(resolved);
    next = next.replace(match[0], `![${match[1] ?? ""}](${uploadedUrl})`);
  }

  const htmlMatches = Array.from(next.matchAll(/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi));
  for (const match of htmlMatches) {
    const rawTarget = match[3] ?? "";
    const resolved = resolveMarkdownImagePath(rawTarget, baseDir);
    if (!resolved) {
      continue;
    }
    const uploadedUrl = await upload(resolved);
    next = next.replace(match[0], `<img${match[1] ?? ""}src=${match[2]}${uploadedUrl}${match[2]}${match[4] ?? ""}>`);
  }

  return next;
}

function extractMarkdownLinkTarget(rawTarget: string): string | undefined {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1);
  }
  const quotedTitleIndex = trimmed.search(/\s+["'(]/);
  return quotedTitleIndex >= 0 ? trimmed.slice(0, quotedTitleIndex).trim() : trimmed;
}

function resolveMarkdownImagePath(target: string, baseDir: string): string | undefined {
  if (/^(?:https?:)?\/\//i.test(target) || target.startsWith("data:")) {
    return undefined;
  }
  if (target.startsWith("file://")) {
    try {
      return fileURLToPath(target);
    } catch {
      return undefined;
    }
  }

  const decoded = decodeMarkdownPath(target);
  const candidate = decoded.startsWith("~/")
    ? join(process.env.HOME ?? "", decoded.slice(2))
    : decoded;
  return candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)
    ? candidate
    : resolve(baseDir, candidate);
}

function decodeMarkdownPath(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

async function imageFileFromPath(imagePath: string): Promise<File> {
  if (!looksLikeImagePath(imagePath)) {
    throw new Error(`not an image file: ${imagePath}`);
  }
  await access(imagePath);
  const bytes = await readFile(imagePath);
  return new File([bytes], basename(imagePath), { type: mimeTypeFromPath(imagePath) });
}

function looksLikeImagePath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i.test(value);
}

function mimeTypeFromPath(value: string): string {
  switch (extname(value).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".heic":
      return "image/heic";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function openExternalUrl(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }
  await execFileAsync("xdg-open", [url]);
}

async function launchEditor(options: {
  url: string;
  title: string;
  body: string;
  browser?: string;
}): Promise<{ mode: "safari-autofill" | "external-open" }> {
  const requestedBrowser = options.browser?.trim().toLowerCase();
  if (requestedBrowser && requestedBrowser !== "safari" && requestedBrowser !== "chrome") {
    throw new Error(`unsupported browser "${options.browser}". Use --browser chrome or --browser safari.`);
  }

  if (requestedBrowser === "chrome") {
    // Chrome's AppleScript "execute javascript" cannot reliably override
    // window.confirm or access React internals, so autofill is not supported.
    // Just open the editor URL — the user pastes title & body from clipboard.
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", "Google Chrome", options.url]);
    } else {
      await openExternalUrl(options.url);
    }
    return { mode: "external-open" };
  }

  // Safari: use AppleScript for autofill (Safari's "do JavaScript" works
  // without native permission dialogs unlike Chrome).
  if (requestedBrowser === "safari" && process.platform === "darwin") {
    try {
      await openCc98EditorInSafari(options.url, options.title, options.body);
      return { mode: "safari-autofill" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Safari 自动填表失败，已回退为仅打开 Safari 页面：${message}`);
      await execFileAsync("open", ["-a", "Safari", options.url]);
      return { mode: "external-open" };
    }
  }

  await openExternalUrl(options.url);
  return { mode: "external-open" };
}

async function openCc98EditorInSafari(url: string, title: string, body: string): Promise<void> {
  const fillScript = buildEditorFillScript(title, body);
  const scriptLines = [
    "on run argv",
    "  set targetUrl to item 1 of argv",
    "  set fillScript to item 2 of argv",
    "  tell application \"Safari\"",
    "    activate",
    "    if (count of windows) = 0 then",
    "      make new document",
    "    end if",
    "    tell window 1",
    "      set current tab to (make new tab with properties {URL:targetUrl})",
    "      repeat 120 times",
    "        delay 0.25",
    "        try",
    "          do JavaScript \"document.readyState\" in current tab",
    "          exit repeat",
    "        end try",
    "      end repeat",
    "      delay 0.5",
    "      do JavaScript fillScript in current tab",
    "    end tell",
    "  end tell",
    "end run"
  ];

  const args = scriptLines.flatMap((line) => ["-e", line]).concat(["--", url, fillScript]);
  await execFileAsync("osascript", args, { maxBuffer: 1024 * 1024 * 8 });
}

function buildEditorFillScript(title: string, body: string): string {
  const encodedTitle = JSON.stringify(title);
  const encodedBody = JSON.stringify(body);
  return `
(async () => {
  const title = ${encodedTitle};
  const body = ${encodedBody};

  const setNativeValue = (element, value) => {
    if (!element) return;
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Walk React fiber tree to find the EditForm component and call setState
  // directly, bypassing changeEditor()'s confirm() dialog.
  const seeds = Array.from(document.querySelectorAll("input, textarea, #post-topic-changeMode"));
  let form = null;
  for (const seed of seeds) {
    for (const key of Object.getOwnPropertyNames(seed)) {
      if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$")) continue;
      let node = seed[key];
      while (node) {
        const sn = node.stateNode;
        if (sn && typeof sn.setState === "function" && sn.state && "title" in sn.state && "mdeState" in sn.state) {
          form = sn;
          break;
        }
        node = node.return || null;
      }
      if (form) break;
    }
    if (form) break;
  }

  if (form) {
    form.setState({ mode: 1, title, mdeState: body });
    await new Promise((r) => setTimeout(r, 600));
  }

  // Fallback: set native DOM values
  const titleInput = document.querySelector(
    ".createTopicTitle input, input[placeholder='请输入新主题的标题']"
  );
  if (titleInput instanceof HTMLInputElement && titleInput.value !== title) {
    setNativeValue(titleInput, title);
  }
  const textarea = document.querySelector(".react-mde textarea, .mde-text");
  if (textarea instanceof HTMLTextAreaElement && textarea.value !== body) {
    setNativeValue(textarea, body);
  }

  const titleOk = titleInput instanceof HTMLInputElement && titleInput.value === title;
  const bodyOk = textarea instanceof HTMLTextAreaElement && textarea.value === body;
  return titleOk && bodyOk;
})()
`.trim();
}

function collectBoards(value: unknown): Array<{ boardId: number; name: string }> {
  const results: Array<{ boardId: number; name: string }> = [];
  const visited = new Set<number>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }

    const record = node as Record<string, unknown>;
    const boardId = typeof record.id === "number"
      ? record.id
      : typeof record.boardId === "number"
        ? record.boardId
        : undefined;
    const name = stringOrUndefined(record.name ?? record.title ?? record.boardName);
    if (boardId !== undefined && name && !visited.has(boardId)) {
      visited.add(boardId);
      results.push({ boardId, name });
    }

    walk(record.boards);
    walk(record.children);
    walk(record.subBoards);
    walk(record.items);
  };

  walk(value);
  return results;
}
