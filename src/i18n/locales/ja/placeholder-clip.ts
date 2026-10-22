import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Japanese strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "このソースから届いたのは動画ではなく短いプレースホルダー映像です。デブリッドサービスがまだダウンロードしていません。別のソースを試すか、しばらくしてからもう一度お試しください。",
};
