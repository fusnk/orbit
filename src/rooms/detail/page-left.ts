import { SHOWN_VIEW } from '../../lib/shown';

/** The view showing now (the outlet can also hold pages kept there hidden, router.ts `keep`). */
const shownView = () => document.querySelector(`.outlet > .${SHOWN_VIEW}`);

/** Whether the page showing now has since been left (Back, another page), for work that finishes later. */
export function pageLeft(): () => boolean {
  const view = shownView();
  return () => shownView() !== view;
}
