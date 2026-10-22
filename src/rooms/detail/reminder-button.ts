/**
 * "Remind me" on an upcoming episode of a show (its title page): a bell that
 * opens a menu of when to be reminded (on the day, 1, 3 or 7 days before) or
 * none. The choice is the show's: every upcoming episode of it is reminded
 * (library/reminders.ts). Lit while the show has a reminder.
 */
import type { Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { loadReminders, MAX_SHOWS, REMINDER_DAYS, reminderFor, setReminder, type ReminderDays } from '../../library/reminders';

const whenLabel = (days: ReminderDays) => (days === 0 ? t('movix.remind.on-day') : tn('movix.remind.days-before', days));

/** Each bell's redraw: choosing on one changes every bell of the show on the page. */
const syncs = new WeakMap<Element, () => void>();

export function reminderButton(title: Pick<Title, 'id' | 'name'>, focusId: string): HTMLButtonElement {
  const button = h('button', { class: 'episode-check episode-remind', 'data-focus-id': focusId, 'aria-haspopup': 'menu' }, icon('bell'));
  const sync = () => {
    const days = reminderFor(title.id);
    button.classList.toggle('on', days !== null);
    const label = days === null ? t('movix.remind.set') : t('movix.remind.current', { when: whenLabel(days) });
    button.title = label;
    button.setAttribute('aria-label', label);
  };
  const choose = (days: ReminderDays | null) =>
    void setReminder(title, days)
      .then((saved) => {
        sync();
        for (const bell of document.querySelectorAll('.episode-remind')) syncs.get(bell)?.();
        if (!saved) toast(t('movix.remind.full', { name: title.name, count: MAX_SHOWS }));
        else toast(days === null ? t('movix.remind.removed', { name: title.name }) : t('movix.remind.saved', { name: title.name, when: whenLabel(days) }));
      })
      .catch((err: unknown) => {
        console.error('Could not save the reminder', err);
        toast(t('settings.common.save-failed'));
      });
  button.addEventListener('click', () => {
    const current = reminderFor(title.id);
    const group = t('movix.remind.set');
    openMenuFrom(button, [
      // The chosen one is marked, as the menu has no checked state of its own.
      ...REMINDER_DAYS.map((days) => ({ label: `${days === current ? '✓ ' : ''}${whenLabel(days)}`, group, action: () => choose(days) })),
      ...(current === null ? [] : [{ label: t('movix.remind.none'), action: () => choose(null) }]),
    ]);
  });
  syncs.set(button, sync);
  sync();
  void loadReminders().then(sync);
  return button;
}
