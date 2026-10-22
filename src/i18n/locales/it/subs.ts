import type { subs as source } from '../en/subs';

export const subs: Record<keyof typeof source, string> = {
  // Player → Audio & subtitles: the addon subtitle made for the release playing
  'subs.best-match': 'Corrispondenza migliore',
  'subs.error.sdh': 'Impossibile applicare l’impostazione del testo per non udenti',
  // Settings → Audio & Subtitles
  'subs.settings.strip-sdh': 'Rimuovi il testo per non udenti',
  'subs.settings.strip-sdh-hint': 'Nasconde dai sottotitoli le descrizioni dei suoni come [la porta cigola], le indicazioni musicali e i nomi di chi parla come GIANNI:. Le righe rimaste vuote vengono saltate; i tempi restano uguali.',
  'subs.settings.keep-lyrics': 'Mantieni i testi delle canzoni',
  'subs.settings.keep-lyrics-hint': 'Le righe cantate segnate con ♪ restano quando il testo per non udenti viene rimosso. Le righe con sole note musicali vengono comunque tolte.',
  // Player → Audio & subtitles → Subtitle position
  'subs.error.override': 'Impossibile tenere i sottotitoli in basso',
  'subs.player.position': 'Posizione dei sottotitoli',
  'subs.player.height': 'Altezza',
  'subs.player.raised': '{value}% più in alto',
  'subs.player.reset': 'Riporta in basso',
  'subs.player.keep-bottom': 'Tieni in basso',
  'subs.player.keep-bottom-hint': 'I sottotitoli semplici (come SRT) ignorano la posizione del file, così ogni riga resta a questa altezza. Quelli semplici inclusi nel video perdono anche il corsivo. I sottotitoli con stile (ASS, comuni negli anime) mantengono il loro layout. Vale per tutti i video.',
};
