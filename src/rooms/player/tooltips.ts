import { h } from '../../lib/dom';
import { firstKey, isActionId } from '../../lib/keymap';

/**
 * One delegated tooltip for the player's controls. Only buttons tagged with
 * `data-tooltip-action` (an action whose current key shows as a chip) or
 * `data-tooltip-label` (the text to show) get it, and only those lose their
 * native `title`, so an untagged button keeps its own tooltip.
 */
export function createPlayerTooltips(root: HTMLElement): { hide(): void; dispose(): void } {
  const tip = h('div', { class: 'player-tip', role: 'tooltip', hidden: true });
  root.append(tip);
  let pending: ReturnType<typeof setTimeout> | undefined;
  let active: HTMLElement | null = null;
  let disposed = false;
  let pointerFocus = false;
  const selector = 'button[data-tooltip-label], button[data-tooltip-action]';
  const blocked = () => root.classList.contains('idle') || !!root.querySelector('.player-panel:not([hidden])');
  const stripTitles = () => root.querySelectorAll<HTMLElement>(selector).forEach((button) => button.removeAttribute('title'));
  const hide = () => {
    clearTimeout(pending);
    pending = undefined;
    active = null;
    tip.hidden = true;
  };
  const buttonOf = (target: EventTarget | null): HTMLElement | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>(selector) : null;
    return button && root.contains(button) ? button : null;
  };
  const show = (button: HTMLElement) => {
    if (disposed || blocked() || !button.isConnected || !root.contains(button)) return;
    button.removeAttribute('title');
    const label = button.dataset.tooltipLabel || button.getAttribute('aria-label');
    if (!label) return;
    const action = button.dataset.tooltipAction;
    const key = action && isActionId(action) ? firstKey(action) : null;
    tip.replaceChildren(h('span', { class: 'player-tip-label' }, label));
    if (key) tip.append(h('kbd', { dir: 'ltr' }, key));
    // The transport stays LTR, but its words follow the interface language.
    tip.dir = document.documentElement.dir || 'ltr';
    tip.lang = document.documentElement.lang;
    tip.hidden = false;
    const rect = button.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    const margin = 8;
    tip.style.left = `${Math.max(margin, Math.min(rect.left + (rect.width - bounds.width) / 2, window.innerWidth - bounds.width - margin))}px`;
    tip.style.top = `${Math.max(margin, Math.min(rect.top - bounds.height - margin, window.innerHeight - bounds.height - margin))}px`;
    active = button;
  };
  const over = (event: Event) => {
    const button = buttonOf(event.target);
    if (!button || button.contains((event as PointerEvent).relatedTarget as Node | null) || active === button) return;
    hide();
    pending = setTimeout(() => { pending = undefined; show(button); }, 300);
  };
  const out = (event: Event) => {
    const button = buttonOf(event.target);
    if (button && !button.contains((event as PointerEvent).relatedTarget as Node | null)) hide();
  };
  const down = () => { pointerFocus = true; hide(); };
  const focus = (event: Event) => {
    const button = buttonOf(event.target);
    if (button && (!pointerFocus || button.matches(':focus-visible'))) { hide(); show(button); }
    pointerFocus = false;
  };
  const keydown = (event: Event) => {
    pointerFocus = false;
    if ((event as KeyboardEvent).key === 'Escape') hide();
  };
  const listeners: [string, EventListener][] = [
    ['pointerover', over], ['pointerout', out], ['pointerdown', down],
    ['focusin', focus], ['focusout', hide], ['keydown', keydown],
  ];
  listeners.forEach(([name, listener]) => root.addEventListener(name, listener));
  stripTitles();
  // Only attributes are watched, never text or children (the clock's text changes every second):
  // a title the controls set again on each render (Play/Pause) comes off a tagged button at once…
  const titles = new MutationObserver((records) => {
    for (const { target } of records) if (target instanceof Element && target.matches(selector) && target.hasAttribute('title')) target.removeAttribute('title');
  });
  titles.observe(root, { subtree: true, attributes: true, attributeFilter: ['title'] });
  // …and the tooltip goes when the controls go idle or a panel opens.
  const blockers = new MutationObserver(() => {
    if (!disposed && blocked()) hide();
  });
  blockers.observe(root, { attributes: true, attributeFilter: ['class'] });
  root.querySelectorAll('.player-panel').forEach((panel) => blockers.observe(panel, { attributes: true, attributeFilter: ['hidden'] }));
  return {
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      hide();
      titles.disconnect();
      blockers.disconnect();
      listeners.forEach(([name, listener]) => root.removeEventListener(name, listener));
      tip.remove();
    },
  };
}
