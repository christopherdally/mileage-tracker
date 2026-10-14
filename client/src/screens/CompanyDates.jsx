import { useState } from 'react';
import { store, useStore } from '../store.js';
import { syncSoon } from '../sync.js';
import { Field, useToast } from '../ui.jsx';
import { cutoff, shiftMonth } from '../periods.js';
import { monthName, today } from '../util.js';

export function CompanyDatesScreen({ back }) {
  const { meta } = useStore();
  const toast = useToast();
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const requested = query.get('month');
  const [start, setStart] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(requested || '') ? requested : today().slice(0, 7));
  const count = 24;
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = meta.periodSettings?.days || {};
  const months = Array.from({ length: count }, (_, i) => shiftMonth(start, i));
  async function save(e) {
    e.preventDefault();
    setError('');
    if (!Object.keys(draft).length) return;
    const invalid = Object.entries(draft).some(([key, value]) => {
      const [kind, month] = key.split(':');
      return !value || value.slice(0, 7) !== month || value > cutoff(month, kind, { [key]: 31 }) || value < `${month}-01`;
    });
    if (invalid) { setError('Choose a valid date within each report month.'); return; }
    setBusy(true);
    try {
      const days = { ...(store.meta.periodSettings?.days || {}) };
      for (const [key, value] of Object.entries(draft)) days[key] = Number(value.slice(8));
      const previous = Date.parse(store.meta.periodSettings?.updatedAt) || 0;
      await store.setMeta('periodSettings', { days, updatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(), dirty: true });
      setDraft({});
      syncSoon();
      toast('Company end dates saved');
    } catch (err) { setError(`Could not save dates: ${err.message}`); }
    finally { setBusy(false); }
  }
  function leave() {
    if (Object.keys(draft).length && !confirm('Leave without saving your company end dates?')) return;
    back();
  }
  return <div className="screen">
    <header className="screen-head"><h1>Company end dates</h1><button className="btn btn-quiet btn-small" type="button" onClick={leave}>Back</button></header>
    <p className="lede">Plan fuel card and mileage cutoffs for several months in advance. Each date includes the whole day; later purchases and journeys go on the next report.</p>
    <form onSubmit={save}>
      <Field label="Starting report month">{id => <input id={id} type="month" value={start} onChange={e => { if (e.target.value) { setStart(e.target.value); } }} />}</Field>
      <p className="muted small">Dates default to fuel on the 7th and mileage on the 9th until you set your company's dates. Changes are saved together and sync across devices.</p>
      {months.map(month => <section key={month} className="panel">
        <h2 className="panel-title">{monthName(`${month}-01`)}</h2>
        <div className="row-2">{['fuel', 'mileage'].map(kind => {
          const key = `${kind}:${month}`;
          return <Field key={key} label={kind === 'fuel' ? 'Fuel card end date' : 'Mileage end date'}>
            {id => <input id={id} type="date" required min={`${month}-01`} max={cutoff(month, kind, { [key]: 31 })} value={draft[key] ?? cutoff(month, kind, saved)} onChange={e => setDraft(current => ({ ...current, [key]: e.target.value }))} />}
          </Field>;
        })}</div>
      </section>)}
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="btn-stack">
        <button type="submit" className="btn btn-primary" disabled={busy || !Object.keys(draft).length}>{busy ? 'Saving…' : 'Save all end dates'}</button>
      </div>
    </form>
  </div>;
}
