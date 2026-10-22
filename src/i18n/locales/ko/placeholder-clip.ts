import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Korean strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "이 소스는 영상이 아닌 짧은 임시 클립을 보냈어요. Debrid 서비스가 아직 내려받지 않았어요. 다른 소스를 시도하거나 나중에 다시 시도하세요.",
};
