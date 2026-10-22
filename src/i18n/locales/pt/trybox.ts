import type { trybox as source } from '../en/trybox';

export const trybox: Record<keyof typeof source, string> = {
  'trybox.boost.title': "Amplificação do volume",
  'trybox.boost.note': "Um limitador impede a distorção do áudio amplificado.",
  'trybox.boost.off': "Desativada",
  'trybox.boost.passthrough': "Desative a passagem direta de áudio para amplificar o volume.",
  'trybox.controls.title': "Tamanho dos controles",
  'trybox.controls.percent': "{percent}%",
  'trybox.controls.small': "Pequeno",
  'trybox.controls.medium': "Médio",
  'trybox.controls.large': "Grande",
  'trybox.info.pin': "Mostrar informações de reprodução na tela",
  'trybox.info.dropped': "Quadros perdidos",
  'trybox.info.fps': "Taxa de quadros",
  'trybox.hub.shortcuts': "Atalhos",
  'trybox.hub.controls': "Tamanho dos controles",
  'trybox.hub.info': "Informações na tela",
  'trybox.subtitle.sample': "As legendas terão esta aparência.",
  'trybox.subtitle.font': "Fonte",
};
