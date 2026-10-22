import type { sources as source } from '../en/sources';

export const sources: Record<keyof typeof source, string> = {
  'sources.limits.heading': 'Limites da reprodução automática',
  'sources.limits.any': 'Qualquer',
  'sources.limits.min-quality': 'A reprodução automática não começa abaixo de',
  'sources.limits.min-quality-hint': 'Reproduzir e o próximo episódio só iniciam fontes pelo menos com esta qualidade (as que não a indicam ficam de fora). Se nenhuma servir, a melhor é reproduzida e o Orbit avisa. A lista de fontes continua mostrando tudo. Para este perfil.',
  'sources.limits.max-quality': 'A reprodução automática não começa acima de',
  'sources.limits.max-quality-hint': 'Reproduzir e o próximo episódio não iniciam fontes acima desta, a menos que não haja outra. Ao contrário de “Qualidade máxima a preferir”, não reordena a lista de fontes. Para este perfil.',
  'sources.limits.max-size': 'A reprodução automática não inicia arquivos maiores que',
  'sources.limits.max-size-hint': 'Para conexões lentas ou dados limitados: Reproduzir e o próximo episódio ignoram arquivos maiores. As fontes que não indicam o tamanho não são afetadas. Para este perfil.',
  'sources.autoplay.outside-limits': 'Nada cabe nos seus limites de reprodução automática, por isso a melhor fonte está sendo reproduzida.',
  'sources.autoplay.only-uncached': 'Todas as fontes encontradas ainda estão sendo baixadas pelo seu serviço debrid. Escolha uma para iniciá-la.',
  'sources.note.uncached': 'Sem cache',
  'sources.note.uncached-hint': 'Ainda sendo baixada pelo seu serviço debrid: nunca é iniciada automaticamente',
  'sources.note.outside-limits': 'Fora dos limites',
  'sources.note.outside-limits-hint': 'Reproduzir e o próximo episódio a ignoram (Configurações → Complementos e fontes → Preferências de fontes → Limites da reprodução automática)',
  'sources.next-up.unaired': 'A seguir · data de estreia a confirmar',
};
