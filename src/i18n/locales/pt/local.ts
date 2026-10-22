import type { local as source } from '../en/local';

export const local: Record<keyof typeof source, string> = {
  // The overlay while files are dragged over the window
  'local.drop.title': 'Solte para reproduzir',
  'local.drop.video-hint': 'O vídeo é reproduzido no Orbit.',
  'local.drop.subtitle-hint': 'As legendas são adicionadas ao que está tocando.',
  'local.drop.first-only': 'Reproduzindo {name}. O Orbit reproduz um arquivo por vez, então o resto foi ignorado.',
  'local.drop.failed': 'Não foi possível abrir esse arquivo.',
  'local.drop.unsupported': 'O Orbit não consegue reproduzir esse tipo de arquivo.',
  'local.drop.subtitle-needs-player': 'Inicie um vídeo primeiro e depois solte as legendas sobre ele.',
  'local.drop.subtitle-added': 'Legendas adicionadas: {name}',
  'local.drop.subtitle-first-only': 'Legendas adicionadas: {name}. Só o primeiro arquivo foi usado.',
  'local.drop.subtitle-failed': 'Não foi possível adicionar essas legendas.',
  // A dropped file in the player (“Loading from {addon}…”)
  'local.source.addon': 'este computador',
  'local.source.label': 'Arquivo local',
  // Settings → Player → External player
  'local.external.heading': 'Player externo',
  'local.external.player': 'Abrir fontes em',
  'local.external.player-hint': 'Adiciona “Abrir no player externo” às fontes da web no seletor de fontes. Retomar, pular abertura, faixas lembradas e progresso só funcionam no player do Orbit.',
  'local.external.none': 'Nenhum',
  'local.external.custom': 'Personalizado',
  'local.external.found': 'Encontrado: {path}',
  'local.external.not-found': 'Não encontrado na pasta de instalação de costume. Escolha Personalizado para informar onde está.',
  'local.external.custom-path': 'Programa',
  'local.external.custom-path-hint': 'O arquivo do programa do player, escolhido neste PC.',
  'local.external.choose': 'Escolher…',
  'local.external.custom-invalid': 'O Orbit não consegue abrir isso. Escolha o arquivo do programa do player.',
  'local.external.always': 'Sempre abrir no player externo',
  'local.external.always-hint': 'Reproduzir envia a melhor fonte da web direto para ele. Torrents e downloads continuam no Orbit.',
  // The source picker
  'local.external.open': 'Externo',
  'local.external.open-label': 'Abrir no player externo',
  'local.external.opened': 'Aberto no player externo.',
  'local.external.failed': 'O player externo não iniciou. Confira Configurações → Player.',
};
