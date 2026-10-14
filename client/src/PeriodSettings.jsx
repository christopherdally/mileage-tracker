import { useStore } from './store.js';
import { currentMonth, dueSoon, reportPeriod } from './periods.js';
import { today, fmtDate } from './util.js';

export function CutoffReminders() {
  const { meta } = useStore();
  const days = meta.periodSettings?.days || {};
  return ['fuel', 'mileage'].map(kind => {
    const end = dueSoon(today(), kind, days);
    return end ? <p key={kind} className="notice" role="status">{kind === 'fuel' ? 'Fuel' : 'Mileage'} cutoff: {fmtDate(end)}. Check your entries before the period closes.</p> : null;
  });
}
export function EntryPeriod({ date, kind }) {
  const { meta } = useStore();
  const settings = meta.periodSettings?.days || {};
  if (!date) return null;
  const range = reportPeriod(currentMonth(date, kind, settings), kind, settings);
  return <p className="field-hint">Included in the {kind} report: {fmtDate(range.from)} to {fmtDate(range.to)}.</p>;
}
