import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Melhor correspondência',
  'subs.error.sdh': 'Não foi possível aplicar sua configuração de texto para surdos',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Remover texto para surdos',
  'subs.settings.strip-sdh-hint': 'Oculta das legendas descrições de sons como [porta rangendo], indicações de música e nomes de quem fala como JOÃO:. Linhas que ficam vazias são puladas; o tempo continua o mesmo.',
  'subs.settings.keep-lyrics': 'Manter letras de músicas',
  'subs.settings.keep-lyrics-hint': 'Linhas cantadas marcadas com ♪ ficam quando o texto para surdos é removido. Linhas só com notas musicais saem mesmo assim.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Não foi possível manter as legendas embaixo',
  'subs.player.position': 'Posição das legendas',
  'subs.player.height': 'Altura',
  'subs.player.raised': '{value}% mais alto',
  'subs.player.reset': 'Voltar para baixo',
  'subs.player.keep-bottom': 'Manter embaixo',
  'subs.player.keep-bottom-hint': 'Legendas simples (como SRT) ignoram a posição do arquivo, então cada linha fica nesta altura. Legendas simples embutidas no vídeo também perdem o itálico. Legendas com estilo (ASS, comuns em animes) mantêm o próprio layout. Vale para todos os vídeos.',
};
