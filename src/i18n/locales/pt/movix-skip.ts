import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "Tempos de pulo de anime do AniSkip",
  'movix.aniskip-hint': "Em animes, pergunta também ao AniSkip, um banco de dados comunitário gratuito, onde ficam aberturas, encerramentos e resumos. Envia só o ID do MyAnimeList da série e o número do episódio; para reconhecer a série, pode baixar uma lista pública de IDs do GitHub. Desativado até você ativar.",
  'movix.smooth': "Pulo suave",
  'movix.smooth-hint': "Ao pular, a imagem escurece e o som abaixa por um instante, e depois os dois voltam. Com Reduzir movimento ativado, os pulos continuam instantâneos.",
  'movix.button-delay': "Mostrar o botão Pular após",
  'movix.button-delay-hint': "Deixa o começo da abertura ou dos créditos tocar antes de Pular aparecer, para o botão não cobrir o fim de uma cena. Pulos automáticos não esperam.",
  'movix.button-delay-none': "Na hora",
  'movix.landing': "Parar antes do fim",
  'movix.landing-hint': "O pulo para um pouco antes do fim da abertura ou do resumo, para não cortar o primeiro momento depois dele. Créditos que vão até o fim continuam levando ao fim.",
  'movix.landing-none': "No fim",
  'movix.color-intro': "Cor da abertura",
  'movix.color-recap': "Cor do resumo",
  'movix.color-credits': "Cor dos créditos",
  'movix.color-preview': "Cor da prévia",
  'movix.colors-hint': "Como cada parte aparece na barra de progresso.",
  'movix.swatch.default': "Padrão",
  'movix.swatch.amber': "Âmbar",
  'movix.swatch.sky': "Azul-céu",
  'movix.swatch.mint': "Menta",
  'movix.swatch.rose': "Rosa",
  'movix.swatch.violet': "Violeta",
  'movix.swatch.white': "Branco",
};
