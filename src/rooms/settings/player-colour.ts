/**
 * The seek bar's colour, right in Settings (Appearance under the themes, and
 * Player beside the seek bar's Studio link): Theme Studio's own swatches,
 * saving the same stored style. A colour chosen anywhere (here, the other
 * row, a theme, or the Studio) shows on every row at once.
 */
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { currentSeekBar, setSeekBarColor } from '../../theme/engine';
import { applySeekBar, SEEKBAR_SHOWN, type SeekBar } from '../../theme/seekbar';
import { seekColorSaved } from '../studio';
import { seekColourSwatches } from '../studio/seekbar-editor';
import { whileOnPage } from './dependent-rows';
import { row } from './playback';

export function playerColourRow(label: string): HTMLElement {
  const swatches = seekColourSwatches(currentSeekBar().color, {
    // The system picker being dragged: shown, saved once it's closed.
    preview: (color) => applySeekBar({ ...currentSeekBar(), color }),
    commit: (color) =>
      void setSeekBarColor(color).then(
        () => seekColorSaved(color),
        (err: unknown) => {
          console.error('Could not save the seek bar colour', err);
          toast(t('settings.common.save-failed'));
        },
      ),
  });
  const element = row(label, t('playercolour.hint'), swatches.element);
  // Not `isConnected`: the page is detached while another category or room shows, and kept.
  whileOnPage(element, SEEKBAR_SHOWN, (event) => swatches.show((event as CustomEvent<SeekBar>).detail.color));
  return element;
}
