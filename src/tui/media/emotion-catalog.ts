import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEmotionPreview } from "./emotion-preview.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const forumImageRoot = join(moduleDir, "..", "..", "..", "assets", "forum-images");

export type EmotionCategoryId = "CC98" | "ac" | "mj" | "tb" | "ms" | "em";
export type EmotionPickerFocus = "sidebar" | "grid";

export interface EmotionEntry {
  code: string;
  imagePath: string;
}

export interface EmotionCategory {
  id: EmotionCategoryId;
  label: string;
  entries: EmotionEntry[];
}

interface EmotionPreviewCacheEntry {
  token: string;
  columns: number;
  rows: number;
}

const previewCache = new Map<string, EmotionPreviewCacheEntry>();
const previewInflight = new Map<string, Promise<void>>();
const mahjongCartonGifIds = new Set(["018", "049", "096"]);
const mahjongFaceGifIds = new Set(["004", "009", "056", "061", "062", "087", "115", "120", "137", "168", "169", "175", "206"]);

export const emotionCategories: EmotionCategory[] = [
  {
    id: "CC98",
    label: "CC98",
    entries: Array.from({ length: 37 }, (_, index) => {
      const id = String(index + 1).padStart(2, "0");
      const number = index + 1;
      const extension = number > 14 && number < 31 || number > 35 ? "png" : "gif";
      return {
        code: `[cc98${id}]`,
        imagePath: join(forumImageRoot, "CC98", `CC98${id}.${extension}`)
      };
    })
  },
  {
    id: "ac",
    label: "AC",
    entries: Array.from({ length: 149 }, (_, index) => {
      const id = index < 9
        ? `0${index + 1}`
        : index < 54
          ? `${index + 1}`
          : index < 94
            ? `${index + 947}`
            : `${index + 1907}`;
      return {
        code: `[ac${id}]`,
        imagePath: join(forumImageRoot, "ac-dark", `${id}.png`)
      };
    })
  },
  {
    id: "mj",
    label: "麻将练",
    entries: [
      ...Array.from({ length: 16 }, (_, index) => {
        const id = String(index + 1).padStart(3, "0");
        return {
          code: `[a:${id}]`,
          imagePath: join(forumImageRoot, "mahjong", "animal2017", `${id}.png`)
        };
      }),
      ...["003", "018", "019", "046", "049", "059", "096", "134", "189", "217"].map((id) => ({
        code: `[c:${id}]`,
        imagePath: join(
          forumImageRoot,
          "mahjong",
          "carton2017",
          `${id}.${mahjongCartonGifIds.has(id) ? "gif" : "png"}`
        )
      })),
      ...Array.from({ length: 208 }, (_, index) => {
        const id = String(index + 1).padStart(3, "0");
        return {
          code: `[f:${id}]`,
          imagePath: join(
            forumImageRoot,
            "mahjong",
            "face2017",
            `${id}.${mahjongFaceGifIds.has(id) ? "gif" : "png"}`
          )
        };
      })
    ]
  },
  {
    id: "tb",
    label: "贴吧",
    entries: Array.from({ length: 33 }, (_, index) => {
      const id = String(index + 1).padStart(2, "0");
      return {
        code: `[tb${id}]`,
        imagePath: join(forumImageRoot, "tb", `tb${id}.png`)
      };
    })
  },
  {
    id: "ms",
    label: "雀魂",
    entries: Array.from({ length: 54 }, (_, index) => {
      const id = String(index + 1).padStart(2, "0");
      return {
        code: `[ms${id}]`,
        imagePath: join(forumImageRoot, "ms", `ms${id}.png`)
      };
    })
  },
  {
    id: "em",
    label: "经典",
    entries: Array.from({ length: 92 }, (_, index) => {
      if (index < 10) {
        return `0${index}`;
      }
      if (index < 44 || (index > 70 && index < 92)) {
        return `${index}`;
      }
      return undefined;
    })
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        code: `[em${id}]`,
        imagePath: join(forumImageRoot, "em", `em${id}.gif`)
      }))
  }
];

export function getEmotionCategory(index: number): EmotionCategory {
  return emotionCategories[Math.max(0, Math.min(index, emotionCategories.length - 1))] ?? emotionCategories[0];
}

export function getEmotionPreviewCacheKey(entry: EmotionEntry, columns: number): string {
  return `${entry.code}:${columns}`;
}

export function getEmotionPreview(entry: EmotionEntry, columns: number): EmotionPreviewCacheEntry | undefined {
  return previewCache.get(getEmotionPreviewCacheKey(entry, columns));
}

export async function ensureEmotionPreviews(entries: EmotionEntry[], columns: number): Promise<void> {
  if (columns <= 0) {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const key = getEmotionPreviewCacheKey(entry, columns);
    if (previewCache.has(key)) {
      return;
    }
    const existing = previewInflight.get(key);
    if (existing) {
      await existing;
      return;
    }
    const task = (async () => {
      try {
        const preview = await loadEmotionPreview(entry.imagePath, columns);
        if (preview) {
          previewCache.set(key, {
            token: preview.token,
            columns: preview.size.columns,
            rows: preview.size.rows
          });
        }
      } catch {
        // Preview failures should not break the picker; fall back to text-only cells.
      }
    })().finally(() => {
      previewInflight.delete(key);
    });
    previewInflight.set(key, task);
    await task;
  }));
}
