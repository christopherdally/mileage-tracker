import { store, useStore } from './store.js';
import { syncSoon } from './sync.js';
import { Field } from './ui.jsx';
import { cutoff, currentMonth, dueSoon, reportPeriod } from './periods.js';
import { today, fmtDate } from './util.js';

export function PeriodSettings({ month, kinds = ['fuel', 'mileage'] }) {
  const { meta } = useStore();
  const settings = meta.periodSettings?.days || {};
  async function change(kind, value) {
    const days = { ...(store.meta.periodSettings?.days || {}), [`${kind}:${month}`]: Number(value.slice(8)) };
    await store.setMeta('periodSettings', { days, updatedAt: new Date().toISOString(), dirty: true });
    syncSoon();
  }
  return <section className="panel"><h2 className="panel-title">Monthly report end dates</h2>
    <p className="muted small">Set your company's dates separately for each month. Cutoff dates are inclusive; later purchases and journeys go on the next report. Saved dates sync across your devices.</p>
    {kinds.map(kind => <Field key={kind} label={`${kind === 'fuel' ? 'Fuel' : 'Mileage'} period end`}>
      {id => <input id={id} type="date" min={`${month}-01`} max={cutoff(month, kind, { [`${kind}:${month}`]: 31 })} value={cutoff(month, kind, settings)} onChange={e => { if (e.target.value) change(kind, e.target.value); }} />}
    </Field>)}
  </section>;
}
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
