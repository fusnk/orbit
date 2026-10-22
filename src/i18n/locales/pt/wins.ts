import type { wins as source } from '../en/wins';
import type { Catalog } from '../types';

/** Portuguese strings for the Nuvio-requested extras. */
export const wins: Catalog<typeof source> = {
  // Discover filters: a range of years, runtime, cast and director (rooms/explore/filter-bar.ts)
  'explore.filters.year-from': 'De',
  'explore.filters.year-to': 'Até',
  'explore.filters.runtime': 'Duração',
  'explore.filters.runtime-min': 'No mínimo',
  'explore.filters.runtime-max': 'No máximo',
  'explore.filters.minutes': '{count} min',
  'explore.filters.cast': 'Elenco',
  'explore.filters.director': 'Direção ou equipe',
  'explore.filters.person-search': 'Buscar pessoas: {what}',
  'explore.filters.person-placeholder': 'Digite um nome',
  'explore.filters.person-none': 'Ninguém encontrado',
  'explore.filters.person-clear': 'Remover {name}',
  // Settings → Playback → Rewind cache (rooms/settings/player.ts)
  'settings.player.rewind': 'Cache para voltar',
  'settings.player.rewind-hint': 'Quanto do vídeo fica na memória, para voltar na hora. Mais usa até cerca de 600 MB de RAM durante a reprodução; Máximo, até cerca de 1,5 GB. Vale a partir do próximo vídeo.',
  'settings.player.rewind-standard': 'Padrão',
  'settings.player.rewind-more': 'Mais',
  'settings.player.rewind-most': 'Máximo',
  // Settings → Subtitles: opacity, box and outline colours (rooms/settings/subtitles.ts)
  'subs.style.opacity': 'Opacidade do texto',
  'subs.style.box-colour': 'Cor da caixa',
  'subs.style.box-opacity': 'Opacidade da caixa',
  'subs.style.box-opacity-hint': 'A caixa tem cantos retos: o player não consegue arredondá-los.',
  'subs.style.outline-colour': 'Cor do contorno',
  'player.subtitle-style.black': 'Preto',
  'player.subtitle-style.grey': 'Cinza',
  'player.subtitle-style.navy': 'Azul-marinho',
  // Addons: health, counts and refreshing one manifest (rooms/addons/index.ts)
  'addons.health.no-answer': 'Não respondeu',
  'addons.health.count': '{installed} · {enabled}',
  'addons.health.installed.one': '{count} instalado',
  'addons.health.installed.other': '{count} instalados',
  'addons.health.enabled.one': '{count} ativado',
  'addons.health.enabled.other': '{count} ativados',
  'addons.health.refresh': 'Atualizar complemento',
  'addons.health.refreshing': 'Atualizando {name}…',
  'addons.health.refreshed': '{name} foi atualizado.',
  'addons.health.unchanged': '{name} respondeu: nada mudou.',
  'addons.health.refresh-failed': '{name} não respondeu. O Orbit continua usando o que tinha.',
  // Source preferences: minimum size (rooms/settings/playback.ts, rooms/detail/streams.ts)
  'sources.rules.min-size': 'Tamanho mínimo',
  'sources.rules.min-size-hint': 'Para filmes; episódios recebem um terço. Arquivos menores, muitas vezes falsos ou gravados no cinema, vão depois de todos os outros, mas nunca são ocultados. Fontes que não informam o tamanho não são afetadas.',
  'titles.why.under-size': 'Abaixo do seu mínimo de {size} GB',
  // Searching collections (rooms/collections/overview.ts, page.ts)
  'collections.search.label': 'Encontrar uma coleção',
  'collections.search.placeholder': 'Encontrar uma coleção',
  'collections.search.none': 'Nenhuma coleção corresponde',
  'collections.search.none-detail': 'A busca inclui nomes e grupos.',
  'collections.search.titles-label': 'Encontrar um título nesta coleção',
  'collections.search.titles-placeholder': 'Encontrar um título',
  'collections.search.no-titles': 'Nenhum título aqui corresponde',
  // Release Radar → Export to calendar (rooms/library/calendar.ts)
  'radar.export': 'Exportar para o calendário (.ics)',
  'radar.export.hint': 'Salva o que o Radar mostra num arquivo que qualquer app de calendário pode importar.',
  'radar.export.name': 'Radar de lançamentos do Orbit',
  // Automatic skips after a delay (rooms/player/skip-controller.ts, rooms/settings/playback.ts)
  'playerplus.skip.auto-in': '{label} em {seconds}',
  'playerplus.settings.skip-delay': 'Esperar antes de pular automaticamente',
  'playerplus.settings.skip-delay-hint': 'Para trechos em Automático: o botão Pular faz uma contagem regressiva antes. Pressione qualquer tecla para parar e assistir.',
  'playerplus.settings.skip-delay-none': 'Sem espera',
};
