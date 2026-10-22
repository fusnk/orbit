/**
 * Your own rating on a title page: 0.5–5 stars, a "liked" heart and a
 * private note (see library/ratings.ts). Without an Orbit rating, the
 * person's Letterboxd stars for the film show beside it, labelled as such
 * (read from their diary, never copied into Orbit).
 *
 * The stars keep focus and activation apart, like sliders (slider.ts):
 * focused, the arrow keys move between controls; Enter or Space starts
 * rating (←/→ by half a star, Home clears, End is five), and Enter, Space
 * or ↑/↓ saves while Escape puts it back. A click sets the half star under
 * the pointer, or clears the rating when it's the one already set.
 */
import { letterboxdDiary, letterboxdProfile, stars as starText } from '../../catalog/letterboxd';
import type { Title } from '../../catalog/titles';
import { openDrawer } from '../../components/drawer';
import { icon } from '../../components/icons';
import { ratingBadge } from '../../components/rating-badge';
import { toast } from '../../components/toast';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { clampRating, cleanNote, MAX_NOTE_CHARS, noteLength, onRatingsChange, ratingAt, setUserRating, starFill, userRating } from '../../library/ratings';
import './my-rating.css';

const formatStars = (rating: number) => rating.toLocaleString(locale(), { maximumFractionDigits: 1 });

/** Says what went wrong saving, without losing what the person chose. */
function failed(err: unknown): void {
  console.error('Could not save the rating', err);
  toast(t('ratings.failed'));
}

/**
 * The rating row for a title page. Made once per page and put back into the
 * hero on each redraw (so a rating in progress survives); `dispose` stops
 * it listening.
 */
export function createMyRating(title: Pick<Title, 'id' | 'name' | 'type'>): { element: HTMLElement; dispose(): void } {
  const label = h('span', { class: 'my-rating-label' });
  const starEls = Array.from({ length: 5 }, () => h('span', { class: 'my-rating-star' }, icon('star'), h('span', { class: 'my-rating-fill' }, icon('star', { filled: true }))));
  const starsControl = h(
    'div',
    { class: 'my-rating-stars', role: 'slider', tabindex: '0', 'data-focus-id': 'my-rating', 'aria-valuemin': '0', 'aria-valuemax': '5', title: t('ratings.stars-hint') },
    ...starEls,
  );
  const like = h('button', { class: 'my-rating-like', 'data-focus-id': 'my-rating-like', title: t('ratings.like'), 'aria-label': t('ratings.like') }, icon('heart', { filled: true }));
  const noteButton = h('button', { class: 'button glass my-rating-note-button', 'data-focus-id': 'my-rating-note' }, icon('pencil'));
  const letterboxd = h('span', { class: 'my-rating-letterboxd', hidden: true });
  const noteText = h('p', { class: 'my-rating-note', hidden: true });
  const element = h('div', { class: 'my-rating' }, h('div', { class: 'my-rating-row' }, label, starsControl, like, noteButton, letterboxd), noteText);

  /** The stars shown: the saved rating, or one being chosen (keys) or pointed at. */
  let shown: number | null = null;
  let adjusting = false;
  let hovering = false;
  /** The person's Letterboxd stars and heart for this film, once looked up. */
  let fromLetterboxd: { rating: number | null; liked: boolean } | null = null;

  const saved = () => userRating(title.id);
  const rtl = () => getComputedStyle(starsControl).direction === 'rtl';

  function drawStars(value: number | null): void {
    starEls.forEach((star, i) => (star.dataset.fill = starFill(value, i)));
    starsControl.setAttribute('aria-valuenow', String(value ?? 0));
    starsControl.setAttribute('aria-valuetext', value ? t('ratings.value', { rating: formatStars(value) }) : t('ratings.none'));
  }

  function draw(): void {
    const entry = saved();
    if (!adjusting && !hovering) shown = entry?.rating ?? null;
    drawStars(shown);
    starsControl.setAttribute('aria-label', t('ratings.label'));
    label.textContent = entry?.rating ? t('ratings.label') : t('ratings.rate');
    const liked = !!entry?.liked;
    like.setAttribute('aria-pressed', String(liked));
    noteButton.replaceChildren(icon('pencil'), entry?.note ? t('ratings.note-edit') : t('ratings.note-add'));
    noteText.hidden = !entry?.note;
    noteText.textContent = entry?.note ?? '';
    // Letterboxd's stars only stand in while Orbit has none of its own.
    const lb = !entry?.rating && fromLetterboxd?.rating ? fromLetterboxd : null;
    letterboxd.hidden = !lb;
    if (lb?.rating) {
      const badge = ratingBadge('letterboxd', starText(lb.rating) + (lb.liked ? ' ♥' : ''), t('ratings.letterboxd-hint'));
      badge.setAttribute('aria-label', t('ratings.letterboxd-aria', { rating: formatStars(lb.rating) }));
      letterboxd.replaceChildren(h('span', { class: 'my-rating-letterboxd-label' }, t('ratings.letterboxd')), badge);
    }
  }

  const save = (rating: number | null) => void setUserRating(title.id, { rating }).catch(failed);

  function stopAdjusting(keep: boolean): void {
    if (!adjusting) return;
    adjusting = false;
    delete starsControl.dataset.adjusting;
    const before = saved()?.rating ?? null;
    if (keep && shown !== before) save(shown);
    else shown = before;
    draw();
  }

  starsControl.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'Enter' || event.key === ' ') {
      claim();
      if (event.repeat) return;
      if (adjusting) return stopAdjusting(true);
      adjusting = true;
      starsControl.dataset.adjusting = 'true';
      return;
    }
    if (!adjusting) return;
    // Stars fill from the start side, which is the right in Arabic.
    const forward = rtl() ? 'ArrowLeft' : 'ArrowRight';
    switch (event.key) {
      case 'Escape':
        claim();
        return stopAdjusting(false);
      case 'ArrowUp':
      case 'ArrowDown':
        // Done here: the arrow moves on, as it would without rating.
        return stopAdjusting(true);
      case 'ArrowLeft':
      case 'ArrowRight':
        claim();
        shown = clampRating((shown ?? 0) + (event.key === forward ? 0.5 : -0.5));
        return drawStars(shown);
      case 'Home':
      case 'End':
        claim();
        shown = event.key === 'End' ? 5 : null;
        return drawStars(shown);
    }
  });
  // A hero redraw moves the stars, which blurs them (WebView2) and focuses them
  // again straight after; only a blur that leaves them unfocused ends the rating.
  starsControl.addEventListener('blur', () =>
    queueMicrotask(() => {
      if (!document.hasFocus() || document.activeElement !== starsControl) stopAdjusting(true);
    }),
  );

  /** The rating under the pointer, measured from the start side. */
  function pointed(event: MouseEvent): number {
    const rect = starsControl.getBoundingClientRect();
    const from = rtl() ? rect.right - event.clientX : event.clientX - rect.left;
    return ratingAt(rect.width ? from / rect.width : 0);
  }
  starsControl.addEventListener('pointermove', (event) => {
    if (adjusting) return;
    hovering = true;
    shown = pointed(event);
    drawStars(shown);
  });
  starsControl.addEventListener('pointerleave', () => {
    hovering = false;
    draw();
  });
  starsControl.addEventListener('click', (event) => {
    adjusting = false;
    delete starsControl.dataset.adjusting;
    const value = pointed(event);
    // Clicking the rating already set takes it away, as on Letterboxd.
    save(value === saved()?.rating ? null : value);
    hovering = false;
  });

  like.addEventListener('click', () => void setUserRating(title.id, { liked: !saved()?.liked }).catch(failed));
  noteButton.addEventListener('click', () => openNoteEditor(title));

  // The Letterboxd diary only lists films (by IMDb id), and only recent ones.
  if (title.type === 'movie' && /^tt\d+$/.test(title.id)) {
    void letterboxdProfile()
      .then((profile) => (profile ? letterboxdDiary(profile.user) : []))
      .then((films) => {
        const film = films.find((f) => f.title.id === title.id);
        if (!film?.rating) return;
        fromLetterboxd = { rating: film.rating, liked: film.liked };
        draw();
      })
      .catch((err: unknown) => console.warn('No Letterboxd rating', err));
  }

  draw();
  return { element, dispose: onRatingsChange(draw) };
}

/**
 * The note editor, in a drawer. It opens ready to type, since choosing "Add
 * a note" asked for that (like Ctrl+K for Search). After that the note area
 * separates focus from editing like text fields: Escape stops typing (a
 * second Escape closes), and reached again with the keyboard or a controller
 * it's only focused until Enter or a click.
 */
function openNoteEditor(title: Pick<Title, 'id' | 'name'>): void {
  const existing = userRating(title.id)?.note ?? '';
  const area = h('textarea', { class: 'my-rating-note-field', rows: '8', 'aria-label': t('ratings.note-title'), placeholder: t('ratings.note-placeholder'), readonly: true, 'data-nav-arrows': true, 'data-autofocus': true });
  area.value = existing;
  const count = h('span', { class: 'my-rating-note-count', 'aria-live': 'polite' });
  const save = h('button', { class: 'button primary' }, t('ratings.save'));
  const cancel = h('button', { class: 'button' }, t('ratings.cancel'));
  const remove = h('button', { class: 'button danger', hidden: !existing }, t('ratings.note-delete'));

  const editing = (on: boolean) => {
    area.readOnly = !on;
    area.toggleAttribute('data-nav-arrows', !on);
    area.classList.toggle('editing', on);
  };
  function update(): void {
    const length = noteLength(cleanNote(area.value) ?? '');
    const over = length > MAX_NOTE_CHARS;
    count.textContent = over ? t('ratings.note-too-long', { max: MAX_NOTE_CHARS }) : t('ratings.note-count', { count: length, max: MAX_NOTE_CHARS });
    count.classList.toggle('over', over);
    save.disabled = over;
  }
  area.addEventListener('input', update);
  area.addEventListener('pointerdown', () => editing(true));
  area.addEventListener('blur', () => editing(false));
  area.addEventListener('keydown', (event) => {
    if (area.readOnly) {
      if (event.key === 'Enter') {
        event.preventDefault();
        editing(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      // Stops typing; a second Escape closes the drawer.
      event.preventDefault();
      event.stopPropagation();
      editing(false);
    }
  });

  async function store(note: string | null): Promise<void> {
    try {
      await setUserRating(title.id, { note });
      close();
      toast(note ? t('ratings.note-saved') : t('ratings.note-deleted'));
    } catch (err) {
      failed(err);
    }
  }
  save.addEventListener('click', () => void store(cleanNote(area.value)));
  cancel.addEventListener('click', () => close());
  remove.addEventListener('click', () => void store(null));

  update();
  const content = h(
    'div',
    { class: 'my-rating-editor' },
    h('h2', { class: 'my-rating-editor-title' }, t('ratings.note-title')),
    h('p', { class: 'muted' }, title.name),
    area,
    h('div', { class: 'my-rating-editor-meta' }, h('span', { class: 'muted' }, t('ratings.note-private')), count),
    h('div', { class: 'my-rating-editor-actions' }, remove, h('span', { class: 'my-rating-editor-gap' }), cancel, save),
  );
  const close = openDrawer(content, t('ratings.note-drawer', { name: title.name }));
  editing(true);
  area.setSelectionRange(area.value.length, area.value.length);
}
