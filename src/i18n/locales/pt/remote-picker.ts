import type { remotePicker as source } from '../en/remote-picker';
import type { Catalog } from '../types';

/** Portuguese strings for the phone remote's picker. */
export const remotePicker: Catalog<typeof source> = {
  'remote.phone.tab-browse': 'Explorar',
  'remote.phone.browse-loading': 'Carregando o seu Início…',
  'remote.phone.browse-empty': 'Ainda não há nada para mostrar. Adicione um complemento de catálogo no Orbit para preencher o Início.',
  'remote.phone.browse-failed': 'Não foi possível carregar o seu Início. Tente de novo.',
  'remote.phone.refresh': 'Atualizar',
  'remote.phone.moods': 'O que você está com vontade de ver?',
  'remote.phone.mood-loading': 'Procurando sugestões…',
  'remote.phone.mood-empty': 'No momento não há sugestões para este clima.',
  'remote.phone.surprise': 'Surpreenda-me',
  'remote.phone.surprise-hint': 'Uma sugestão aleatória dos seus catálogos.',
  'remote.phone.surprise-movie': 'Um filme',
  'remote.phone.surprise-series': 'Uma série',
  'remote.phone.surprise-none': 'No momento não há nada de novo para sugerir. Tente o outro tipo ou altere as escolhas de Surpreenda-me no Orbit.',
  'remote.phone.details-loading': 'Carregando detalhes…',
  'remote.phone.details-failed': 'Não foi possível carregar este título. Tente de novo.',
  'remote.phone.add-library': 'Adicionar à biblioteca',
  'remote.phone.in-library': 'Na sua biblioteca',
  'remote.phone.close': 'Fechar',
  'remote.phone.season': 'Temporada {number}',
  'remote.phone.specials': 'Especiais',
  'remote.phone.episodes': 'Episódios',
  'remote.phone.rating': 'Avaliação IMDb {rating}',
};
