import type { subfonts as source } from '../en/subfonts';

/** Settings → Audio & Subtitles: the subtitle font picker and preview. */
export const subfonts: Record<keyof typeof source, string> = {
  'subfonts.preview': 'Pré-visualização',
  'subfonts.preview-hint': 'Uma amostra das suas legendas, do jeito que o player as desenha. Os tamanhos e contornos se aproximam do que o player mostra, sem serem exatos.',
  'subfonts.fullscreen': 'Pré-visualizar em tela cheia',
  'subfonts.fullscreen-close': 'Pressione Esc ou clique para fechar',
  'subfonts.line1': 'Nunca pensei que chegássemos tão longe.',
  'subfonts.line2': 'Nem eu. Vamos continuar.',
  'subfonts.font': 'Fonte',
  'subfonts.font-label': 'Fonte das legendas',
  'subfonts.font-hint': 'Atkinson Hyperlegible, Lexend e OpenDyslexic foram feitas para uma leitura mais fácil; vêm com o Orbit. As legendas com estilo mantêm a própria fonte.',
  'subfonts.default': 'Padrão',
};
