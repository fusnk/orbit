import type { placeholderClip as source } from '../en/placeholder-clip';
import type { Catalog } from '../types';

/** Czech strings for a debrid placeholder clip that no other source can replace. */
export const placeholderClip: Catalog<typeof source> = {
  'errors.player.placeholder': "Tento zdroj poslal jen krátký zástupný klip, ne video: služba debrid ho ještě nestáhla. Zkuste jiný zdroj nebo to zkuste později.",
};
