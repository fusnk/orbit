/**
 * Files dragged onto the window from this PC: a video plays in Orbit's
 * player, a subtitle file joins what's playing. Uses Tauri's native drop
 * event (the page's own drag events don't carry paths); Rust accepts only
 * paths that drop really delivered, and checks each file (see
 * src-tauri/src/local.rs). Nothing about a local file goes to the network.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { RoomContext } from './router';
import { icon } from '../components/icons';
import { codedText } from '../components/state-message';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { dropKind, fileName, titleFromFileName } from '../lib/local-media';
import { openPlayer, playerOpen, type PlayRequest } from '../rooms/player';
import './local-drop.css';

interface LocalVideo {
  id: string;
  url: string;
  name: string;
}

/** The player request for a dropped video: a movie with this file as its only source. */
export function localRequest(video: LocalVideo): PlayRequest {
  const { name, year } = titleFromFileName(video.name);
  const source = { id: 'local', url: video.url, addon: t('local.source.addon'), label: t('local.source.label'), meta: '' };
  return { title: { id: video.id, type: 'movie', name, year, genres: [], origins: [] }, source, sources: [source], local: true };
}

export function installLocalDrop(ctx: RoomContext): void {
  const text = h('span', { class: 'local-drop-hint' });
  const overlay = h('div', { class: 'local-drop', 'aria-hidden': 'true', hidden: true }, h('div', { class: 'local-drop-box' }, icon('film'), h('strong', { class: 'local-drop-title' }, t('local.drop.title')), text));
  document.body.append(overlay);

  const show = (paths: readonly string[]) => {
    const kinds = paths.map(dropKind);
    // Only for something a drop here would use.
    const usable = kinds.includes('video') || (kinds.includes('subtitle') && playerOpen());
    overlay.hidden = !usable;
    text.textContent = kinds.includes('video') ? t('local.drop.video-hint') : t('local.drop.subtitle-hint');
  };

  void getCurrentWebview()
    .onDragDropEvent((event) => {
      const drop = event.payload;
      if (drop.type === 'enter') show(drop.paths);
      else if (drop.type === 'leave') overlay.hidden = true;
      else if (drop.type === 'drop') {
        overlay.hidden = true;
        void dropped(drop.paths, ctx);
      }
    })
    .catch((err: unknown) => console.warn('Could not listen for dropped files', err));
}

async function dropped(paths: readonly string[], ctx: RoomContext): Promise<void> {
  const videos = paths.filter((p) => dropKind(p) === 'video');
  const subtitles = paths.filter((p) => dropKind(p) === 'subtitle');
  const first = videos[0];
  if (first) {
    try {
      const video = await invoke<LocalVideo>('local_video', { path: first });
      openPlayer(localRequest(video), ctx);
      // One at a time: the rest of the drop is left alone, and the person is told.
      if (paths.length > 1) toast(t('local.drop.first-only', { name: fileName(first) }));
    } catch (err) {
      console.warn('Could not open the dropped file', err);
      // Rust says why (moved, a folder, a kind Orbit can't play) when it knows.
      toast(codedText(err) ?? t('local.drop.failed'));
    }
    return;
  }
  const subtitle = subtitles[0];
  if (!subtitle) return toast(t('local.drop.unsupported'));
  if (!playerOpen()) return toast(t('local.drop.subtitle-needs-player'));
  try {
    await invoke('local_add_subtitle', { path: subtitle });
    toast(paths.length > 1 ? t('local.drop.subtitle-first-only', { name: fileName(subtitle) }) : t('local.drop.subtitle-added', { name: fileName(subtitle) }));
  } catch (err) {
    console.warn('Could not add the dropped subtitles', err);
    toast(codedText(err) ?? t('local.drop.subtitle-failed'));
  }
}
