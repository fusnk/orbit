/**
 * The layout sweep's checks (sweep.spec.ts): runs in the page and lists what's drawn wrong on screen now, whatever
 * the page. It knows no class names, so a new page or Look is checked without a test written for it:
 *
 * - overlap: two controls (or a control and a piece of text, or two pieces of text) drawn over each other when
 *   neither holds the other; a control partly under something painted (a capsule, a card, a panel); a control
 *   half on a plate that isn't its own (the plate's edge runs through it).
 * - clipped: a control or text cut part-way by a box that hides its overflow (not one that scrolls, where cards
 *   peeking at the edge are the point), or by the window's edge.
 * - cut text: text wider or taller than its own box with nothing saying so (no ellipsis, no line clamp).
 * - page scrolls sideways: the page wider than the window.
 * - shoved: a box that hides its overflow (the window itself, html and body included) scrolled anyway, which
 *   `scrollIntoView` and focusing do to it. The whole app slides up or sideways and its top or edge is cut off,
 *   with no scrollbar to bring it back.
 *
 * What's wholly under something else (the page under a dialog, a carousel's other slides) is hidden on purpose and
 * skipped. Passed to `page.evaluate`, so it must stay self-contained (no imports, no outer names).
 */
export interface Problem {
  kind: 'overlap' | 'clipped' | 'cut text' | 'page scrolls sideways' | 'shoved';
  what: string;
  /** Boxes to outline on the screenshot. */
  boxes: { x: number; y: number; width: number; height: number }[];
}

export function findLayoutProblems(): Problem[] {
  /** Smaller than this (px, both ways) is anti-aliasing or a shared border, not a bug. */
  const SLACK = 3;
  const CONTROL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])';
  const problems: Problem[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const box = (r: DOMRect) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  const name = (el: Element) => {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const cls = el.getAttribute('class')?.trim().split(/\s+/).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${label ? ` "${label}"` : ''}`;
  };
  const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);

  /** Drawn and seen: has a size, isn't hidden or faded out, and is at least partly in the window. */
  const shown = (el: Element, r: DOMRect) => {
    if (r.width < 2 || r.height < 2) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    for (let a: Element | null = el; a; a = a.parentElement) if (parseFloat(getComputedStyle(a).opacity) < 0.05) return false;
    return true;
  };

  const alpha = (c: string) => (c.startsWith('rgba(') ? Number(c.match(/([\d.]+)\)$/)?.[1] ?? 0) : c.startsWith('rgb(') ? 1 : 0);
  /** Lets clicks through (before the sweep turns pointer-events on everywhere for hit-testing). */
  const clickThrough = new Set<Element>();
  for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).pointerEvents === 'none') clickThrough.add(el);
  const ownText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim());

  /**
   * Puts something on screen itself (a fill, a border, a picture, an icon, its own text), not just a box for others.
   * Decoration doesn't count: a shade (a gradient alone) or a layer that lets clicks through and has no text (a
   * sliding nav indicator, a scrim), since those are meant to lie over things.
   */
  const paints = new Map<Element, boolean>();
  const painted = (el: Element) => {
    let p = paints.get(el);
    if (p !== undefined) return p;
    const cs = getComputedStyle(el);
    // Faded or hidden (a toast waiting off-screen) paints nothing.
    let faded = !el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    for (let a: Element | null = el; a && !faded; a = a.parentElement) faded = parseFloat(getComputedStyle(a).opacity) < 0.05;
    const fill = alpha(cs.backgroundColor) > 0.15 || cs.backdropFilter !== 'none' || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.15);
    const picture = el instanceof SVGElement || ['IMG', 'VIDEO', 'CANVAS', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME'].includes(el.tagName) || /url\(/.test(cs.backgroundImage);
    const decoration = clickThrough.has(el) && !ownText(el);
    p = !faded && !decoration && (fill || picture || ownText(el));
    paints.set(el, p);
    return p;
  };
  /** A plate: a filled or frosted box (a capsule, a bar, a card), not a picture or text. */
  const plate = (el: Element) => {
    if (!painted(el) || el instanceof SVGElement) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width * r.height > (vw * vh) / 2) return false; // the page's own background
    return alpha(cs.backgroundColor) > 0.15 || cs.backdropFilter !== 'none' || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.15);
  };
  /** The elements at a point, top first, keeping only those that paint something there. */
  const paintedAt = (x: number, y: number) => document.elementsFromPoint(x, y).filter(painted);

  /**
   * One of the two stays put (sticky or fixed) and the other scrolls: content passing under a pinned header or
   * bar while the page scrolls, which is how scrolling works, not a layout bug.
   */
  const pinnedBelow = (el: Element, stop: Element | null) => {
    for (let a: Element | null = el; a && a !== stop; a = a.parentElement) if (/sticky|fixed/.test(getComputedStyle(a).position)) return true;
    return false;
  };
  const scrolls = (el: Element) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight) || (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth)) return true;
    }
    return false;
  };
  const common = (a: Element, b: Element) => {
    let c: Element | null = a;
    while (c && !c.contains(b)) c = c.parentElement;
    return c;
  };
  /** The nearest box that scrolls (has more than it shows), or null. */
  /** The boxes that scroll (have more than they show) around `el`, below `stop`. */
  const scrollers = (el: Element, stop: Element | null) => {
    const out: Element[] = [];
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight) || (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth)) out.push(a);
    }
    return out;
  };
  const scrollsUnder = (a: Element, b: Element) => {
    const c = common(a, b);
    if ((pinnedBelow(a, c) && scrolls(b)) || (pinnedBelow(b, c) && scrolls(a))) return true;
    // In different scrolling boxes, one of them scrolled away from its start: they slide past each other. At the
    // start nothing has moved yet, so an overlap there is how the page is laid out, and is checked.
    // (A box both are in moves them together, so only the ones holding just one of them count.)
    const moved = (s: Element) => s.scrollTop > 0 || s.scrollLeft !== 0;
    return [...scrollers(a, c), ...scrollers(b, c)].some(moved);
  };

  /**
   * The part of `r` that overflow-hiding or scrolling boxes let show (null when none does): its ancestors', and for
   * text (`self`) its own too, since an ellipsis or a line clamp cuts the text's box at the element's.
   */
  const visibleRect = (el: Element, r: DOMRect, self = false) => {
    let { left, top, right, bottom } = r;
    for (let a = self ? el : el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        left = Math.max(left, c.left);
        right = Math.min(right, c.right);
      }
      if (cs.overflowY !== 'visible') {
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
    }
    return right - left >= 2 && bottom - top >= 2 ? new DOMRect(left, top, right - left, bottom - top) : null;
  };

  /** Nine points across a box, inside the window. */
  const points = (r: DOMRect) => {
    const out: [number, number][] = [];
    for (const fx of [0.15, 0.5, 0.85])
      for (const fy of [0.2, 0.5, 0.8]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x >= 0 && y >= 0 && x < vw && y < vh) out.push([x, y]);
      }
    return out;
  };

  /**
   * What paints over `el` at some of its points, and whether it's on top anywhere at all. A point where `el` isn't
   * hit at all (outside a round button's corner) says nothing either way.
   */
  const cover = (el: Element, r: DOMRect) => {
    const over = new Set<Element>();
    let seen = false;
    for (const [x, y] of points(r)) {
      const stack = document.elementsFromPoint(x, y);
      const at = stack.findIndex((s) => related(s, el));
      if (at < 0) continue;
      const top = stack.slice(0, at).find((s) => painted(s) && !related(s, el));
      // Something wholly inside the control's box is laid on it on purpose (a card's own buttons).
      const b = top?.getBoundingClientRect();
      if (top && b && b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1) seen = true;
      else if (top) over.add(top);
      else seen = true;
    }
    return { seen, over };
  };

  // Hit-testing must see everything painted, including labels and overlays that let clicks through;
  // what paints nothing (a transparent wrapper) is skipped by `painted`.
  const unblock = document.createElement('style');
  unblock.textContent = '* { pointer-events: auto !important; }';
  document.head.append(unblock);
  try {
    /** `r`: the part that shows; `full`: the whole box, for what's cut off. */
    type Item = { el: Element; r: DOMRect; full: DOMRect; control: boolean };
    const items: Item[] = [];

    for (const el of document.querySelectorAll(CONTROL)) {
      const full = el.getBoundingClientRect();
      const r = visibleRect(el, full);
      if (!r || !shown(el, r)) continue;
      const { seen, over } = cover(el, r);
      if (!seen) continue; // wholly under something: hidden on purpose
      items.push({ el, r, full, control: true });
      for (const c of over) if (!scrollsUnder(el, c)) problems.push({ kind: 'overlap', what: `${name(el)} partly under ${name(c)}`, boxes: [box(r), box(c.getBoundingClientRect())] });
    }
    // Text: the tight box of each element's own text (not its padding), outside the controls already listed.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textOf = new Map<Element, DOMRect>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const el = node.parentElement;
      if (!el || el.closest(CONTROL) || el.closest('script, style, template, title')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      const before = textOf.get(el);
      if (!before) textOf.set(el, r);
      else {
        const left = Math.min(before.left, r.left);
        const top = Math.min(before.top, r.top);
        textOf.set(el, new DOMRect(left, top, Math.max(before.right, r.right) - left, Math.max(before.bottom, r.bottom) - top));
      }
    }
    for (const [el, full] of textOf) {
      const r = visibleRect(el, full, true);
      if (r && shown(el, r) && cover(el, r).seen) items.push({ el, r, full, control: false });
    }

    // overlap: two of them drawn over each other.
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el) || scrollsUnder(a.el, b.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= SLACK || h <= SLACK) continue;
        // One wholly inside the other is placed there on purpose (a card's buttons over it, a badge on a poster).
        const inside = (p: DOMRect, q: DOMRect) => p.left >= q.left - SLACK && p.right <= q.right + SLACK && p.top >= q.top - SLACK && p.bottom <= q.bottom + SLACK;
        if (inside(a.r, b.r) || inside(b.r, a.r)) continue;
        problems.push({ kind: 'overlap', what: `${name(a.el)} × ${name(b.el)} (${Math.round(w)}×${Math.round(h)}px)`, boxes: [box(a.r), box(b.r)] });
      }
    }

    // half on a plate: a painted box under a control, not its own or an ancestor's, whose edge runs through it.
    for (const { el, r, control } of items) {
      if (!control) continue;
      const plates = new Set<Element>();
      for (const [x, y] of points(r)) {
        const stack = paintedAt(x, y);
        const at = stack.findIndex((s) => related(s, el));
        if (at >= 0) for (const under of stack.slice(at + 1)) if (!related(under, el) && plate(under) && !scrollsUnder(el, under)) plates.add(under);
      }
      for (const p of plates) {
        const q = p.getBoundingClientRect();
        const through = (edge: number, from: number, to: number) => edge > from + SLACK && edge < to - SLACK;
        if (through(q.left, r.left, r.right) || through(q.right, r.left, r.right) || through(q.top, r.top, r.bottom) || through(q.bottom, r.top, r.bottom)) {
          problems.push({ kind: 'overlap', what: `${name(el)} half on ${name(p)}`, boxes: [box(r), box(q)] });
        }
      }
    }

    // clipped: cut part-way by an ancestor that hides its overflow, or by the window.
    for (const { el, full: r } of items) {
      let cut = '';
      // Past a box that scrolls along an axis, a cut along it is just scrolling (a card half out of a row or the page).
      let scrollX = false;
      let scrollY = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const hides = (v: string) => v === 'hidden' || v === 'clip';
        const x = hides(cs.overflowX) && !scrollX;
        const y = hides(cs.overflowY) && !scrollY;
        scrollX ||= /auto|scroll/.test(cs.overflowX);
        scrollY ||= /auto|scroll/.test(cs.overflowY);
        if (!x && !y) continue;
        const c = a.getBoundingClientRect();
        // Wholly outside is hidden on purpose (a carousel's other slides); only part-way is a cut.
        if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) break;
        if ((x && Math.max(c.left - r.left, r.right - c.right) > SLACK) || (y && Math.max(c.top - r.top, r.bottom - c.bottom) > SLACK)) {
          cut = `by ${name(a)}`;
          break;
        }
      }
      if (!cut && !scrollX && (r.left < -SLACK || r.right > vw + SLACK)) cut = 'by the window';
      if (cut) problems.push({ kind: 'clipped', what: `${name(el)} ${cut}`, boxes: [box(r)] });
    }

    // cut text: overflows its own box with no ellipsis or line clamp to say there's more.
    for (const el of textOf.keys()) {
      const cs = getComputedStyle(el);
      const hides = (v: string) => v === 'hidden' || v === 'clip';
      if (!hides(cs.overflowX) && !hides(cs.overflowY)) continue;
      if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) continue;
      const he = el as HTMLElement;
      const r = he.getBoundingClientRect();
      if (!shown(el, r)) continue;
      if ((hides(cs.overflowX) && he.scrollWidth > he.clientWidth + SLACK) || (hides(cs.overflowY) && he.scrollHeight > he.clientHeight + SLACK)) {
        problems.push({ kind: 'cut text', what: `${name(el)} (${he.scrollWidth}×${he.scrollHeight} in ${he.clientWidth}×${he.clientHeight})`, boxes: [box(r)] });
      }
    }

    for (const el of [document.documentElement, ...document.querySelectorAll('body, body *')]) {
      if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
      const cs = getComputedStyle(el);
      const hides = (v: string) => v === 'hidden' || v === 'clip';
      const moved = (hides(cs.overflowY) && el.scrollTop !== 0) || (hides(cs.overflowX) && el.scrollLeft !== 0) || el === document.documentElement;
      if (moved) problems.push({ kind: 'shoved', what: `${el === document.documentElement ? 'the window' : name(el)} scrolled ${el.scrollLeft}px across and ${el.scrollTop}px down, though it doesn't scroll`, boxes: [box(el.getBoundingClientRect())] });
    }
    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push({ kind: 'page scrolls sideways', what: `${document.documentElement.scrollWidth}px wide in a ${vw}px window`, boxes: [] });
    }
  } finally {
    unblock.remove();
  }
  return problems;
}
