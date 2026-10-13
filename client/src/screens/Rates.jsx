import { useState } from 'react';
import { store, useStore } from '../store.js';
import { syncSoon } from '../sync.js';
import { rateIssues } from '../calc.js';
import { Empty, Field, Sheet, parseNum, useToast } from '../ui.jsx';
import { addDays, fmtDate, fmtRate, today, uuid, plural } from '../util.js';

function RateForm({ rate, onDone }) {
  const { liveRates } = useStore();
  const toast = useToast();
  const [label, setLabel] = useState(rate?.label || '');
  const [pence, setPence] = useState(rate ? String(rate.pencePerMile) : '');
  const [start, setStart] = useState(rate?.startDate || today());
  const [end, setEnd] = useState(rate?.endDate || '');
  const [errors, setErrors] = useState({});

  // When a new price starts, offer to end the rate that was running until then.
  const toClose = !rate
    ? liveRates.filter((p) => p.startDate < start && (!p.endDate || p.endDate >= start))
    : [];
  const [closePrev, setClosePrev] = useState(true);

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    const p = parseNum(pence);
    if (p === null || Number.isNaN(p) || p < 0 || p > 1000) errs.pence = 'Enter pence per mile, e.g. 45 or 48.5';
    if (!start) errs.start = 'Choose when this rate starts';
    if (end && end < start) errs.end = 'The end date must be on or after the start date';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    if (closePrev && toClose.length) {
      for (const prev of toClose) await store.save('rates', { ...prev, endDate: addDays(start, -1) });
    }
    await store.save('rates', {
      id: rate?.id || uuid(), label: label.trim(), pencePerMile: p, startDate: start, endDate: end || null, deleted: false,
    });
    syncSoon();
    toast(rate ? 'Rate updated' : 'Rate added');
    onDone();
  }

  async function remove() {
    if (!confirm('Delete this rate? Journeys in these dates will have no rate until you add another.')) return;
    await store.softDelete('rates', rate.id);
    syncSoon();
    toast('Rate deleted');
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Name" hint="Optional, e.g. Diesel after October price rise">
        {(id) => <input id={id} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <Field label="Pence per mile" error={errors.pence}>
        {(id) => (
          <div className="input-affix">
            <input id={id} inputMode="decimal" value={pence} onChange={(e) => setPence(e.target.value)} placeholder="45" />
            <span>p</span>
          </div>
        )}
      </Field>
      <div className="row-2">
        <Field label="Starts" error={errors.start}>
          {(id) => <input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        <Field label="Ends" hint="Leave empty if still current" error={errors.end}>
          {(id) => <input id={id} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
      </div>
      {toClose.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={closePrev} onChange={(e) => setClosePrev(e.target.checked)} />
          <span>
            End {toClose.map((p) => `“${p.label || fmtRate(p.pencePerMile)}”`).join(', ')} on {fmtDate(addDays(start, -1))}
          </span>
        </label>
      )}
      <div className="btn-row">
        {rate && <button type="button" className="btn btn-danger-quiet" onClick={remove}>Delete</button>}
        <button type="submit" className="btn btn-primary">{rate ? 'Save changes' : 'Add rate'}</button>
      </div>
    </form>
  );
}

export function RatesScreen() {
  const { liveRates, liveTrips } = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const t = today();
  const list = [...liveRates].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const issues = rateIssues(liveRates);
  const countFor = (p) => liveTrips.filter((x) => x.tripDate >= p.startDate && (!p.endDate || x.tripDate <= p.endDate)).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Rates</h1>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add rate</button>
      </header>
      <p className="lede">What you're paid per business mile. When the price changes, add a new rate from that date and the old one ends the day before.</p>

      {issues.length > 0 && (
        <div className="notice notice-warn" role="status">
          {issues.map((i, n) => (
            <p key={n}>
              {i.kind === 'overlap'
                ? <>“{i.a.label || fmtRate(i.a.pencePerMile)}” and “{i.b.label || fmtRate(i.b.pencePerMile)}” overlap. The later start wins on shared days.</>
                : <>More than one rate has no end date.</>}
            </p>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <Empty title="No rates yet">
          <p>Add your pence-per-mile rate so journeys can be costed.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add rate</button>
        </Empty>
      ) : (
        <ul className="rates">
          {list.map((p) => {
            const current = p.startDate <= t && (!p.endDate || t <= p.endDate);
            return (
              <li key={p.id}>
                <button type="button" className={`rate-row ${current ? 'current' : ''}`} onClick={() => setEditing(p)}>
                  <span className="rate-pence num">{fmtRate(p.pencePerMile)}</span>
                  <span className="rate-info">
                    <span className="rate-label">{p.label || 'Rate per mile'}{current && <em className="tag">Current</em>}</span>
                    <span className="muted">{fmtDate(p.startDate)} to {p.endDate ? fmtDate(p.endDate) : 'now'}, {plural(countFor(p), 'journey')}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a rate">
        {adding && <RateForm onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit rate">
        {editing && <RateForm rate={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
