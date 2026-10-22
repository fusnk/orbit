import type { palette as source } from '../en/palette';

export const palette: Record<keyof typeof source, string> = {
  'palette.label': 'Paleta de comandos',
  'palette.placeholder': 'Busque títulos, configurações, complementos e ações',
  // Group headings
  'palette.group.recent': 'Recentes',
  'palette.group.suggested': 'Sugestões',
  'palette.group.yours': 'Seus conteúdos',
  'palette.group.titles': 'Títulos',
  'palette.group.settings': 'Configurações',
  'palette.group.addons': 'Complementos',
  'palette.group.actions': 'Ações',
  // Titles from addons, while typing
  'palette.titles.searching': 'Buscando nos seus complementos…',
  'palette.titles.none': 'Nenhum título encontrado',
  'palette.titles.none-can-search': 'Nenhum dos seus complementos pode buscar',
  'palette.titles.failed': 'Seus complementos não conseguiram buscar agora',
  'palette.search-all': 'Ver todos os resultados de “{query}”',
  'palette.no-match': 'Nada corresponde a “{query}”',
  // Where a title of yours was found
  'palette.from.continue': 'Continuar assistindo',
  'palette.from.library': 'Na sua biblioteca',
  'palette.from.queue': 'Na sua fila',
  'palette.from.downloads': 'Baixado',
  'palette.from.watched': 'Assistido',
  'palette.from.list': 'Lista',
  // What a result is
  'palette.kind.page': 'Página',
  'palette.kind.shortcut': 'Atalho · {key}',
  'palette.kind.addon': 'Complemento',
  'palette.kind.category': 'Configurações',
  'palette.kind.setting': 'Configurações · {category}',
  'palette.setting-hidden': '“{setting}” aparece quando você muda “{parent}”.',
  'palette.kind.movie': 'Filme',
  'palette.kind.series': 'Série',
  'palette.kind.title': 'Título',
  // Actions
  'palette.action.profile': 'Trocar de perfil',
  'palette.action.shortcuts': 'Atalhos de teclado',
  'palette.action.install-addon': 'Instalar um complemento…',
  'palette.action.addon-updates': 'Procurar atualizações de complementos',
  // The key hints along the bottom
  'palette.hint.move': 'Mover',
  'palette.hint.open': 'Abrir',
  'palette.hint.groups': 'Próximo grupo',
  'palette.hint.close': 'Fechar',
  // Other words people may type for each Settings category
  'palette.keywords.general': 'idioma início abrir fechar janela bandeja escala zoom movimento efeitos acessibilidade alertas notificações backup restaurar diagnóstico logs importar trakt letterboxd',
  'palette.keywords.playback': 'reprodução automática próximo episódio retomar pular abertura trailer',
  'palette.keywords.addons': 'instalar loja extensões plugins fontes qualidade torrents evitar preferir',
  'palette.keywords.downloads': 'offline armazenamento pasta qualidade',
  'palette.keywords.appearance': 'tema cores destaque fonte escuro claro papel de parede ambiente logo estilos',
  'palette.keywords.shortcuts': 'teclado atalhos teclas remapear',
  'palette.keywords.home-library': 'anime início fileiras assistido continuar spoilers arcos biblioteca metadados',
  'palette.keywords.subtitles': 'legendas idioma forçadas sincronizar surdos letras fonte tamanho cor',
  'palette.keywords.picture-sound': 'imagem vídeo decodificação por hardware hdr áudio som idioma passthrough volume',
  'palette.keywords.accounts': 'stremio jellyfin plex letterboxd discord serviços de streaming sincronizar conta debrid tmdb integrações iptv tv ao vivo canais m3u xtream guia',
  // Settings → Shortcuts
  'palette.shortcut': 'Paleta de comandos',
};
