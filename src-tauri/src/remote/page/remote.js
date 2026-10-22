// Orbit's phone remote. Served by Orbit itself (src-tauri/src/remote/) on the
// home network; no third-party code, no inline script (the page's CSP allows
// only this file). Everything is built with DOM APIs and textContent, never
// parsed as HTML: titles and track names come from addons and video files.
//
// Pairing: the QR code's link carries a one-time token after `#` (the part
// of a link a browser never sends to a server). It's read here, sent once to
// /api/pair and removed from the address bar and history; Orbit answers with
// an HttpOnly session cookie this script can't read. Without a token, the
// person types the 6-digit code Orbit shows.
'use strict';

(() => {
  const app = document.getElementById('app');
  let strings = {};
  /** Which words these are: when Orbit's language changes, the live updates carry a new number. */
  let words = null;

  const t = (key, vars) => {
    const text = strings[`remote.phone.${key}`] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text;
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  /**
   * A button that can't be used for now, while it waits on Orbit: marked
   * aria-disabled rather than disabled, which would drop the focus a screen
   * reader (VoiceOver, TalkBack) or keyboard is on just after pressing it.
   */
  const unavailable = (button, off) => button.setAttribute('aria-disabled', String(!!off));
  // Such a button does nothing when pressed (before its own listener, in the capture phase).
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('button[aria-disabled="true"]')) event.stopPropagation();
    },
    true,
  );
  /** A press that starts something (the next episode, a title): it can't be pressed again for a moment, so a double tap doesn't do it twice. */
  const pressedOnce = (button) => {
    unavailable(button, true);
    window.setTimeout(() => unavailable(button, false), 2500);
  };

  // The same stroke icons as Orbit (24×24).
  const ICONS = {
    play: 'M7.5 5v14l11.5-7z',
    pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
    rewind: 'M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.5 4v4h4',
    forward: 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4v4h-4',
    volume: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
    volumeOff: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5',
    next: 'M5.5 5.5v13l10-6.5zM18.5 5v14',
    stop: 'M6.5 6.5h11v11h-11z',
    up: 'm6 15 6-6 6 6',
    down: 'm6 9 6 6 6-6',
    left: 'm15 5-7 7 7 7',
    right: 'm9 5 7 7-7 7',
    back: 'M19 12H5m6-6-6 6 6 6',
    search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2',
    remote: 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5zM12 7.5h.01M10 12h4M12 10v4',
    browse: 'M4.5 4.5h6v8h-6zM13.5 4.5h6v8h-6zM4.5 16h15M4.5 19.5h10',
    shuffle: 'M4 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1 1.7 2.3 2.7 4.3 2.7H20M4 17h3.5c1.2 0 2.1-.4 2.9-1.1M14.6 8.1c.8-.7 1.7-1.1 2.9-1.1H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5',
    plus: 'M12 5v14M5 12h14',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6 6 18',
    refresh: 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4v4h-4',
  };
  const FILLED = new Set(['play', 'pause', 'stop']);

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    if (FILLED.has(name)) svg.classList.add('filled');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function iconButton(name, label, className) {
    return el('button', { type: 'button', class: `icon-button ${className || ''}`, 'aria-label': label, title: label }, icon(name));
  }

  /** A short buzz, so a press is felt without looking. */
  const buzz = () => {
    try {
      navigator.vibrate?.(8);
    } catch {
      // Not every browser allows it.
    }
  };

  const post = (path, body) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });

  function clock(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  /** A language code as a name in the page's language ("eng" → "English"), else the code itself. */
  function languageName(code) {
    if (!code) return '';
    try {
      const names = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' });
      return names.of(code) || code;
    } catch {
      return code;
    }
  }

  function trackLabel(track, index) {
    const parts = [languageName(track.lang), track.title].filter((p) => p && p.trim());
    // The same words twice ("English · English") read as one.
    const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
    return unique.length ? unique.join(' · ') : t('track', { number: index + 1 });
  }

  // ── Pairing ──

  function pairScreen(message) {
    const input = el('input', {
      id: 'code',
      class: 'code-input',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '6',
      autocomplete: 'one-time-code',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-describedby': 'pair-hint',
    });
    const status = el('p', { class: 'message', role: 'status', text: message || '' });
    const submit = el('button', { type: 'submit', class: 'primary', text: t('connect') });
    const form = el(
      'form',
      { class: 'pair', novalidate: true },
      el('img', { class: 'logo', src: '/icon.svg', alt: '' }),
      el('h1', { text: t('pair-heading') }),
      el('p', { id: 'pair-hint', class: 'hint', text: t('pair-hint') }),
      el('label', { for: 'code', class: 'label', text: t('code') }),
      input,
      submit,
      status,
    );
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (input.value.length !== 6) return input.focus();
      submit.disabled = true;
      status.textContent = t('connecting');
      const outcome = await pair({ code: input.value });
      submit.disabled = false;
      if (outcome === 'ok') return remoteScreen();
      status.textContent = outcome;
      input.select();
    });
    app.replaceChildren(form);
    input.focus();
  }

  /** Pairs with a token or code: 'ok', or what to tell the person. */
  async function pair(offer) {
    try {
      const response = await post('/api/pair', offer);
      if (response.ok) return 'ok';
      const reason = await response
        .json()
        .then((body) => body.error)
        .catch(() => '');
      return { wrong: t('wrong'), locked: t('locked'), closed: t('closed'), full: t('full') }[reason] || t('wrong');
    } catch {
      return t('offline');
    }
  }

  // ── The remote ──

  let state = { playing: null, search: null, picker: 0 };
  let source = null;
  let ui = null;

  /** Sends a command (with a buzz unless `quiet`); resolves to the answer's status, or 0 offline. */
  function send(command, quiet) {
    if (!quiet) buzz();
    return post('/api/command', command)
      .then((response) => {
        if (response.status === 401) signedOut(t('signed-out'));
        else if (!quiet) refused(response.status);
        return response.status;
      })
      .catch(() => {
        showOffline(true);
        return 0;
      });
  }

  let noticeTimer = 0;
  /**
   * A press Orbit turned down, said for a few seconds: too many at once (429) or Orbit busy (503),
   * or not possible now (409: nothing playing any more, a row that changed meanwhile).
   */
  function refused(status) {
    const text = status === 429 || status === 503 ? t('busy') : status === 409 ? t('not-now') : '';
    if (!text || !ui) return;
    window.clearTimeout(noticeTimer);
    ui.notice.textContent = text;
    noticeTimer = window.setTimeout(() => {
      if (ui) ui.notice.textContent = '';
    }, 3500);
  }

  /** Since when Orbit hasn't answered, and how long until that's more likely a new address than a blip. */
  let offlineSince = 0;
  const GONE_AFTER = 20000;

  /**
   * Orbit can't be reached. For a moment that's the Wi-Fi; for longer, most likely Orbit was
   * restarted or the remote turned off and on, which gives it a new address this page can't
   * follow: it then says how to pair again.
   */
  function showOffline(on) {
    if (!ui) return;
    if (!on) offlineSince = 0;
    else if (!offlineSince) offlineSince = Date.now();
    ui.offline.hidden = !on;
    ui.gone.hidden = !on || Date.now() - offlineSince < GONE_AFTER;
  }

  function signedOut(message) {
    window.clearTimeout(retryTimer);
    source?.close();
    source = null;
    ui = null;
    picker = null;
    pickerSerial = -1;
    document.body.classList.remove('sheet-open');
    pairScreen(message);
  }

  /** When the live updates last said anything, and the reconnect waiting to run. */
  let lastHeard = 0;
  let retryTimer = 0;
  /** Orbit says something at least every 20 s (server.rs `KEEP_ALIVE`): a stream quiet for longer is gone. */
  const QUIET = 30000;

  function connect() {
    window.clearTimeout(retryTimer);
    source?.close();
    source = null;
    // Signed out meanwhile: the pairing screen needs no updates.
    if (!ui) return;
    lastHeard = Date.now();
    source = new EventSource('/api/events');
    source.addEventListener('message', (event) => {
      lastHeard = Date.now();
      showOffline(false);
      try {
        state = JSON.parse(event.data);
      } catch {
        return;
      }
      // Orbit now speaks another language: the page starts again in it (the session stays).
      if (words !== null && typeof state.words === 'number' && state.words !== words) return location.reload();
      render();
    });
    source.addEventListener('signed-out', () => signedOut(t('signed-out')));
    source.addEventListener('error', () => {
      showOffline(true);
      // A refused session ends the stream for good; anything else, the browser retries.
      if (source && source.readyState === EventSource.CLOSED) {
        fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
          .then((r) => (r.status === 401 ? signedOut(t('signed-out')) : (retryTimer = window.setTimeout(connect, 3000))))
          .catch(() => (retryTimer = window.setTimeout(connect, 3000)));
      }
    });
  }

  /**
   * A phone that slept, or changed Wi-Fi, can be left with a stream that looks open but hears
   * nothing (iOS especially), showing a stale film as if it were live: such a one starts over,
   * and at once when the page is looked at again.
   */
  function checkAlive() {
    if (offlineSince) showOffline(true);
    if (ui && source && Date.now() - lastHeard > QUIET) {
      showOffline(true);
      connect();
    }
  }
  window.setInterval(checkAlive, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAlive();
  });

  function slider(label, className) {
    return el('input', { type: 'range', class: `slider ${className}`, min: '0', max: '100', step: '1', value: '0', 'aria-label': label, dir: 'ltr' });
  }

  function buildPlayer() {
    const art = el('img', { class: 'art', alt: '', hidden: true });
    const title = el('h2', { class: 'title' });
    const detail = el('p', { class: 'detail' });
    const live = el('span', { class: 'badge', text: t('live'), hidden: true });
    const seek = slider(t('position'), 'seek');
    const elapsed = el('span', { class: 'time' });
    const total = el('span', { class: 'time' });
    const back = iconButton('rewind', t('back-10'), 'jump');
    back.append(el('span', { class: 'jump-label', text: '10' }));
    const forward = iconButton('forward', t('forward-10'), 'jump');
    forward.append(el('span', { class: 'jump-label', text: '10' }));
    const toggle = iconButton('pause', t('pause'), 'big');
    const next = iconButton('next', t('next'), '');
    const mute = iconButton('volume', t('mute'), '');
    const volume = slider(t('volume'), 'volume');
    const subtitles = el('select', { class: 'select', 'aria-label': t('subtitles') });
    const audio = el('select', { class: 'select', 'aria-label': t('audio') });
    const audioRow = el('label', { class: 'field' }, el('span', { text: t('audio') }), audio);
    const stop = el('button', { type: 'button', class: 'secondary stop' }, icon('stop'), el('span', { text: t('stop') }));

    let seeking = false;
    let volumeTimer = 0;
    /**
     * A value just asked for, kept on its slider until Orbit's own state reaches it (or a moment
     * passes, if it never does): updates already on their way would otherwise pull the thumb back.
     */
    const hold = (value) => ({ value, until: Date.now() + 2000 });
    const holding = (held, actual, near) => !!held && Date.now() < held.until && Math.abs(actual - held.value) > near;
    let seekHeld = null;
    let volumeHeld = null;
    let duration = 0;
    /** The position as a screen reader says it ("12:04 of 1:45:30"), not a count of seconds. */
    const sayPosition = (seconds) => seek.setAttribute('aria-valuetext', duration ? t('position-of', { position: clock(seconds), duration: clock(duration) }) : clock(seconds));
    seek.addEventListener('input', () => {
      seeking = true;
      elapsed.textContent = clock(Number(seek.value));
      sayPosition(Number(seek.value));
    });
    seek.addEventListener('change', () => {
      seeking = false;
      seekHeld = hold(Number(seek.value));
      send({ cmd: 'seek-to', seconds: seekHeld.value });
    });
    back.addEventListener('click', () => send({ cmd: 'seek-by', seconds: -10 }));
    forward.addEventListener('click', () => send({ cmd: 'seek-by', seconds: 10 }));
    toggle.addEventListener('click', () => send({ cmd: 'pause', on: !state.playing?.playback?.paused }));
    next.addEventListener('click', () => {
      pressedOnce(next);
      send({ cmd: 'next' });
    });
    mute.addEventListener('click', () => send({ cmd: 'mute', on: !state.playing?.playback?.muted }));
    // While dragging, a few times a second; the last value when let go.
    volume.addEventListener('input', () => {
      volumeHeld = hold(Number(volume.value));
      if (volumeTimer) return;
      volumeTimer = window.setTimeout(() => {
        volumeTimer = 0;
        send({ cmd: 'volume', level: Number(volume.value) });
      }, 150);
    });
    volume.addEventListener('change', () => {
      volumeHeld = hold(Number(volume.value));
      window.clearTimeout(volumeTimer);
      volumeTimer = 0;
      send({ cmd: 'volume', level: Number(volume.value) });
    });
    subtitles.addEventListener('change', () => send({ cmd: 'subtitle', id: subtitles.value === 'off' ? null : Number(subtitles.value) }));
    audio.addEventListener('change', () => send({ cmd: 'audio', id: Number(audio.value) }));
    stop.addEventListener('click', () => send({ cmd: 'stop' }));

    const element = el(
      'section',
      { class: 'player', hidden: true },
      el('div', { class: 'now' }, art, el('div', { class: 'now-text' }, live, title, detail)),
      el('div', { class: 'seek-row', dir: 'ltr' }, elapsed, seek, total),
      el('div', { class: 'transport', dir: 'ltr' }, back, toggle, forward),
      el('div', { class: 'volume-row', dir: 'ltr' }, mute, volume, next),
      el('div', { class: 'tracks' }, el('label', { class: 'field' }, el('span', { text: t('subtitles') }), subtitles), audioRow),
      stop,
    );
    let artSrc = '';
    let trackKey = '';

    function update(playing) {
      element.hidden = !playing;
      if (!playing) return;
      const p = playing.playback || {};
      title.textContent = playing.title;
      detail.textContent = playing.detail || '';
      detail.hidden = !playing.detail;
      live.hidden = !playing.live;
      if ((playing.art || '') !== artSrc) {
        artSrc = playing.art || '';
        art.hidden = !artSrc;
        if (artSrc) art.src = artSrc;
        else art.removeAttribute('src');
      }
      duration = typeof p.duration === 'number' && p.duration > 0 ? p.duration : 0;
      seek.disabled = playing.live || !duration;
      seek.max = String(Math.max(1, Math.floor(duration)));
      if (!seeking && !holding(seekHeld, p.position || 0, 2)) {
        seekHeld = null;
        seek.value = String(Math.floor(p.position || 0));
        elapsed.textContent = clock(p.position);
        sayPosition(p.position || 0);
      }
      total.textContent = duration ? clock(duration) : '';
      back.disabled = forward.disabled = !!playing.live;
      toggle.replaceChildren(icon(p.paused ? 'play' : 'pause'));
      toggle.setAttribute('aria-label', p.paused ? t('play') : t('pause'));
      toggle.title = toggle.getAttribute('aria-label');
      next.hidden = !playing.canNext;
      mute.replaceChildren(icon(p.muted ? 'volumeOff' : 'volume'));
      mute.setAttribute('aria-label', p.muted ? t('unmute') : t('mute'));
      mute.title = mute.getAttribute('aria-label');
      mute.setAttribute('aria-pressed', String(!!p.muted));
      volume.max = String(playing.maxVolume || 100);
      // Not while a level is on its way, but otherwise always (it may be changed on the PC too, while the slider has focus here).
      if (!volumeTimer && !holding(volumeHeld, p.volume ?? 100, 1)) {
        volumeHeld = null;
        volume.value = String(Math.round(p.volume ?? 100));
      }
      // The menus are rebuilt only when the tracks change, so one being picked from stays open.
      const key = JSON.stringify([playing.subtitles, playing.audio]);
      if (key !== trackKey) {
        trackKey = key;
        const subs = playing.subtitles || [];
        subtitles.replaceChildren(
          el('option', { value: 'off', text: t('subtitles-off') }),
          ...subs.map((track, i) => el('option', { value: String(track.id), text: trackLabel(track, i) })),
        );
        subtitles.value = String(subs.find((s) => s.selected)?.id ?? 'off');
        const tracks = playing.audio || [];
        audio.replaceChildren(...tracks.map((track, i) => el('option', { value: String(track.id), text: trackLabel(track, i) })));
        const chosen = tracks.find((a) => a.selected);
        if (chosen) audio.value = String(chosen.id);
        audioRow.hidden = tracks.length < 2;
      }
    }
    return { element, update };
  }

  function buildPad() {
    const key = (name, label, className) => {
      const button = name === 'ok' ? el('button', { type: 'button', class: `pad-ok ${className}`, 'aria-label': label, text: label }) : iconButton(name, label, `pad-key ${className}`);
      button.addEventListener('click', () => send({ cmd: 'nav', key: name }));
      return button;
    };
    const back = el('button', { type: 'button', class: 'secondary pad-back' }, icon('back'), el('span', { text: t('back') }));
    back.addEventListener('click', () => send({ cmd: 'nav', key: 'back' }));
    // Arrows are where they point, in any language: the pad doesn't mirror.
    return el(
      'section',
      { class: 'pad-area' },
      el('div', { class: 'pad', role: 'group', 'aria-label': t('arrows'), dir: 'ltr' }, key('up', t('up'), 'pad-up'), key('left', t('left'), 'pad-left'), key('ok', t('ok'), 'pad-center'), key('right', t('right'), 'pad-right'), key('down', t('down'), 'pad-down')),
      back,
    );
  }

  function buildSearch() {
    const input = el('input', { id: 'query', class: 'search-input', type: 'search', enterkeyhint: 'search', maxlength: '100', placeholder: t('search-placeholder'), 'aria-label': t('search'), autocomplete: 'off' });
    const go = iconButton('search', t('search'), 'search-go');
    const status = el('p', { class: 'message', role: 'status' });
    const list = el('ul', { class: 'results' });
    const form = el('form', { class: 'search-form', role: 'search' }, input, go);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return input.focus();
      input.blur();
      send({ cmd: 'search', query });
    });
    go.type = 'submit';
    let shownKey = '';

    function update(search) {
      if (!search) {
        status.textContent = '';
        list.replaceChildren();
        // So the same search made again (after a profile switch cleared it) shows its results.
        shownKey = '';
        return;
      }
      // Reopened, or searched from another phone: say what the results are for.
      if (!input.value && document.activeElement !== input) input.value = search.query;
      status.textContent = !search.done ? t('searching') : search.failed && !search.results.length ? t('search-failed') : !search.results.length ? t('no-results', { query: search.query }) : '';
      const key = JSON.stringify([search.query, search.done, search.results]);
      if (key === shownKey) return;
      shownKey = key;
      list.replaceChildren(
        ...search.results.map((result, index) => {
          const kind = result.kind === 'movie' ? t('movie') : result.kind === 'series' ? t('series') : '';
          const play = el('button', { type: 'button', class: 'primary small' }, icon('play'), el('span', { text: t('play-on-tv') }));
          const open = el('button', { type: 'button', class: 'secondary small', text: t('open-on-tv') });
          play.addEventListener('click', () => {
            pressedOnce(play);
            send({ cmd: 'open', index, play: true });
          });
          open.addEventListener('click', () => {
            pressedOnce(open);
            send({ cmd: 'open', index, play: false });
          });
          return el(
            'li',
            { class: 'result' },
            result.art ? el('img', { class: 'thumb', src: result.art, alt: '', loading: 'lazy' }) : el('span', { class: 'thumb', 'aria-hidden': 'true' }),
            el('div', { class: 'result-text' }, el('span', { class: 'result-name', text: result.name }), el('span', { class: 'result-meta', text: [kind, result.year].filter(Boolean).join(' · ') })),
            el('div', { class: 'result-actions' }, play, open),
          );
        }),
      );
    }
    return { element: el('section', { class: 'search' }, form, status, list), update, focus: () => input.focus() };
  }

  // ── Browse: Home's rows, moods, Surprise me, and a title's details ──
  //
  // The live updates carry only the picker's number; its titles are read from
  // /api/picker when that moves. A title is named to Orbit by where it is
  // (shelf, the answer it came in, row, index), never by an id or address.

  let picker = null;
  let pickerSerial = -1;
  let pickerBusy = false;

  async function refreshPicker() {
    if (pickerBusy || !ui || state.picker === pickerSerial) return;
    pickerBusy = true;
    const wanted = state.picker;
    let retry = false;
    try {
      const response = await fetch('/api/picker', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) {
        pickerBusy = false;
        return signedOut(t('signed-out'));
      }
      if (!response.ok) throw new Error(String(response.status));
      picker = await response.json();
      pickerSerial = wanted;
      ui?.renderPicker();
    } catch {
      retry = true;
    }
    pickerBusy = false;
    // Too many requests, or offline: try again shortly. Otherwise, a newer number may have come meanwhile.
    if (retry) window.setTimeout(refreshPicker, 1500);
    else refreshPicker();
  }

  /** "2021 · ★ 7.8" (the star never wraps away from its number). */
  const metaLine = (title, extra) => [title.year, ...(extra || []), title.rating ? `★ ${title.rating}` : ''].filter(Boolean).join(' · ');

  /** The first letters of a title's words, for a poster that has no picture. */
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase();
  }

  /** A poster, or its initials if there's none or it doesn't load. */
  function posterArt(title, className) {
    const placeholder = el('span', { class: `${className} placeholder`, 'aria-hidden': 'true', text: initials(title.name) });
    if (!title.art) return placeholder;
    const img = el('img', { class: className, src: title.art, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
    return img;
  }

  /** A title's card in a row: poster, name, year and rating. Opens its details. */
  function posterCard(title, where, open) {
    const label = [title.name, title.year, title.rating ? t('rating', { rating: title.rating }) : ''].filter(Boolean).join(', ');
    const card = el(
      'button',
      { type: 'button', class: 'poster-card', 'aria-label': label },
      posterArt(title, 'poster'),
      el('span', { class: 'poster-name', text: title.name }),
      el('span', { class: 'poster-meta', text: metaLine(title) }),
    );
    card.addEventListener('click', () => open({ ...where, preview: title, opener: card }));
    return card;
  }

  /** A horizontal row of posters from one shelf's row. */
  function posterRow(shelf, from, row, open) {
    const titles = shelf.rows[row]?.titles || [];
    return el('div', { class: 'poster-row' }, ...titles.map((title, index) => posterCard(title, { from, shelf: shelf.id, row, index }, open)));
  }

  function buildBrowse(open) {
    let lastBrowse = 0;
    /** Asks Orbit for Home's rows: when Browse first shows, after a profile switch, or on Refresh. */
    const browse = (force) => {
      const now = Date.now();
      if (!force && now - lastBrowse < 5000) return;
      lastBrowse = now;
      send({ cmd: 'browse' }, !force);
    };

    const refresh = el('button', { type: 'button', class: 'text-button refresh' }, icon('refresh'), el('span', { text: t('refresh') }));
    refresh.addEventListener('click', () => browse(true));

    // Surprise me.
    const surpriseButton = (kind, label) => {
      const button = el('button', { type: 'button', class: 'secondary small', 'aria-pressed': 'false', text: label });
      button.addEventListener('click', () => send({ cmd: 'surprise', kind }));
      return button;
    };
    const movie = surpriseButton('movie', t('surprise-movie'));
    const show = surpriseButton('series', t('surprise-series'));
    const surpriseResult = el('div', { class: 'surprise-result', 'aria-live': 'polite' });
    const surprise = el(
      'section',
      { class: 'surprise-card', 'aria-labelledby': 'surprise-heading' },
      el('div', { class: 'surprise-head' }, el('span', { class: 'surprise-icon', 'aria-hidden': 'true' }, icon('shuffle')), el('div', {}, el('h2', { id: 'surprise-heading', class: 'section-title', text: t('surprise') }), el('p', { class: 'hint', text: t('surprise-hint') }))),
      el('div', { class: 'surprise-actions' }, movie, show),
      surpriseResult,
    );

    // Moods.
    const chips = el('div', { class: 'chips', role: 'group', 'aria-label': t('moods') });
    const moodStatus = el('p', { class: 'message', role: 'status' });
    const moodRow = el('div', { class: 'mood-row' });
    const moods = el('section', { class: 'block', hidden: true }, el('h2', { class: 'section-title', text: t('moods') }), chips, moodStatus, moodRow);

    // Home's rows.
    const status = el('p', { class: 'message browse-status', role: 'status' });
    const retry = el('button', { type: 'button', class: 'secondary small', hidden: true, text: t('refresh') });
    retry.addEventListener('click', () => browse(true));
    const rows = el('div', { class: 'rows' });

    let keys = {};
    /** Redraws a part only when what it shows changed, so rows keep their scroll. */
    const changed = (name, value) => {
      const key = JSON.stringify(value);
      if (keys[name] === key) return false;
      keys[name] = key;
      return true;
    };

    function update(visible) {
      const p = picker || {};
      // Nothing asked yet (or forgotten at a profile switch): ask, once Browse is on screen.
      if (visible && !p.home) browse(false);

      const home = p.home;
      status.textContent = !home || (home.loading && !home.rows.length) ? t('browse-loading') : home.failed && !home.rows.length ? t('browse-failed') : !home.rows.length ? t('browse-empty') : '';
      retry.hidden = !(home && !home.loading && home.failed);
      unavailable(refresh, !!home?.loading);
      if (changed('rows', home && [home.id, home.rows])) {
        rows.replaceChildren(
          ...(home?.rows || []).map((row, r) => el('section', { class: 'block' }, el('h2', { class: 'section-title', text: row.title }), posterRow(home, 'home', r, open))),
        );
      }

      const offered = p.moods || [];
      moods.hidden = !offered.length;
      const mood = p.mood;
      if (changed('chips', [offered, mood?.key])) {
        chips.replaceChildren(
          ...offered.map((m) => {
            const chip = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(mood?.key === m.id), text: m.label });
            chip.addEventListener('click', () => send({ cmd: 'mood', mood: m.id }));
            return chip;
          }),
        );
      }
      moodStatus.textContent = !mood ? '' : mood.loading ? t('mood-loading') : !mood.rows[0]?.titles.length ? t('mood-empty') : '';
      if (changed('mood', mood && !mood.loading && [mood.id, mood.rows])) moodRow.replaceChildren(mood && !mood.loading && mood.rows[0]?.titles.length ? posterRow(mood, 'mood', 0, open) : '');

      const picked = p.surprise;
      movie.setAttribute('aria-pressed', String(picked?.key === 'movie'));
      show.setAttribute('aria-pressed', String(picked?.key === 'series'));
      unavailable(movie, !!picked?.loading);
      unavailable(show, !!picked?.loading);
      if (changed('surprise', picked && [picked.id, picked.loading, picked.failed, picked.rows])) {
        const title = picked?.rows[0]?.titles[0];
        if (!picked) surpriseResult.replaceChildren();
        else if (picked.loading) surpriseResult.replaceChildren(el('p', { class: 'message', text: t('mood-loading') }));
        else if (!title) surpriseResult.replaceChildren(el('p', { class: 'message', text: picked.failed ? t('browse-failed') : t('surprise-none') }));
        else {
          const card = el(
            'button',
            { type: 'button', class: 'surprise-pick' },
            posterArt(title, 'surprise-poster'),
            el('span', { class: 'surprise-text' }, el('span', { class: 'surprise-name', text: title.name }), el('span', { class: 'poster-meta', text: metaLine(title, [title.kind === 'series' ? t('series') : title.kind === 'movie' ? t('movie') : '']) }), el('span', { class: 'surprise-more', text: t('open-on-tv') })),
          );
          card.addEventListener('click', () => open({ from: 'surprise', shelf: picked.id, row: 0, index: 0, preview: title, opener: card }));
          surpriseResult.replaceChildren(card);
        }
      }
    }

    return {
      element: el('section', { class: 'browse' }, el('div', { class: 'browse-top' }, refresh), surprise, moods, el('div', { class: 'browse-status-row' }, status, retry), rows),
      update,
    };
  }

  /** The details sheet: slides up over the page; Play, Add to library, and a show's episodes. */
  function buildSheet(played) {
    const backdrop = el('div', { class: 'sheet-backdrop', hidden: true });
    const artSlot = el('div', { class: 'sheet-art-slot' });
    const name = el('h2', { id: 'sheet-title', class: 'sheet-name' });
    const meta = el('p', { class: 'sheet-meta' });
    const description = el('p', { class: 'sheet-description' });
    const status = el('p', { class: 'message', role: 'status' });
    const play = el('button', { type: 'button', class: 'primary' }, icon('play'), el('span', { text: t('play-on-tv') }));
    const addLabel = el('span', { text: t('add-library') });
    const add = el('button', { type: 'button', class: 'secondary' }, icon('plus'), addLabel);
    const seasons = el('div', { class: 'chips seasons', role: 'group', 'aria-label': t('episodes') });
    const episodes = el('ol', { class: 'episodes' });
    const episodeBlock = el('div', { class: 'episode-block', hidden: true }, el('h3', { class: 'section-title', text: t('episodes') }), seasons, episodes);
    const close = iconButton('close', t('close'), 'sheet-close');
    const sheet = el(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', hidden: true },
      el('div', { class: 'grabber', 'aria-hidden': 'true' }),
      close,
      el('div', { class: 'sheet-top' }, artSlot, el('div', { class: 'sheet-text' }, name, meta)),
      el('div', { class: 'sheet-actions' }, play, add),
      status,
      description,
      episodeBlock,
    );
    play.querySelector('.icon').classList.add('filled');

    let open = null;
    let adding = false;
    let shownKey = '';
    let season = null;
    let hideTimer = 0;

    /** While the sheet is open, the page behind it can't be reached (by touch, keys or a screen reader). */
    const block = (on) => {
      for (const child of app.children) if (child !== sheet && child !== backdrop && !child.classList.contains('notice')) child.inert = on;
    };

    /** The details Orbit sent, if they're this title's. */
    const detailsFor = (ref) => {
      const d = picker?.details;
      return d && d.from === ref.from && d.shelf === ref.shelf && d.row === ref.row && d.index === ref.index ? d : null;
    };

    function drawEpisodes(list) {
      const current = list.find((s) => s.number === season) || list[0];
      for (const chip of seasons.children) chip.setAttribute('aria-pressed', String(Number(chip.dataset.season) === current?.number));
      episodes.replaceChildren(...(current?.episodes || []).map((e) => el('li', { class: 'episode' }, el('span', { class: 'episode-number', text: String(e.number) }), el('span', { class: 'episode-name', text: e.name }))));
    }

    function fill() {
      if (!open) return;
      const d = detailsFor(open);
      const title = d?.title || open.preview;
      const key = JSON.stringify([open.from, open.row, open.index, d?.loading, d?.failed, title]);
      if (key === shownKey) return;
      shownKey = key;
      artSlot.replaceChildren(posterArt(title, 'sheet-art'));
      name.textContent = title.name;
      const kind = title.kind === 'series' ? t('series') : title.kind === 'movie' ? t('movie') : '';
      meta.textContent = metaLine(title, [d?.title?.runtime || '', kind]);
      description.textContent = d?.title?.description || '';
      description.hidden = !description.textContent;
      status.textContent = !d || d.loading ? t('details-loading') : d.failed ? t('details-failed') : '';
      const inLibrary = !!d?.title?.inLibrary;
      if (inLibrary) adding = false;
      unavailable(add, inLibrary || adding);
      add.replaceChildren(icon(inLibrary ? 'check' : 'plus'), addLabel);
      addLabel.textContent = inLibrary ? t('in-library') : t('add-library');
      const list = (d?.title?.seasons || []).filter((s) => s.episodes.length);
      episodeBlock.hidden = !list.length;
      if (!list.some((s) => s.number === season)) season = (list.find((s) => s.number > 0) || list[0])?.number ?? null;
      seasons.replaceChildren(
        ...list.map((s) => {
          const chip = el('button', { type: 'button', class: 'chip', 'data-season': String(s.number), text: s.number === 0 ? t('specials') : t('season', { number: s.number }) });
          chip.addEventListener('click', () => {
            season = s.number;
            drawEpisodes(list);
          });
          return chip;
        }),
      );
      drawEpisodes(list);
    }

    function show(ref) {
      window.clearTimeout(hideTimer);
      open = ref;
      adding = false;
      shownKey = '';
      season = null;
      sheet.scrollTop = 0;
      backdrop.hidden = sheet.hidden = false;
      document.body.classList.add('sheet-open');
      block(true);
      fill();
      // The next frame, so it slides in rather than appearing.
      window.requestAnimationFrame(() => {
        backdrop.classList.add('shown');
        sheet.classList.add('shown');
      });
      close.focus({ preventScroll: true });
      send({ cmd: 'details', from: ref.from, shelf: ref.shelf, row: ref.row, index: ref.index }, true).then((code) => {
        // That answer was replaced meanwhile (a refresh): this title isn't where it was.
        if (code === 409 && open === ref) status.textContent = t('details-failed');
      });
    }

    function hide() {
      if (!open) return;
      const opener = open.opener;
      open = null;
      backdrop.classList.remove('shown');
      sheet.classList.remove('shown');
      document.body.classList.remove('sheet-open');
      block(false);
      // After it has slid away (at once, with reduced motion).
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      hideTimer = window.setTimeout(
        () => {
          backdrop.hidden = sheet.hidden = true;
        },
        still ? 0 : 300,
      );
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    const pick = (action) => (open ? send({ cmd: 'pick', from: open.from, shelf: open.shelf, row: open.row, index: open.index, action }) : Promise.resolve(0));
    play.addEventListener('click', () => {
      void pick('play');
      hide();
      played();
    });
    add.addEventListener('click', () => {
      adding = true;
      unavailable(add, true);
      void pick('add').then((code) => {
        if (code !== 204) {
          adding = false;
          shownKey = '';
          fill();
        }
      });
    });
    close.addEventListener('click', hide);
    backdrop.addEventListener('click', hide);
    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hide();
    });

    return { elements: [backdrop, sheet], show, update: fill };
  }

  function remoteScreen() {
    picker = null;
    pickerSerial = -1;
    const player = buildPlayer();
    const pad = buildPad();
    const search = buildSearch();
    const idle = el('div', { class: 'idle' }, el('p', { class: 'idle-title', text: t('idle') }), el('p', { class: 'hint', text: t('idle-hint') }));
    const retry = el('button', { type: 'button', class: 'secondary small', text: t('retry') });
    retry.addEventListener('click', connect);
    const gone = el('div', { class: 'offline-gone', hidden: true }, el('strong', { text: t('gone-title') }), el('span', { text: t('gone') }), retry);
    const offline = el('div', { class: 'offline', role: 'alert', hidden: true }, el('span', { text: t('offline') }), gone);
    const notice = el('p', { class: 'notice', role: 'status' });
    const disconnect = el('button', { type: 'button', class: 'text-button', text: t('disconnect') });
    disconnect.addEventListener('click', () => {
      post('/api/forget', {}).finally(() => signedOut(''));
    });
    // Play from the sheet goes back to the remote, where what's starting shows.
    const sheet = buildSheet(() => show('remote'));
    const browse = buildBrowse(sheet.show);
    const remotePane = el('div', { class: 'pane', id: 'pane-remote', role: 'tabpanel', 'aria-labelledby': 'tab-remote' }, idle, player.element, pad);
    const browsePane = el('div', { class: 'pane', id: 'pane-browse', role: 'tabpanel', 'aria-labelledby': 'tab-browse', hidden: true }, browse.element);
    const searchPane = el('div', { class: 'pane', id: 'pane-search', role: 'tabpanel', 'aria-labelledby': 'tab-search', hidden: true }, search.element);
    const tabs = [
      { id: 'remote', label: t('tab-remote'), icon: 'remote', pane: remotePane },
      { id: 'browse', label: t('tab-browse'), icon: 'browse', pane: browsePane },
      { id: 'search', label: t('tab-search'), icon: 'search', pane: searchPane },
    ];
    const tabButtons = tabs.map((tab) => {
      const button = el('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': tab.pane.id }, icon(tab.icon), el('span', { text: tab.label }));
      button.addEventListener('click', () => show(tab.id));
      return button;
    });
    // A tab list is one stop for Tab; the arrow keys move between its tabs (as a keyboard or switch user expects of role="tab").
    const tabList = el('nav', { class: 'tabs', role: 'tablist' }, ...tabButtons);
    tabList.addEventListener('keydown', (event) => {
      const from = tabButtons.indexOf(document.activeElement);
      const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const back = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
      const to = event.key === forward ? from + 1 : event.key === back ? from - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (from < 0 || to === null) return;
      event.preventDefault();
      const next = (to + tabs.length) % tabs.length;
      show(tabs[next].id);
      tabButtons[next].focus();
    });
    function show(id) {
      tabs.forEach((tab, i) => {
        tab.pane.hidden = tab.id !== id;
        tabButtons[i].setAttribute('aria-selected', String(tab.id === id));
        tabButtons[i].tabIndex = tab.id === id ? 0 : -1;
      });
      if (id === 'search' && !state.search) search.focus();
      if (id === 'browse') browse.update(true);
    }
    app.replaceChildren(
      el('header', { class: 'top' }, el('img', { class: 'logo small', src: '/icon.svg', alt: '' }), el('span', { class: 'brand', text: t('title') }), disconnect),
      offline,
      remotePane,
      browsePane,
      searchPane,
      tabList,
      ...sheet.elements,
      notice,
    );
    offlineSince = 0;
    ui = {
      offline,
      gone,
      notice,
      render() {
        idle.hidden = !!state.playing;
        player.update(state.playing);
        search.update(state.search);
        refreshPicker();
      },
      renderPicker() {
        browse.update(!browsePane.hidden);
        sheet.update();
      },
    };
    show('remote');
    render();
    connect();
  }

  function render() {
    ui?.render();
  }

  async function boot() {
    try {
      const answer = await fetch('/api/strings', { cache: 'no-store' }).then((r) => r.json());
      strings = answer.strings || {};
      words = typeof answer.words === 'number' ? answer.words : null;
      document.documentElement.lang = answer.lang || 'en';
      document.documentElement.dir = answer.dir === 'rtl' ? 'rtl' : 'ltr';
      document.title = t('title');
    } catch {
      // Without its words the page still works, in key names; it'll say it's offline below.
    }
    // The pairing token is used once and then removed from the address and history.
    const match = /^#pair=([0-9a-f]{64})$/.exec(location.hash);
    if (location.hash) history.replaceState(null, '', '/');
    let session = 0;
    try {
      session = (await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })).status;
    } catch {
      // Offline: said below, or by pairing.
    }
    // Already paired: the link opened again (from the camera, a tab or history) needn't pair, and
    // would only be told its used token has expired, or use up one meant for another phone.
    if (session === 204) return remoteScreen();
    if (match) {
      const outcome = await pair({ token: match[1] });
      return outcome === 'ok' ? remoteScreen() : pairScreen(outcome);
    }
    return pairScreen(session ? '' : t('offline'));
  }

  boot();
})();
