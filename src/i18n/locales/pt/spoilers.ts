import type { spoilers as source } from '../en/spoilers';

/** Settings → Library & Metadata → Spoilers. */
export const spoilers: Record<keyof typeof source, string> = {
  'spoilers.heading': 'Spoilers',
  'spoilers.intro': 'O que ocultar dos episódios: na página de uma série, na lista de episódios do player, no cartão A seguir e em Continuar assistindo.',
  'spoilers.titles': 'Ocultar os títulos dos episódios',
  'spoilers.titles-hint': 'Mostra “Episódio 4” em vez do nome do episódio.',
  'spoilers.descriptions': 'Ocultar as descrições dos episódios',
  'spoilers.descriptions-hint': 'Omite o resumo de cada episódio.',
  'spoilers.thumbnails': 'Desfocar as imagens dos episódios',
  'spoilers.thumbnails-hint': 'Passe o mouse ou foque um episódio para dar uma espiada.',
  'spoilers.ratings': 'Ocultar as classificações dos episódios',
  'spoilers.ratings-hint': 'Uma classificação pode revelar que episódios importam.',
  'spoilers.unaired': 'Ocultar as datas de estreia dos próximos episódios',
  'spoilers.unaired-hint': 'Os episódios que ainda não saíram dizem apenas “Ainda não exibido”.',
  'spoilers.scope': 'Aplica-se a',
  'spoilers.scope-hint': 'Os episódios que você terminou ou começou mostram tudo, a menos que você escolha todos os episódios.',
  'spoilers.scope-unwatched': 'Episódios que não vi',
  'spoilers.scope-all': 'Todos os episódios',
};
