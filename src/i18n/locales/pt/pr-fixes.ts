import type { prFixes as source } from '../en/pr-fixes';
import type { Catalog } from '../types';

/** Portuguese strings for updating a re-configured addon and original-language audio. */
export const prFixes: Catalog<typeof source> = {
  'prfixes.addons.update-question': "Atualizar as configurações deste complemento?",
  'prfixes.addons.update-detail': "{name} já está instalado. Estas configurações substituem as antigas, e ele mantém o lugar na sua lista.",
  'prfixes.addons.update': "Atualizar",
  'prfixes.audio.original': "Idioma original primeiro",
  'prfixes.audio.original-hint': "Cada filme ou série começa no idioma em que foi feito, quando o vídeo tem esse áudio: anime em japonês, um drama coreano em coreano. Senão, o idioma de áudio acima. Requer uma chave do TMDB.",
  'prfixes.bundle.local': "Este endereço leva a este computador ou à sua rede doméstica, por isso o Orbit não se conectou a ele.",
};
