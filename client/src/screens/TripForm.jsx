import { useMemo, useState } from 'react';
import { store, useStore } from '../store.js';
import { syncSoon } from '../sync.js';
import { Field, Segmented, parseNum, useToast } from '../ui.jsx';
import { today, uuid, roundTenth, fmtMiles, fmtRate, fmtPounds } from '../util.js';
import { rateForTrip } from '../calc.js';

/** Add or edit one journey. `trip` is undefined when adding. */
export function TripForm({ trip, onDone, compact = false }) {
  const { liveTrips, liveRates } = useStore();
  const toast = useToast();

  // Pre-fill the start odometer with the last reading on or before the chosen date.
  const lastEnd = (date) => {
    let best = null;
    for (const t of liveTrips) {
      if (t.id === trip?.id || t.endOdometer === null || t.endOdometer === undefined) continue;
      if (t.tripDate <= date && (!best || t.tripDate > best.tripDate || (t.tripDate === best.tripDate && t.endOdometer > best.endOdometer))) best = t;
    }
    return best ? String(best.endOdometer) : '';
  };

  const initialMode = trip ? (trip.startOdometer !== null && trip.startOdometer !== undefined ? 'odo' : 'miles') : (localStorage.getItem('mt.entryMode') || 'odo');
  const [mode, setMode] = useState(initialMode);
  const [date, setDate] = useState(trip?.tripDate || today());
  const [start, setStart] = useState(trip?.startOdometer ?? (initialMode === 'odo' ? lastEnd(today()) : ''));
  const [end, setEnd] = useState(trip?.endOdometer ?? '');
  const [miles, setMiles] = useState(trip?.miles ?? '');
  const [description, setDescription] = useState(trip?.description || '');
  const hasOverride = trip?.rateOverridePence !== null && trip?.rateOverridePence !== undefined;
  const [customRate, setCustomRate] = useState(hasOverride);
  const [rate, setRate] = useState(hasOverride ? String(trip.rateOverridePence) : '');
  const [errors, setErrors] = useState({});
  const [touchedStart, setTouchedStart] = useState(!!trip);

  const s = parseNum(start);
  const e = parseNum(end);
  const odoMiles = s !== null && e !== null && !Number.isNaN(s) && !Number.isNaN(e) && e >= s ? roundTenth(e - s) : null;
  const finalMiles = mode === 'odo' ? odoMiles : parseNum(miles);

  const recent = useMemo(() => {
    const seen = new Map();
    for (const t of [...liveTrips].sort((a, b) => (a.tripDate < b.tripDate ? 1 : -1))) {
      const d = t.description?.trim();
      if (d && !seen.has(d.toLowerCase())) seen.set(d.toLowerCase(), d);
      if (seen.size >= 12) break;
    }
    return [...seen.values()];
  }, [liveTrips]);

  const preview = rateForTrip({ tripDate: date, rateOverridePence: customRate ? parseNum(rate) : null }, liveRates);

  function changeDate(v) {
    setDate(v);
    if (mode === 'odo' && !touchedStart && v) setStart(lastEnd(v));
  }
  function changeMode(m) {
    setMode(m);
    if (!trip) try { localStorage.setItem('mt.entryMode', m); } catch { /* ignore */ }
    if (m === 'odo' && !start) setStart(lastEnd(date));
  }

  async function submit(ev) {
    ev.preventDefault();
    const errs = {};
    if (!date) errs.date = 'Choose the date of the journey';
    if (mode === 'odo') {
      if (s === null || Number.isNaN(s)) errs.start = 'Enter the odometer reading at the start';
      if (e === null || Number.isNaN(e)) errs.end = 'Enter the odometer reading at the end';
      else if (s !== null && e < s) errs.end = 'The end reading must be higher than the start';
      else if (odoMiles > 2000) errs.end = `That's ${fmtMiles(odoMiles)} miles. Check the readings.`;
    } else if (finalMiles === null || Number.isNaN(finalMiles) || finalMiles < 0) {
      errs.miles = 'Enter the business miles for this journey';
    }
    let override = null;
    if (customRate) {
      override = parseNum(rate);
      if (override === null || Number.isNaN(override) || override < 0) errs.rate = 'Enter the rate in pence per mile, e.g. 45';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const row = {
      id: trip?.id || uuid(),
      tripDate: date,
      description: description.trim(),
      startOdometer: mode === 'odo' ? s : null,
      endOdometer: mode === 'odo' ? e : null,
      miles: roundTenth(finalMiles),
      rateOverridePence: override,
      deleted: false,
    };
    await store.save('trips', row);
    syncSoon();
    toast(trip ? 'Journey updated' : `Saved ${fmtMiles(row.miles)} miles`);
    if (!trip) {
      // Ready for the next leg of the day: the new start is this journey's end.
      setStart(mode === 'odo' ? String(e) : '');
      setEnd('');
      setMiles('');
      setDescription('');
      setCustomRate(false);
      setRate('');
      setTouchedStart(false);
    }
    onDone?.(row);
  }

  async function remove() {
    if (!confirm('Delete this journey? It will be removed from every device.')) return;
    await store.softDelete('trips', trip.id);
    syncSoon();
    toast('Journey deleted');
    onDone?.(null);
  }

  return (
    <form className={`trip-form ${compact ? 'compact' : ''}`} onSubmit={submit} noValidate>
      <div className="row-2">
        <Field label="Date" error={errors.date}>
          {(id) => <input id={id} type="date" value={date} max="2100-12-31" onChange={(ev) => changeDate(ev.target.value)} required />}
        </Field>
        <div className="field">
          <span className="label-like">Record by</span>
          <Segmented label="Record by" value={mode} onChange={changeMode}
            options={[{ value: 'odo', label: 'Odometer' }, { value: 'miles', label: 'Miles' }]} />
        </div>
      </div>

      {mode === 'odo' ? (
        <div className="row-2">
          <Field label="Start reading" error={errors.start}>
            {(id) => <input id={id} inputMode="decimal" autoComplete="off" value={start}
              onChange={(ev) => { setStart(ev.target.value); setTouchedStart(true); }} placeholder="e.g. 41250" />}
          </Field>
          <Field label="End reading" error={errors.end}>
            {(id) => <input id={id} inputMode="decimal" autoComplete="off" value={end} onChange={(ev) => setEnd(ev.target.value)} placeholder="e.g. 41292" />}
          </Field>
        </div>
      ) : (
        <Field label="Business miles" error={errors.miles}>
          {(id) => <input id={id} inputMode="decimal" autoComplete="off" value={miles} onChange={(ev) => setMiles(ev.target.value)} placeholder="e.g. 42.5" />}
        </Field>
      )}

      <Field label="Where and why" hint="Shown on your claim, e.g. Site visit, Newport">
        {(id) => (
          <>
            <input id={id} list={`${id}-recent`} value={description} maxLength={500} onChange={(ev) => setDescription(ev.target.value)} autoComplete="off" />
            <datalist id={`${id}-recent`}>{recent.map((r) => <option key={r} value={r} />)}</datalist>
          </>
        )}
      </Field>

      <label className="check">
        <input type="checkbox" checked={customRate} onChange={(ev) => setCustomRate(ev.target.checked)} />
        <span>Use a different rate for this journey</span>
      </label>
      {customRate && (
        <Field label="Pence per mile" error={errors.rate}>
          {(id) => <input id={id} inputMode="decimal" value={rate} onChange={(ev) => setRate(ev.target.value)} placeholder="e.g. 45" />}
        </Field>
      )}

      <div className="form-foot">
        <p className="calc-line" aria-live="polite">
          {finalMiles !== null && !Number.isNaN(finalMiles) && finalMiles >= 0 ? (
            preview.pence !== null
              ? <><strong className="num">{fmtMiles(finalMiles)}</strong> miles at {fmtRate(preview.pence)} = <strong className="num">{fmtPounds(Math.round(roundTenth(finalMiles) * preview.pence))}</strong></>
              : <><strong className="num">{fmtMiles(finalMiles)}</strong> miles. <span className="warn-text">No rate covers this date yet.</span></>
          ) : preview.pence !== null ? <>Rate on this date: {fmtRate(preview.pence)} per mile</> : <span className="warn-text">No rate covers this date yet</span>}
        </p>
        <div className="btn-row">
          {trip && <button type="button" className="btn btn-danger-quiet" onClick={remove}>Delete</button>}
          <button type="submit" className="btn btn-primary">{trip ? 'Save changes' : 'Save journey'}</button>
        </div>
      </div>
    </form>
  );
}
