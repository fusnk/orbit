/**
 * The look's single choices that both Theme Studio → Look and Settings →
 * Appearance offer (glow, corners, poster size, Home banner, title page
 * background, tint and fonts): their names, hints and options, defined once
 * so the two places can't drift apart. Settings saves a choice at once; the
 * Studio shows it in its draft until Save.
 */
import { t, type MessageKey } from '../../i18n';
import type { LookAppearance } from '../../theme/engine';
import { FONT_PAIRS, type FontPairId } from '../../theme/fonts';

export interface LookChoice<K extends keyof LookAppearance> {
  field: K;
  /** The Studio's key for its control (keeps focus across redraws). */
  key: string;
  label: MessageKey;
  hint: MessageKey;
  options: readonly (readonly [LookAppearance[K], MessageKey])[];
}

export const GLOW: LookChoice<'glow'> = {
  field: 'glow',
  key: 'glow',
  label: 'settings.appearance.glow',
  hint: 'settings.appearance.glow-hint',
  options: [
    ['off', 'settings.common.off'],
    ['subtle', 'settings.appearance.glow-subtle'],
    ['normal', 'settings.common.normal'],
    ['strong', 'settings.appearance.glow-strong'],
  ],
};

export const CORNERS: LookChoice<'corners'> = {
  field: 'corners',
  key: 'corners',
  label: 'settings.appearance.corners',
  hint: 'settings.appearance.corners-hint',
  options: [
    ['sharp', 'settings.appearance.corners-sharp'],
    ['classic', 'settings.appearance.corners-classic'],
    ['round', 'settings.appearance.corners-round'],
  ],
};

export const POSTER_SIZE: LookChoice<'posterSize'> = {
  field: 'posterSize',
  key: 'poster-size',
  label: 'settings.appearance.poster-size-label',
  hint: 'settings.appearance.poster-size-hint',
  options: [
    ['small', 'settings.appearance.poster-small'],
    ['standard', 'settings.appearance.poster-standard'],
    ['large', 'settings.appearance.poster-large'],
  ],
};

export const HERO_STYLE: LookChoice<'heroStyle'> = {
  field: 'heroStyle',
  key: 'hero',
  label: 'settings.appearance.hero',
  hint: 'settings.appearance.hero-hint',
  options: [
    ['card', 'settings.appearance.hero-card'],
    ['cinematic', 'settings.appearance.hero-cinematic'],
    ['spotlight', 'settings.appearance.hero-spotlight'],
    ['carousel', 'herostyles.carousel'],
    ['split', 'herostyles.split'],
  ],
};

export const DETAIL_BACKGROUND: LookChoice<'detailBackground'> = {
  field: 'detailBackground',
  key: 'detail-background',
  label: 'settings.appearance.detail-background',
  hint: 'settings.appearance.detail-background-hint',
  options: [
    ['normal', 'settings.appearance.detail-background-plain'],
    ['blur', 'settings.appearance.detail-background-blur'],
    ['color', 'settings.appearance.detail-background-color'],
  ],
};

/** A choice's options with their names in the current language. */
export const optionsOf = <K extends keyof LookAppearance>(choice: LookChoice<K>) => choice.options.map(([value, label]) => [value, t(label)] as const);

/** The tint switch's name, hint and spoken label. */
export const TINT = { label: 'settings.themes.tint', hint: 'settings.themes.tint-hint', aria: 'settings.themes.tint-label' } as const satisfies Record<string, MessageKey>;

export const FONTS = { label: 'settings.themes.fonts', hint: 'settings.themes.fonts-hint' } as const satisfies Record<string, MessageKey>;

export const fontOptions = () => FONT_PAIRS.map((f) => [f.id as FontPairId, f.label] as const);

/** Shows each font choice (segments in FONT_PAIRS' order) in its own typeface. */
export function inOwnTypefaces(control: HTMLElement): HTMLElement {
  control.querySelectorAll<HTMLElement>('.segment').forEach((button, i) => button.style.setProperty('font-family', FONT_PAIRS[i]!.ui));
  return control;
}
