import {
  drawAccountModal,
  drawConfirmModal,
  drawLoginModal
} from "../account-modal.js";
import { Canvas } from "../render-core/canvas.js";
import { emotionCategories, getEmotionPreview, getEmotionCategory } from "../media/emotion-catalog.js";
import { center, pad, rect } from "../render-core/layout.js";
import type { TerminalFrame, TerminalImageOverlay } from "../render-core/terminal.js";
import { blank, cellWidth, fit } from "../render-core/text.js";
import {
  emotionCursor,
  emotionSelectedStyle,
  ruleLine,
  selectedLine,
  textStyle,
  theme
} from "../render-core/theme.js";
import type { TuiState } from "../tui-model.js";

export function drawModalFrame(baseLines: string[], state: TuiState, width: number, height: number): TerminalFrame | undefined {
  if (state.modal === "help") {
    return { text: drawHelpModal(baseLines, state, width, height) };
  }
  if (state.modal === "account") {
    return { text: drawAccountModal(baseLines, state.accountModal, width, height) };
  }
  if (state.modal === "login") {
    return { text: drawLoginModal(baseLines, state.loginForm, width, height) };
  }
  if (state.modal === "confirm" && state.confirmDialog) {
    return { text: drawConfirmModal(baseLines, state.confirmDialog, width, height) };
  }
  if (state.modal === "image" && state.imageViewer) {
    return drawImageModal(baseLines, state, width, height);
  }
  if (state.modal === "compose" && state.composeDialog) {
    return { text: drawComposeModal(baseLines, state, width, height) };
  }
  if (state.modal === "emotion-picker" && state.composeDialog) {
    return drawEmotionPickerModal(baseLines, state, width, height);
  }
  if (state.modal === "rating" && state.ratingDialog) {
    return { text: drawRatingModal(baseLines, state, width, height) };
  }
  if (state.modal === "menu" && state.menuDialog) {
    return { text: drawMenuModal(baseLines, state, width, height) };
  }
  if (state.modal === "input" && state.inputDialog) {
    return { text: drawInputModal(baseLines, state, width, height) };
  }
  if (state.modal === "hidden-patterns" && state.hiddenPatternsDialog) {
    const canvas = new Canvas(width, height);
    canvas.drawLines(rect(width, height), baseLines);
    const d = state.hiddenPatternsDialog;
    const rows = [" 一键隐藏", "", `${d.selectedIndex === 0 ? ">" : " "} ${d.patterns.includes("cy") ? "[x]" : "[ ]"} cy`, `${d.selectedIndex === 1 ? ">" : " "} ${d.patterns.includes("bd") ? "[x]" : "[ ]"} bd (含 bdbd)`, `${d.selectedIndex === 2 ? ">" : " "} ${d.patterns.includes("[ac01]") ? "[x]" : "[ ]"} [ac01]`, `${d.selectedIndex === 3 ? ">" : " "} 自定义: ${d.custom}`, "", " Enter 选择/取消选择  Esc 关闭"];
    const area = center(rect(width, height), Math.min(width - 4, 42), rows.length + 2); canvas.overlay(area, rows); return { text: canvas.toString() };
  }
  return undefined;
}


function drawHelpModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);
  const helpContent = [
    textStyle.primaryBold(" 快捷键帮助"),
    "",
    " 全局",
    "   q           退出程序",
    "   ?           打开/关闭帮助",
    "   j/k         上下移动选择",
    "   ↑/↓         逐行滚动",
    "   h/←/Esc     返回",
    "   l/→/Enter   进入 / 确认",
    "   r           刷新当前视图",
    "   n/Space     加载更多",
    "",
    " 导航与列表",
    "   f           跳到搜索输入框",
    "   s           私信",
    "   a           用户页中关注/取关",
    "   Tab         搜索/关注页切换焦点",
    "   i 或 /      搜索结果中回到输入框",
    "",
    " 主题页",
    "   :数字Enter  跳转到指定楼层",
    "   c           默认打开评论框，可在 keymap 中改",
    "   Shift+c     引用当前楼层后发表评论",
    "   a/s/d       赞/踩/收藏",
    "   A/S         加风评/扣风评",
    "   Enter       在投票项上勾选，在按钮上提交/重置",
    "   z           进入帖子对应版面",
    "   x           复制帖子链接",
    "   u           打开当前楼层作者用户页",
    "   Space       打开图片预览",
    "   ←/→         切换预览图片",
    "",
    " 私信与评论框",
    "   c           默认打开私信框，可在 keymap 中改",
    "",
    " h / Esc / ? / Enter 关闭"
  ];
  const modalHeight = Math.min(height - 2, Math.min(helpContent.length + 2, height - 2));
  const area = center(rect(width, height), 68, modalHeight);
  const viewportHeight = Math.max(1, area.height - 2);
  const maxScroll = Math.max(0, helpContent.length - viewportHeight);
  const visibleScroll = Math.min(Math.max(0, state.helpScroll), maxScroll);
  state.helpScroll = visibleScroll;
  const visibleContent = helpContent.slice(visibleScroll, visibleScroll + viewportHeight);
  const decorated = [...visibleContent];
  if (visibleScroll > 0 && decorated.length > 0) {
    decorated[0] = textStyle.muted(" ↑ 更多");
  }
  if (visibleScroll < maxScroll && decorated.length > 0) {
    decorated[decorated.length - 1] = textStyle.muted(" ↓ 更多");
  }
  canvas.overlay(area, decorated, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawImageModal(baseLines: string[], state: TuiState, width: number, height: number): TerminalFrame {
  const viewer = state.imageViewer;
  if (!viewer) {
    return { text: baseLines.join("\n") };
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const modalWidth = Math.max(24, Math.min(width - 4, Math.floor(width * 0.92)));
  const modalHeight = Math.max(10, Math.min(height - 2, Math.floor(height * 0.9)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  const imageArea = pad(area, 1);

  const rows = Array.from({ length: imageArea.height }, (_, index) => {
    if (viewer.loading && index === Math.floor(imageArea.height / 2)) {
      return fit(textStyle.muted(" 正在加载大图..."), imageArea.width);
    }
    if (viewer.error && index === Math.floor(imageArea.height / 2)) {
      return fit(textStyle.danger(" 图片加载失败"), imageArea.width);
    }
    return " ".repeat(imageArea.width);
  });

  canvas.overlay(area, rows, { fill: theme.color.panelBg });

  const overlayColumns = Math.min(imageArea.width, Math.max(1, viewer.renderSize?.columns ?? imageArea.width));
  const overlayRows = Math.min(imageArea.height, Math.max(1, viewer.renderSize?.rows ?? imageArea.height));
  const overlayColumnOffset = Math.max(0, Math.floor((imageArea.width - overlayColumns) / 2));
  const overlayRowOffset = Math.max(0, Math.floor((imageArea.height - overlayRows) / 2));

  return {
    text: canvas.toString(),
    imageOverlays: viewer.token && imageArea.width > 0 && imageArea.height > 0
      ? [{
        row: imageArea.y + overlayRowOffset + 1,
        column: imageArea.x + overlayColumnOffset + 1,
        token: viewer.token
      }]
      : []
  };
}

function drawComposeModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const compose = state.composeDialog;
  if (!compose) {
    return baseLines.join("\n");
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const modalWidth = Math.min(Math.max(1, width - 2), Math.max(36, Math.floor(width * 0.72)));
  const modalHeight = Math.min(Math.max(1, height - 2), Math.max(10, Math.min(height - 6, 14)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  const innerWidth = Math.max(1, area.width - 2);
  const draftHeight = Math.max(3, area.height - 5);
  const contentWidth = Math.max(1, innerWidth - 1);
  const draftView = buildComposeDraftView(compose.draftUnits, compose.cursorIndex, contentWidth, draftHeight);
  const rows = [
    fit(
      `${textStyle.primaryBold(compose.target.kind === "chat" ? " 发送私信" : " 发表评论")}${textStyle.muted(` ${compose.submitting ? "正在发送..." : "Enter 发送  Shift+Enter 换行  Ctrl+V 粘贴剪贴板  表情快捷键打开表情  Esc 取消"}`)}`,
      innerWidth
    ),
    ruleLine(Math.max(0, innerWidth))
  ];

  for (let index = 0; index < draftHeight; index += 1) {
    const line = draftView.lines[index] ?? "";
    if (line) {
      rows.push(fit(` ${line}`, innerWidth));
    } else if (compose.draft.length === 0 && index === 0) {
      rows.push(textStyle.muted(fit(" 输入评论内容", innerWidth)));
    } else {
      rows.push(" ".repeat(innerWidth));
    }
  }

  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function buildComposeDraftView(
  draftUnits: string[],
  cursorIndex: number,
  width: number,
  viewportHeight: number
): { lines: string[] } {
  const logicalLines = splitComposeUnitsByNewline(draftUnits);
  const visualLines: string[] = [];
  let offset = 0;
  let cursorRow = 0;

  logicalLines.forEach((logicalLine, logicalIndex) => {
    const wrapped = wrapComposeLine(logicalLine, width);
    let segmentOffset = 0;
    wrapped.forEach((segment) => {
      const segmentStart = segmentOffset;
      const segmentEnd = segmentStart + segment.length;
      const hasCursor = cursorIndex >= offset + segmentStart && cursorIndex <= offset + segmentEnd;
      if (hasCursor) {
        cursorRow = visualLines.length;
      }
      visualLines.push(renderComposeCursor(
        segment,
        hasCursor ? cursorIndex - offset - segmentStart : undefined
      ));
      segmentOffset += segment.length;
    });

    offset += logicalLine.length;
    if (logicalIndex < logicalLines.length - 1) {
      if (cursorIndex === offset) {
        cursorRow = visualLines.length;
      }
      offset += 1;
    }
  });

  if (visualLines.length === 0) {
    visualLines.push(renderComposeCursor([], 0));
    cursorRow = 0;
  } else if (cursorIndex === draftUnits.length && draftUnits.at(-1) === "\n") {
    cursorRow = visualLines.length;
    visualLines.push(renderComposeCursor([], 0));
  }

  const start = Math.max(0, Math.min(cursorRow, Math.max(0, visualLines.length - viewportHeight)));
  const lines = visualLines.slice(start, start + viewportHeight);
  while (lines.length < viewportHeight) {
    lines.push("");
  }
  return { lines };
}

function splitComposeUnitsByNewline(units: string[]): string[][] {
  if (units.length === 0) {
    return [[]];
  }

  const lines: string[][] = [[]];
  for (const unit of units) {
    if (unit === "\n") {
      lines.push([]);
      continue;
    }
    lines[lines.length - 1]?.push(unit);
  }
  return lines;
}

function wrapComposeLine(units: string[], width: number): string[][] {
  if (units.length === 0) {
    return [[]];
  }

  const lines: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  for (const unit of units) {
    const unitWidth = cellWidth(unit);
    if (currentWidth + unitWidth > width && current.length > 0) {
      lines.push(current);
      current = [unit];
      currentWidth = unitWidth;
    } else {
      current.push(unit);
      currentWidth += unitWidth;
    }
  }
  lines.push(current);
  return lines;
}

function renderComposeCursor(units: string[], cursorColumn?: number): string {
  if (cursorColumn === undefined) {
    return units.join("");
  }
  const safeIndex = Math.max(0, Math.min(units.length, cursorColumn));
  const cursorGlyph = emotionCursor();
  if (safeIndex === units.length) {
    return `${units.join("")}${cursorGlyph}`;
  }
  return `${units.slice(0, safeIndex).join("")}${cursorGlyph}${units.slice(safeIndex).join("")}`;
}

function drawEmotionPickerModal(baseLines: string[], state: TuiState, width: number, height: number): TerminalFrame {
  const compose = state.composeDialog;
  if (!compose) {
    return { text: baseLines.join("\n") };
  }

  const composeLayer = drawComposeModal(baseLines, state, width, height).split("\n");
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), composeLayer);

  const modalWidth = Math.min(Math.max(1, width - 2), Math.max(56, Math.floor(width * 0.78)));
  const modalHeight = Math.min(Math.max(1, height - 2), Math.max(18, Math.floor(height * 0.72)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  canvas.overlay(area, [], { fill: theme.color.panelBg });

  const inner = pad(area, 1);
  const cellWidthValue = 11;
  const cellHeight = 5;
  const sidebarWidth = Math.max(8, Math.min(12, Math.floor(inner.width * 0.2)));
  const gridArea = {
    x: inner.x + sidebarWidth + 1,
    y: inner.y,
    width: Math.max(1, inner.width - sidebarWidth - 1),
    height: inner.height
  };
  const columns = Math.max(1, Math.floor(gridArea.width / cellWidthValue));
  const previewColumns = Math.max(1, cellWidthValue - 2);
  const sidebarArea = {
    x: inner.x,
    y: inner.y,
    width: sidebarWidth,
    height: inner.height
  };
  const category = getEmotionCategory(compose.emotionCategoryIndex);
  const pageRows = Math.max(1, Math.floor(Math.max(1, gridArea.height - 1) / cellHeight));
  const pageSize = columns * pageRows;
  const start = Math.max(0, Math.floor(compose.emotionSelectedIndex / pageSize) * pageSize);
  const visible = category.entries.slice(start, start + pageSize);
  const imageOverlays: TerminalImageOverlay[] = [];

  const sidebarRows = emotionCategories.map((item, index) => {
    const selected = index === compose.emotionCategoryIndex;
    const row = fit(` ${item.label}`, sidebarArea.width);
    if (selected) {
      return selectedLine(row, sidebarArea.width, true);
    }
    return textStyle.muted(row);
  });
  canvas.drawLines(sidebarArea, sidebarRows.concat(blank(Math.max(0, sidebarArea.height - sidebarRows.length), sidebarArea.width)));
  canvas.verticalRule({ x: inner.x + sidebarWidth, y: inner.y, width: 1, height: inner.height });

  const title = fit(textStyle.primaryBold(` ${category.label} · ${visible.length}/${category.entries.length}`), gridArea.width);
  canvas.drawLines({ x: gridArea.x, y: gridArea.y, width: gridArea.width, height: 1 }, [title]);

  visible.forEach((entry, index) => {
    const localIndex = start + index;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gridArea.x + col * cellWidthValue;
    const y = gridArea.y + 1 + row * cellHeight;
    if (x + cellWidthValue > gridArea.x + gridArea.width || y + cellHeight > gridArea.y + gridArea.height) {
      return;
    }

    const selected = localIndex === compose.emotionSelectedIndex;
    const borderStyle = selected ? emotionSelectedStyle() : theme.color.muted;
    const box = { x, y, width: cellWidthValue, height: cellHeight };
    canvas.frame(box);

    const preview = getEmotionPreview(entry, previewColumns);
    if (preview) {
      imageOverlays.push({
        row: y + 2,
        column: x + 2,
        token: preview.token
      });
    } else {
      canvas.drawLines(
        { x: x + 1, y: y + 1, width: cellWidthValue - 2, height: 2 },
        [
          fit(selected ? textStyle.primarySoft(" 预览中") : textStyle.muted(" 预览中"), cellWidthValue - 2),
          " ".repeat(cellWidthValue - 2)
        ]
      );
    }

    if (selected) {
      tintBox(canvas, box, emotionSelectedStyle());
    } else {
      tintBox(canvas, box, borderStyle);
    }
  });

  return {
    text: canvas.toString(),
    imageOverlays
  };
}

function tintBox(canvas: Canvas, area: { x: number; y: number; width: number; height: number }, style: string): void {
  canvas.drawLines(
    { x: area.x, y: area.y, width: area.width, height: 1 },
    [textStyleWithStyle(`${theme.border.topLeft}${theme.border.horizontal.repeat(Math.max(0, area.width - 2))}${theme.border.topRight}`, style)]
  );
  for (let row = 1; row < area.height - 1; row += 1) {
    canvas.drawLines({ x: area.x, y: area.y + row, width: 1, height: 1 }, [textStyleWithStyle(theme.border.vertical, style)]);
    canvas.drawLines({ x: area.x + area.width - 1, y: area.y + row, width: 1, height: 1 }, [textStyleWithStyle(theme.border.vertical, style)]);
  }
  canvas.drawLines(
    { x: area.x, y: area.y + area.height - 1, width: area.width, height: 1 },
    [textStyleWithStyle(`${theme.border.bottomLeft}${theme.border.horizontal.repeat(Math.max(0, area.width - 2))}${theme.border.bottomRight}`, style)]
  );
}

function drawRatingModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const dialog = state.ratingDialog;
  if (!dialog) {
    return baseLines.join("\n");
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const label = dialog.type === 1 ? "加风评" : "扣风评";
  const innerWidth = Math.max(26, Math.min(width - 6, 42));
  const rows = [
    textStyle.primaryBold(` ${label}`),
    textStyle.muted(" j/k 选择理由"),
    ""
  ];

  for (const reason of dialog.reasons) {
    const selected = reason.id === dialog.selectedReasonId;
    const line = ` ${selected ? theme.marker.selected : "○"} ${reason.name}`;
    rows.push(selected ? selectedLine(line, innerWidth, true) : fit(line, innerWidth));
  }

  rows.push("");
  rows.push(textStyle.muted(" Enter 确认  Esc 取消"));

  const modalWidth = Math.min(width - 2, innerWidth + 2);
  const modalHeight = Math.min(height - 2, rows.length + 2);
  const area = center(rect(width, height), modalWidth, modalHeight);
  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawMenuModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const dialog = state.menuDialog;
  if (!dialog) {
    return baseLines.join("\n");
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const innerWidth = Math.max(26, Math.min(width - 6, 42));
  const rows = [
    textStyle.primaryBold(` ${dialog.title}`),
    textStyle.muted(" j/k 选择"),
    ""
  ];

  for (const item of dialog.items) {
    const selected = item === dialog.items[dialog.selectedIndex];
    const line = ` ${selected ? theme.marker.selected : "○"} ${item.label}`;
    rows.push(selected ? selectedLine(line, innerWidth, true) : fit(line, innerWidth));
  }

  rows.push("");
  rows.push(textStyle.muted(" Enter 确认  Esc 取消"));

  const modalWidth = Math.min(width - 2, innerWidth + 2);
  const modalHeight = Math.min(height - 2, rows.length + 2);
  const area = center(rect(width, height), modalWidth, modalHeight);
  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawInputModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const dialog = state.inputDialog;
  if (!dialog) {
    return baseLines.join("\n");
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const innerWidth = Math.max(30, Math.min(width - 6, 50));
  const rows = [
    textStyle.primaryBold(" 收藏分组"),
    "",
    ` ${dialog.prompt}${dialog.value}${emotionCursor()}`,
    "",
    textStyle.muted(" Enter 确认  Esc 取消")
  ];

  const modalWidth = Math.min(width - 2, innerWidth + 2);
  const modalHeight = Math.min(height - 2, rows.length + 2);
  const area = center(rect(width, height), modalWidth, modalHeight);
  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function textStyleWithStyle(content: string, style: string): string {
  return `${style}${content}\x1b[0m`;
}
