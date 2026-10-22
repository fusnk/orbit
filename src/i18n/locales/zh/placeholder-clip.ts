import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Chinese strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "此片源发送的是一段简短的占位片段，而不是视频：debrid 服务尚未下载它。请尝试其他片源，或稍后再试。",
};
