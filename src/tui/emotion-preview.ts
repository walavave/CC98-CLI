import { loadImagePreview, measureImagePreview } from "./image-preview.js";

export const emotionPreviewRows = 3;

export function isEmotionAssetPath(url: string): boolean {
  return /[\\/]assets[\\/]forum-images[\\/](?:CC98|ac|ac-dark|em|tb|ms|mahjong)[\\/]/i.test(url);
}

export async function loadEmotionPreview(url: string, columns: number) {
  return loadImagePreview(url, columns, emotionPreviewRows);
}

export async function measureEmotionPreview(url: string, columns: number) {
  return measureImagePreview(url, columns, emotionPreviewRows);
}
