/**
 * "Who's watching?" — chooses the profile, and (behind Edit) adds, renames,
 * recolours, locks and deletes profiles. Shown full-window at startup when
 * there's a choice to make (two or more profiles, or a PIN), and as an
 * overlay from the title-bar avatar. Switching to another profile reloads
 * the window so every page starts over with that profile's library and history.
 */
import { invoke } from '@tauri-apps/api/core';
import { isBackKey, onBack } from '../../app/back';
import { icon } from '../../components/icons';
import { pushLayer } from '../../components/layers';
import { toast } from '../../components/toast';
import { syncWatchNext } from '../../library/watch-next';
import { beginEditing, createTextField } from '../../components/text-field';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { withTimeout } from '../../lib/timeout';
import { searchTitles, trendingShows, type TitleHit } from '../../catalog/tmdb';
import { charactersFor, type CharacterChoice } from '../../library/avatar-characters';
import { AVATAR_CATEGORIES, avatarCategoryLabel, avatarGradient, avatarLabel, avatarUrl, isUpload, saveAvatarFromUrl, uploadAvatar, uploadedAvatarUrl } from '../../library/avatars';
import {
  activeProfileId,
  createProfile,
  deleteProfile,
  initial,
  lastProfileId,
  listProfiles,
  PROFILE_COLORS,
  selectProfile,
  setAddonsFrom,
  setProfilePin,
  updateProfile,
  type Profile,
} from '../../library/profiles';
import { LEVEL_LABELS, limitSection, needsParentPin, parentPinPrompt } from './content-limit';
import './profiles.css';
import './parental.css';
import { errorText } from '../../components/state-message';
import { switchProfile } from '../../app/profile-switch';
import { leaveThemeStudio, themeStudioUnsaved } from '../studio';

/** A TMDB picture in the character browser; one that doesn't load leaves its frame bare, not a broken-image icon. */
function lazyPicture(src: string): HTMLImageElement {
  const img = h('img', { src, alt: '', draggable: 'false', loading: 'lazy' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

/** A round avatar: the profile's picture, or its first letter on its colour. */
export function avatar(profile: Pick<Profile, 'name' | 'color' | 'avatar'>, className = 'avatar'): HTMLElement {
  const url = avatarUrl(profile.avatar);
  const el = h('span', { class: url ? `${className} picture` : className, 'aria-hidden': 'true' }, url ? h('img', { src: url, alt: '', draggable: 'false' }) : initial(profile.name));
  el.style.setProperty('--avatar', profile.color);
  // A picture sits on its gradient (profiles.css); the letter keeps the profile's colour.
  if (profile.avatar && (url || isUpload(profile.avatar))) el.classList.add('gradient', `gradient-${avatarGradient(profile.avatar)}`);
  // An uploaded picture is read from disk: the initial shows until it's ready.
  if (isUpload(profile.avatar)) {
    void uploadedAvatarUrl(profile.avatar).then((src) => {
      if (!src) return;
      el.classList.add('picture');
      el.replaceChildren(h('img', { src, alt: '', draggable: 'false' }));
    });
  }
  return el;
}

/**
 * Four dots over a real numeric input (so typing, paste and screen readers
 * work). Calls `onComplete` at four digits; a rejection shows its message,
 * shakes the dots and clears the field. Escape calls `onCancel`; the arrow
 * keys (which have no caret to move among four dots) move focus as anywhere
 * else, so keyboard and controller users are never stuck in the field.
 */
export function pinField(label: string, onComplete: (pin: string) => Promise<void>, onCancel: () => void) {
  const input = h('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', 'aria-label': label, 'data-nav-arrows': true });
  input.addEventListener('keydown', (event) => {
    // Escape or a remote's Back (Backspace deletes a digit here).
    if (!isBackKey(event)) return;
    // Handled here, not by Back: at startup there is no Back handler yet, and in
    // the switcher Back would close the whole picker rather than this step.
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  });
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, ...Array.from({ length: 4 }, () => h('span', { class: 'pin-dot' })));
  const message = h('p', { class: 'pin-message', role: 'alert' });
  let busy = false;
  const sync = () => dots.querySelectorAll('.pin-dot').forEach((dot, i) => dot.classList.toggle('filled', i < input.value.length));
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
    sync();
    if (input.value.length < 4 || busy) return;
    busy = true;
    onComplete(input.value)
      .catch((err: unknown) => {
        message.textContent = errorText(err);
        dots.classList.remove('shake');
        void dots.offsetWidth; // restart the animation
        dots.classList.add('shake');
      })
      .finally(() => {
        busy = false;
        input.value = '';
        sync();
      });
  });
  return { element: h('div', { class: 'pin-block' }, h('label', { class: 'pin-field' }, input, dots), message), input };
}

interface ChooserOptions {
  current: string | null;
  /** The profile to start on when none is current (the one picked last time). */
  preferred?: string | null;
  /** Called after the profile is selected (its PIN, if any, already checked). */
  onChosen(id: string): void;
  /** Asked before choosing another profile (before its PIN); false to stay on this one. */
  beforeSwitch?: () => Promise<boolean>;
  /** Makes the chosen profile active: `selectProfile`, or `switchProfile` while one is in use. */
  select?: (id: string, pin?: string) => Promise<void>;
  onCancel?: () => void;
  /** Called after any profile was added, changed or deleted. */
  onChanged?: () => void;
  /** Opens on "Manage profiles" (editing, PINs and content limits) rather than "Who's watching?". */
  manage?: boolean;
}

/** Editing fields consume their first Escape; otherwise Back (Escape, a remote's Back…) is Cancel, returning to the grid. */
export function handleProfileEditorEscape(event: Pick<KeyboardEvent, 'key' | 'target' | 'defaultPrevented' | 'preventDefault' | 'stopPropagation'>, cancel: () => void): void {
  if (!isBackKey(event) || event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  cancel();
}

function chooser(initialProfiles: Profile[], options: ChooserOptions): HTMLElement {
  let profiles = initialProfiles;
  let managing = options.manage === true;
  let cancelEditor: (() => void) | null = null;
  const body = h('div', { class: 'who-body' });
  const screen = h('div', { class: 'who', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('titles.profiles.who') }, h('div', { class: 'who-glow', 'aria-hidden': 'true' }), body);

  screen.addEventListener('keydown', (event) => { if (cancelEditor) handleProfileEditorEscape(event, cancelEditor); });

  const focusLater = (target: HTMLElement | null | undefined) => requestAnimationFrame(() => target?.focus({ preventScroll: true }));

  async function reload(focusId?: string): Promise<void> {
    profiles = await listProfiles();
    options.onChanged?.();
    showGrid(focusId);
  }

  function showGrid(focusId?: string): void {
    cancelEditor = null;
    const failed = h('p', { class: 'pin-message who-grid-message', role: 'alert' });
    const tiles = profiles.map((profile) => {
      const level = profile.contentLimit.level;
      const limitLabel = level !== 'off' ? t(LEVEL_LABELS[level]) : '';
      // The badges are pictures of what the label already says.
      const label = [managing ? t('titles.profiles.edit-named', { name: profile.name }) : profile.name, profile.hasPin ? t('titles.profiles.pin-protected') : '', limitLabel].filter(Boolean).join(', ');
      const tile = h(
        'button',
        { class: managing ? 'who-tile managing' : 'who-tile', 'data-focus-id': profile.id, 'aria-current': String(profile.id === options.current), 'aria-label': label },
        h(
          'span',
          { class: 'who-avatar' },
          avatar(profile, 'avatar large'),
          managing ? h('span', { class: 'who-edit-mark', 'aria-hidden': 'true' }, icon('pencil')) : '',
          profile.hasPin ? h('span', { class: 'who-badge who-badge-lock', title: t('titles.profiles.pin-protected'), 'aria-hidden': 'true' }, icon('lock')) : '',
          limitLabel ? h('span', { class: 'who-badge who-badge-kids', title: t('parental.badge', { level: limitLabel }), 'aria-hidden': 'true' }, limitLabel) : '',
        ),
        h('span', { class: 'who-name' }, profile.name),
      );
      tile.addEventListener('click', () => {
        if (managing) return showEditor(profile);
        // The profile in use is already unlocked.
        if (profile.id === options.current) return options.onChosen(profile.id);
        failed.textContent = '';
        void (options.beforeSwitch?.() ?? Promise.resolve(true))
          .then((go) => {
            if (!go) return;
            if (profile.hasPin) return showUnlock(profile);
            return (options.select ?? selectProfile)(profile.id).then(() => options.onChosen(profile.id));
          })
          // Said here rather than the press doing nothing (the keychain couldn't be read, say).
          .catch((err: unknown) => (failed.textContent = errorText(err)));
      });
      return tile;
    });
    const add = h('button', { class: 'who-tile who-tile-add', 'data-focus-id': 'add' }, h('span', { class: 'who-avatar' }, h('span', { class: 'avatar large add' }, icon('plus'))), h('span', { class: 'who-name' }, t('titles.profiles.add')));
    add.addEventListener('click', () => showEditor(null));
    tiles.push(add);

    const edit = h('button', { class: managing ? 'button large glass' : 'who-manage', 'data-focus-id': 'manage' }, managing ? t('titles.common.done') : t('titles.profiles.manage'));
    edit.addEventListener('click', () => {
      managing = !managing;
      showGrid('manage');
    });
    const actions = h('div', { class: 'who-actions' }, edit);
    if (options.onCancel && !managing) {
      const cancel = h('button', { class: 'button large glass' }, t('titles.common.cancel'));
      cancel.addEventListener('click', () => options.onCancel?.());
      actions.append(cancel);
    }
    const heading = managing ? t('titles.profiles.manage') : t('titles.profiles.who');
    // The screen is named after what it's for now (Who's watching, or Manage profiles).
    screen.setAttribute('aria-label', heading);
    body.replaceChildren(h('h1', { class: 'who-title' }, heading), h('div', { class: 'who-grid' }, ...tiles), failed, actions);
    focusLater((focusId && body.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)) || body.querySelector<HTMLElement>('[aria-current="true"]') || tiles.find((t) => t.dataset.focusId === options.preferred) || tiles[0]);
  }

  function showUnlock(profile: Profile): void {
    // Choosing the profile is the request to type, so the field is ready for digits.
    // Escape returns to the profiles rather than leaving the picker.
    const pin = pinField(
      t('titles.profiles.pin-for', { name: profile.name }),
      (value) => (options.select ?? selectProfile)(profile.id, value).then(() => options.onChosen(profile.id)),
      () => showGrid(profile.id),
    );
    const back = h('button', { class: 'button large glass' }, t('titles.common.back'));
    back.addEventListener('click', () => showGrid(profile.id));
    body.replaceChildren(avatar(profile, 'avatar large'), h('h1', { class: 'who-title small' }, profile.name), h('p', { class: 'muted' }, t('titles.profiles.enter-pin')), pin.element, h('div', { class: 'who-actions' }, back));
    pin.input.focus();
  }

  /** Adds a profile (`profile` null) or edits one. */
  function showEditor(profile: Profile | null): void {
    cancelEditor = () => showGrid(profile?.id ?? 'add');
    const isCurrent = !!profile && profile.id === options.current;
    // Rust refuses changes to another PIN-locked profile; say so up front.
    const locked = !!profile && profile.hasPin && !isCurrent;
    let color = profile?.color ?? PROFILE_COLORS.find((c) => !profiles.some((p) => p.color === c)) ?? PROFILE_COLORS[0];
    let picture = profile?.avatar ?? null;
    // The upload or TMDB character this profile has (or was just given), offered again among the choices.
    let uploaded = isUpload(picture) ? picture : null;
    const preview = h('span', { class: 'who-avatar' });
    const name = createTextField({ label: t('titles.profiles.name'), placeholder: t('titles.profiles.name'), className: 'who-name-field', onSubmit: () => void save() });
    name.value = profile?.name ?? '';
    name.maxLength = 24;
    // As the rest of a locked editor: Enter would only be refused (switch to the profile first).
    name.disabled = locked;
    const message = h('p', { class: 'pin-message', role: 'alert' });
    const drawPreview = () => {
      preview.replaceChildren(avatar({ name: name.value || '?', color, avatar: picture }, 'avatar xl'));
      // Colours only apply to the letter avatar.
      swatchRow.hidden = !!picture;
    };
    name.addEventListener('input', drawPreview);

    // The big picture beside the name: choosing it opens the pictures to choose from.
    const changePicture = h(
      'button',
      { class: 'picture-preview', 'aria-label': t('avatars.change'), title: t('avatars.change'), disabled: locked },
      preview,
      h('span', { class: 'picture-preview-edit', 'aria-hidden': 'true' }, icon('pencil')),
    );
    changePicture.addEventListener('click', () => showPictures());

    const swatches = PROFILE_COLORS.map((c) => {
      const swatch = h('button', { class: 'swatch', 'aria-pressed': String(c === color), 'aria-label': t('titles.profiles.colour-named', { color: c }), disabled: locked });
      swatch.style.setProperty('--swatch', c);
      swatch.addEventListener('click', () => {
        color = c;
        swatches.forEach((s) => s.setAttribute('aria-pressed', String(s === swatch)));
        drawPreview();
      });
      return swatch;
    });

    const swatchRow = h('div', { class: 'swatches', role: 'group', 'aria-label': t('titles.profiles.colour') }, ...swatches);

    // While a profile has a content limit, adding one asks for a parent's PIN here.
    const parentPin = h('div');
    async function save(pin?: string): Promise<void> {
      try {
        if (profile) await updateProfile(profile.id, name.value, color, picture);
        else await createProfile(name.value, color, picture, pin);
        await reload(profile?.id ?? 'add');
      } catch (err) {
        // A wrong PIN is shown by the PIN field.
        if (pin !== undefined) throw err;
        if (!profile && needsParentPin(err)) {
          // Escape takes the prompt (and the focused field) away: focus goes back to Add rather than the page.
          parentPin.replaceChildren(parentPinPrompt(pinField, t('parental.parent-pin-create'), (value) => save(value), () => (parentPin.replaceChildren(), saveButton.focus({ preventScroll: true }))));
          return;
        }
        message.textContent = errorText(err);
      }
    }

    const saveButton = h('button', { class: 'button large primary' }, profile ? t('titles.profiles.save') : t('titles.profiles.add'));
    saveButton.addEventListener('click', () => void save());
    const cancel = h('button', { class: 'button large glass' }, t('titles.common.cancel'));
    cancel.addEventListener('click', () => showGrid(profile?.id ?? 'add'));

    const sections: (HTMLElement | string)[] = [
      h('h1', { class: 'who-title small' }, profile ? t('titles.profiles.edit-profile') : t('titles.profiles.add')),
      locked ? h('p', { class: 'muted' }, t('titles.profiles.locked', { name: profile.name })) : '',
      h('div', { class: 'who-identity' }, changePicture, h('div', { class: 'who-identity-fields' }, name, swatchRow)),
    ];

    /** Back to the editor (whose fields kept their state), on `focus`. */
    const showEditorAgain = (focus: HTMLElement) => {
      body.replaceChildren(...sections);
      drawPreview();
      focusLater(focus);
    };

    /** Escape steps back within the editor rather than leaving the picker (see pinField). */
    const escapeTo = (panel: HTMLElement, back: () => void) =>
      panel.addEventListener('keydown', (event) => {
        if (!isBackKey(event) || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        back();
      });

    /** One square choice; `pressed` null for an action (Upload, Browse), and the chosen one carries a check. */
    const pictureTile = (label: string, content: HTMLElement, pressed: boolean | null, onChoose: () => void) => {
      const tile = h('button', { class: 'picture-tile', 'aria-label': label, title: label }, content, pressed ? h('span', { class: 'picture-check', 'aria-hidden': 'true' }, icon('check')) : '');
      if (pressed !== null) tile.setAttribute('aria-pressed', String(pressed));
      tile.addEventListener('click', onChoose);
      return tile;
    };

    /**
     * "Choose a picture": the letter, your own picture, Upload and the TMDB
     * characters first, then every bundled picture under its group's heading.
     * Choosing one returns to the editor.
     */
    function showPictures(focusBrowse = false): void {
      const back = () => showEditorAgain(changePicture);
      const choose = (value: string | null) => {
        picture = value;
        back();
      };
      const note = h('p', { class: 'pin-message', role: 'alert' });
      const letterName = name.value || profile?.name || '?';
      const tile = (label: string, value: string | null) => pictureTile(label, avatar({ name: letterName, color, avatar: value }, 'avatar tile'), value === picture, () => choose(value));
      const tiles: HTMLElement[] = [tile(t('titles.profiles.letter'), null)];
      if (uploaded) tiles.push(tile(t('titles.profiles.your-picture'), uploaded));
      const uploadInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        uploadInput.value = '';
        if (!file) return;
        note.textContent = '';
        void uploadAvatar(file)
          .then((saved) => {
            uploaded = saved;
            // Only from this screen: after Back while it saved, the screen shown stays.
            if (panel.isConnected) choose(saved);
          })
          .catch((err: unknown) => (note.textContent = errorText(err)));
      });
      const action = (label: string, iconName: 'upload' | 'search', onChoose: () => void) =>
        pictureTile(label, h('span', { class: 'avatar tile add' }, icon(iconName), h('span', { class: 'picture-tile-label' }, label)), null, onChoose);
      const browse = action(t('avatars.browse'), 'search', () => showCharacters());
      tiles.push(
        action(t('titles.profiles.upload'), 'upload', () => uploadInput.click()),
        browse,
      );
      const group = (label: string, options: HTMLElement[], ...after: HTMLElement[]) =>
        h('section', { class: 'picture-group' }, h('h2', { class: 'picture-group-label' }, label), h('div', { class: 'picture-grid', role: 'group', 'aria-label': label }, ...options), ...after);
      const groups = AVATAR_CATEGORIES.filter((category) => category.names.length).map((category) =>
        group(
          avatarCategoryLabel(category.id),
          category.names.map((n) => tile(t('titles.profiles.picture-named', { name: avatarLabel(n) }), n)),
        ),
      );
      const backButton = h('button', { class: 'button large glass' }, t('titles.common.back'));
      backButton.addEventListener('click', back);
      const panel = h(
        'div',
        { class: 'who-pictures' },
        h('h1', { class: 'who-title small' }, t('avatars.choose-title')),
        group(t('titles.profiles.picture'), tiles, uploadInput, note),
        ...groups,
        h('div', { class: 'who-actions' }, backButton),
      );
      escapeTo(panel, back);
      body.replaceChildren(panel);
      // The chosen picture may be far down the page: it's brought into view.
      const start = focusBrowse ? browse : (panel.querySelector<HTMLElement>('.picture-tile[aria-pressed="true"]') ?? tiles[0]);
      requestAnimationFrame(() => {
        start?.focus({ preventScroll: true });
        start?.scrollIntoView({ block: 'center' });
      });
    }

    /**
     * "Browse show characters": this week's popular shows as quick picks, or a
     * TMDB search and the titles found, then one's cast as tiles; choosing a
     * character saves their picture through Rust and returns to the editor.
     */
    function showCharacters(): void {
      const back = () => showPictures(true);
      const results = h('div', { class: 'characters-results', 'aria-live': 'polite' });
      const note = h('p', { class: 'pin-message', role: 'alert' });
      const credit = h('p', { class: 'muted characters-credit' }, t('avatars.from-tmdb'));
      const chips = h('div', { class: 'chips character-chips', role: 'group', 'aria-label': t('avatars.trending'), hidden: true });
      const search = createTextField({ label: t('avatars.search'), placeholder: t('avatars.search'), className: 'character-search', onSubmit: (value) => void findTitles(value) });
      search.maxLength = 100;
      const backButton = h('button', { class: 'button large glass' }, t('titles.common.back'));
      backButton.addEventListener('click', back);
      const panel = h(
        'div',
        { class: 'who-characters' },
        h('h1', { class: 'who-title small' }, t('avatars.browse-title')),
        h('p', { class: 'muted' }, t('avatars.browse-hint')),
        chips,
        h('div', { class: 'who-form' }, search),
        results,
        note,
        credit,
        h('div', { class: 'who-actions' }, backButton),
      );
      escapeTo(panel, back);
      body.replaceChildren(panel);
      // Focused, not editing: the popular shows below may be all that's wanted.
      focusLater(search);

      let generation = 0;
      const pressChip = (chosen: Element | null) => chips.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(chip === chosen)));

      // This week's popular shows; the first one's characters show straight away.
      void trendingShows(profile?.contentLimit)
        .then((shows) => {
          if (shows === null) {
            if (!results.childElementCount) results.replaceChildren(h('p', { class: 'muted' }, t('avatars.no-tmdb')));
            return;
          }
          const buttons = shows.map((show) => {
            const chip = h('button', { class: 'chip', 'aria-pressed': 'false', title: show.name }, h('span', { class: 'chip-name', dir: 'auto' }, show.name));
            chip.addEventListener('click', () => {
              pressChip(chip);
              void showCast(show, null);
            });
            return chip;
          });
          chips.replaceChildren(...buttons);
          chips.hidden = !buttons.length;
          // Not over a search started meanwhile; focus moves only if it's still where it began.
          if (!buttons[0] || generation) return;
          pressChip(buttons[0]);
          void showCast(shows[0]!, null, false);
          if (document.activeElement === search && search.readOnly) focusLater(buttons[0]);
        })
        .catch(() => {});

      async function findTitles(query: string): Promise<void> {
        const trimmed = query.trim();
        if (!trimmed) return;
        const mine = ++generation;
        note.textContent = '';
        try {
          const hits = await searchTitles(trimmed, profile?.contentLimit);
          if (mine !== generation) return;
          pressChip(null);
          if (hits === null) return void results.replaceChildren(h('p', { class: 'muted' }, t('avatars.no-tmdb')));
          if (!hits.length) return void results.replaceChildren(h('p', { class: 'muted' }, t('avatars.no-titles', { query: trimmed })));
          showTitles(hits);
        } catch (err) {
          if (mine === generation) note.textContent = errorText(err);
        }
      }

      function showTitles(hits: TitleHit[]): void {
        const list = hits.map((hit) => {
          const button = h(
            'button',
            { class: 'character-title' },
            h('span', { class: 'character-title-poster' }, hit.poster ? lazyPicture(hit.poster) : ''),
            h('span', { class: 'character-title-name', dir: 'auto' }, hit.name),
            hit.year ? h('span', { class: 'character-title-year' }, hit.year) : '',
          );
          button.addEventListener('click', () => void showCast(hit, hits));
          return button;
        });
        results.replaceChildren(h('div', { class: 'character-titles' }, ...list));
        focusLater(list[0]);
      }

      /** `hit`'s characters as tiles; `hits` are the search results to go back to, if any. */
      async function showCast(hit: TitleHit, hits: TitleHit[] | null, focus = true): Promise<void> {
        const mine = ++generation;
        note.textContent = '';
        let found: Awaited<ReturnType<typeof charactersFor>>;
        try {
          found = await charactersFor(hit);
        } catch (err) {
          if (mine === generation) note.textContent = errorText(err);
          return;
        }
        if (mine !== generation) return;
        credit.textContent = found?.from === 'anilist' ? t('avatarchars.from-anilist') : t('avatars.from-tmdb');
        let others: HTMLElement | undefined;
        if (hits) {
          others = h('button', { class: 'button glass' }, t('avatars.titles-back'));
          others.addEventListener('click', () => showTitles(hits));
        }
        const members = (found?.choices ?? []).map((choice) => {
          // Names reach the page as text only (h() makes text nodes), each in its own direction
          // (dir=auto): in a right-to-left page a long Latin name is cut at its end, not its start.
          const button = h(
            'button',
            { class: 'character-option', 'aria-label': choiceLabel(choice, hit.name) },
            h('span', { class: `character-photo gradient gradient-${avatarGradient(choice.key)}`, 'aria-hidden': 'true' }, lazyPicture(choice.image)),
            h('span', { class: 'character-name', dir: 'auto' }, choice.name),
            choiceNote(choice, hit.name),
          );
          button.addEventListener('click', () => void choose(choice.image));
          return button;
        });
        results.replaceChildren(
          h('div', { class: 'characters-head' }, h('h2', { class: 'who-section-label' }, t('avatars.cast-of', { name: hit.name })), others ?? ''),
          members.length ? h('div', { class: 'characters-grid' }, ...members) : h('p', { class: 'muted' }, t('avatars.no-cast', { name: hit.name })),
        );
        if (focus) focusLater(members[0] ?? others);
      }

      async function choose(url: string): Promise<void> {
        note.textContent = t('avatars.saving');
        try {
          const saved = await saveAvatarFromUrl(url);
          picture = uploaded = saved;
          // Only from this panel: after Back (or Cancel) while it saved, the screen shown stays.
          if (panel.isConnected) showEditorAgain(changePicture);
        } catch (err) {
          note.textContent = errorText(err);
        }
      }
    }
    if (profile && !locked) sections.push(pinSection(profile, isCurrent));
    // Shown for every profile: a parent can set a child's limit even when the child has a PIN (Rust checks who may).
    if (profile) sections.push(limitSection(profile, profiles, { pinField, changed: () => options.onChanged?.() }));
    if (profile && !locked && profiles.length > 1) sections.push(addonsSection(profile));
    if (profile && !locked && profiles.length > 1) sections.push(deleteSection(profile));
    sections.push(message, parentPin, h('div', { class: 'who-actions' }, locked ? '' : saveButton, cancel));
    body.replaceChildren(...sections);
    drawPreview();
    // "Add profile" is the request to type a name; editing starts on the field, ready to activate.
    if (!profile) beginEditing(name);
    else focusLater(locked ? cancel : name);
  }

  /** Set, change or remove the PIN — only for the profile in use. */
  function pinSection(profile: Profile, isCurrent: boolean): HTMLElement {
    const section = h('div', { class: 'who-section' });
    if (!isCurrent) {
      section.append(h('p', { class: 'muted' }, t('titles.profiles.switch-to-set-pin', { name: profile.name })));
      return section;
    }
    const draw = () => {
      const set = h('button', { class: 'button' }, profile.hasPin ? t('titles.profiles.change-pin') : t('titles.profiles.set-pin'));
      // Escape puts the PIN buttons back, rather than closing the whole picker.
      const back = () => {
        draw();
        section.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      };
      /** The new PIN is typed twice: a typo saved at once would lock the person out of their own profile, with no way back in. */
      const askNew = (mismatch = false) => {
        const pin = pinField(
          t('titles.profiles.new-pin'),
          async (first) => {
            const again = pinField(
              t('titles.profiles.confirm-pin'),
              async (second) => {
                if (second !== first) return askNew(true);
                await setProfilePin(first);
                profile.hasPin = true;
                // A locked profile's titles leave the TV's home screen.
                syncWatchNext();
                await reload(profile.id);
              },
              back,
            );
            section.replaceChildren(h('p', { class: 'muted' }, t('titles.profiles.confirm-pin')), again.element);
            again.input.focus();
          },
          back,
        );
        if (mismatch) pin.element.querySelector('.pin-message')!.textContent = t('titles.profiles.pin-mismatch');
        section.replaceChildren(h('p', { class: 'muted' }, t('titles.profiles.type-new-pin')), pin.element);
        pin.input.focus();
      };
      set.addEventListener('click', () => askNew());
      const remove = h('button', { class: 'button', hidden: !profile.hasPin }, t('titles.profiles.remove-pin'));
      // Removing can fail (the keychain refused): said here, rather than the press doing nothing.
      const failed = h('p', { class: 'pin-message', role: 'alert' });
      remove.addEventListener('click', () => {
        failed.textContent = '';
        void setProfilePin(null)
          .then(() => {
            syncWatchNext();
            return reload(profile.id);
          })
          .catch((err: unknown) => (failed.textContent = errorText(err)));
      });
      section.replaceChildren(h('span', { class: 'who-section-label' }, profile.hasPin ? t('titles.profiles.pin-on') : t('titles.profiles.no-pin')), set, remove, failed);
    };
    draw();
    return section;
  }

  /** Own addon list, or another profile's (read-only, e.g. a kid following a parent). */
  function addonsSection(profile: Profile): HTMLElement {
    const label = h('span', { class: 'who-section-label' }, t('titles.profiles.addons'));
    const followers = profiles.filter((p) => p.addonsFrom === profile.id);
    // Links are one level deep (Rust enforces it too).
    if (followers.length) {
      const names = followers.map((p) => p.name).join(', ');
      return h('div', { class: 'who-section' }, label, h('p', { class: 'muted' }, tn('titles.profiles.followers', followers.length, { names, name: profile.name })));
    }
    const current = profiles.find((p) => p.id === profile.addonsFrom);
    // Linking and unlinking need the other profile's PIN, i.e. being that profile.
    const needsPin = (p: Profile | undefined) => !!p && p.hasPin && p.id !== options.current;
    const note = h(
      'p',
      { class: 'muted' },
      !current
        ? t('titles.profiles.addons-hint')
        : current.hasPin
          ? t('titles.profiles.addons-locked', { name: profile.name, source: current.name })
          : t('titles.profiles.addons-unlocked', { name: profile.name, source: current.name }),
    );
    const sources = profiles.filter((p) => p.id !== profile.id && !p.addonsFrom);
    const choices = [undefined, ...sources].map((source) => {
      const chosen = source?.id === current?.id;
      const choice = h(
        'button',
        { class: 'segment', 'aria-pressed': String(chosen), disabled: !chosen && (needsPin(current) || needsPin(source)) },
        source ? t('titles.profiles.use-source', { name: source.name }) : t('titles.profiles.own-list'),
      );
      choice.addEventListener('click', () => {
        if (chosen) return;
        void setAddonsFrom(profile.id, source?.id ?? null)
          .then(() => reload(profile.id))
          .catch((err: unknown) => (note.textContent = errorText(err)));
      });
      return choice;
    });
    return h('div', { class: 'who-section' }, label, h('div', { class: 'segments', role: 'group', 'aria-label': t('titles.profiles.addons') }, ...choices), note);
  }

  /**
   * A delete whose cleanup failed (a keychain entry or a download left behind)
   * still deleted the profile, and cleared it if it was the one in use: said,
   * and the grid redrawn without it, rather than an editor for a profile that's gone.
   */
  function deletedAnyway(err: unknown): void {
    if (String(err) !== 'err.profile.cleanup') throw err;
    toast(errorText(err));
  }

  function deleteSection(profile: Profile): HTMLElement {
    const button = h('button', { class: 'button danger' }, t('titles.profiles.delete'));
    const note = h('p', { class: 'muted', hidden: true }, t('titles.profiles.delete-note', { name: profile.name }));
    // A profile with a content limit asks for a parent's PIN here.
    const parentPin = h('div');
    button.addEventListener('click', () => {
      if (!button.dataset.armed) {
        button.dataset.armed = 'true';
        button.textContent = t('titles.profiles.delete-named', { name: profile.name });
        note.hidden = false;
        return;
      }
      void deleteProfile(profile.id)
        .catch(deletedAnyway)
        .then(() => reload())
        .catch((err: unknown) => {
          if (!needsParentPin(err)) {
            note.textContent = errorText(err);
            return;
          }
          parentPin.replaceChildren(
            // Escape takes the prompt (and the focused field) away: focus goes back to Delete rather than the page.
            parentPinPrompt(pinField, t('parental.parent-pin-prompt'), (pin) => deleteProfile(profile.id, pin).catch(deletedAnyway).then(() => reload()), () => (parentPin.replaceChildren(), button.focus({ preventScroll: true }))),
          );
        });
    });
    return h('div', { class: 'who-section' }, button, note, parentPin);
  }

  showGrid();
  return screen;
}

/** Startup: shows "Who's watching?" in `root` and resolves once a profile is chosen. */
export async function pickProfileAtStart(root: HTMLElement): Promise<void> {
  // Bounded: if profiles can't be read, startup shows an error with Retry rather than a blank window.
  const [profiles, preferred] = await withTimeout(Promise.all([listProfiles(), lastProfileId()]), 8000, 'Loading profiles');
  await new Promise<void>((resolve) => {
    root.replaceChildren(chooser(profiles, { current: null, preferred, onChosen: () => resolve() }));
  });
  root.replaceChildren();
}

/** The picker's steps around asking Theme Studio to let go of unsaved edits (see `leaveStudioFirst`). */
export type StudioStep = {
  unsaved(): boolean;
  /** The Studio's "Leave without saving?": true once it has closed, false to keep editing. */
  ask(): Promise<boolean>;
  /** Whether the picker was closed meanwhile. */
  dismissed(): boolean;
  /** Hides the picker and drops its layer and Back handler, so the Studio's prompt takes the keys. */
  stepAside(): void;
  /** Shows the picker again, with its layer and Back handler. */
  stepBack(): void;
  /** Closes the picker for good, leaving focus with the Studio. */
  stay(): void;
};

/**
 * True when the picker may go on (switch or start over). A picker closed while the Studio
 * asked never comes back as a layer, and nothing switches after it.
 */
export async function leaveStudioFirst(step: StudioStep): Promise<boolean> {
  if (!step.unsaved()) return true;
  step.stepAside();
  const left = await step.ask();
  if (step.dismissed()) return false;
  if (!left) {
    step.stay();
    return false;
  }
  step.stepBack();
  return true;
}

/** Set from the first press until the switcher closes, so a double click or click + Enter opens one picker, not two. */
let switcherOpen = false;

/**
 * From the title bar: the picker over the app. Choosing another profile
 * switches to it. With `manage` (Settings → General → Profiles), it opens
 * on managing them.
 */
export async function openProfileSwitcher(manage = false): Promise<void> {
  // The profiles load before the overlay (and its layer) exist, and during that
  // wait the avatar is still live: a second press must not start another picker.
  if (switcherOpen) return;
  switcherOpen = true;
  let profiles: Profile[];
  let current: string | null;
  try {
    [profiles, current] = await Promise.all([listProfiles(), activeProfileId()]);
  } catch (err) {
    switcherOpen = false;
    throw err;
  }
  const returnFocus = document.activeElement;
  let changed = false;
  let removeBack = () => {};
  let removeLayer = () => {};
  let dismissed = false;
  const dismiss = (refocus = true) => {
    dismissed = true;
    removeBack();
    overlay.remove();
    removeLayer();
    switcherOpen = false;
    if (refocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  };
  /**
   * Unsaved Theme Studio edits are asked about before switching or starting over: the reload
   * would drop them, and a save after the switch would land in the other profile. The picker
   * (its layer, which holds the Studio inert, and its Back handler) steps aside while the Studio asks.
   */
  const leaveStudio = () =>
    leaveStudioFirst({
      unsaved: themeStudioUnsaved,
      ask: leaveThemeStudio,
      dismissed: () => dismissed,
      stepAside: () => {
        overlay.hidden = true;
        removeBack();
        removeLayer();
      },
      stepBack: () => {
        overlay.hidden = false;
        removeBack = onBack(close);
        removeLayer = pushLayer(overlay, close);
      },
      // Keep editing: focus stays with the Studio, not the avatar the picker was opened from.
      stay: () => dismiss(false),
    });
  // A fresh start: every page, cached page and the player belong to the old profile.
  const restart = () => void leaveStudio().then((left) => left && invoke('player_stop').finally(() => location.reload()));
  const close = () => {
    // The title bar shows the current profile, which may have been renamed,
    // recoloured or deleted: after any change, start over.
    if (changed) return restart();
    dismiss();
  };
  const overlay = chooser(profiles, {
    current,
    manage,
    beforeSwitch: leaveStudio,
    select: switchProfile,
    onCancel: close,
    onChanged: () => (changed = true),
    onChosen: (id) => (id === current ? close() : restart()),
  });
  overlay.classList.add('overlay');
  removeBack = onBack(close);
  document.body.append(overlay);
  removeLayer = pushLayer(overlay, close);
}

/** A character tile's name for screen readers: whose picture it is, when it isn't the character's. */
function choiceLabel(choice: CharacterChoice, title: string): string {
  if (!choice.named || !choice.actor) return choice.name;
  if (choice.source === 'actor') return t('avatarchars.actor-photo-label', { character: choice.name, actor: choice.actor });
  if (choice.source === 'poster') return t('avatarchars.poster-label', { character: choice.name, title });
  return t('avatars.character-as', { character: choice.name, actor: choice.actor });
}

/** The line under a character's name: the actor, or what the picture is when it doesn't show the character. */
function choiceNote(choice: CharacterChoice, title: string): HTMLElement | string {
  if (!choice.named || !choice.actor) return '';
  const text = choice.source === 'actor' ? t('avatarchars.actor-photo', { actor: choice.actor }) : choice.source === 'poster' ? t('avatarchars.poster', { title }) : choice.actor;
  return h('span', { class: 'character-actor', dir: 'auto' }, text);
}