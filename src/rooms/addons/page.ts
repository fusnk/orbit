/**
 * The Addons page: "Add an addon" (the install-by-link field) above the
 * installed list. It's the same panel as Settings → Addons & Sources, without
 * the Source preferences tab. Reached from Quick settings, Ctrl+K, or the nav
 * once shown in Theme Studio → Layout (hidden by default).
 */
import type { Room } from '../../app/router';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { createAddonsPanel } from './index';
import './addons-page.css';

export const addonsRoom: Room = {
  id: 'addons',
  label: t('addonspage.nav'),
  render: () =>
    h(
      'div',
      { class: 'room addons-page' },
      h('div', { class: 'addons-page-head' }, h('h1', { class: 'page-title' }, t('addonspage.title')), h('p', { class: 'muted' }, t('addonspage.intro'))),
      createAddonsPanel(undefined, true),
    ),
};
