import type { settingsLayout as source } from '../en/settings-layout';
import type { Catalog } from '../types';

/** Portuguese strings for Settings' layout: the Player page, the pages' chapters and the choice rows. */
export const settingsLayout: Catalog<typeof source> = {
  'settingslayout.intro.player': 'A aparência do player, como os controles respondem e outros players.',
  'settingslayout.intro.playback': 'Apertar Reproduzir, o próximo episódio, os pulos e os trailers.',
  'settingslayout.intro.appearance': 'Estilos, cores, o menu, fundos, páginas de títulos e pôsteres.',
  'settingslayout.keywords.player': 'player layout controles barra de progresso pular volume aumentar minimizar tela cheia prévias voltar externo vlc mpv',
  'settingslayout.chapter.library': 'Biblioteca',
  'settingslayout.chapter.starting': 'Começar um vídeo',
  'settingslayout.chapter.skip-tuning': 'Ajuste fino dos pulos',
  'settingslayout.chapter.player-look': 'Aparência',
  'settingslayout.chapter.player-controls': 'Controles',
  'settingslayout.chapter.player-window': 'Janela e extras',
  'settingslayout.chapter.subtitle-text': 'Idioma e texto',
  'settingslayout.chapter.choosing-source': 'Escolher uma fonte',
  'settingslayout.chapter.ranking-rules': 'Regras de ordem',
  'settingslayout.preview': 'Prévia',
  'settingslayout.none': 'Nenhuma',
};
