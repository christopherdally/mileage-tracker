import { useMemo, useRef, useState } from 'react';
import { store, useStore } from '../store.js';
import { syncSoon } from '../sync.js';
import { rateForTrip } from '../calc.js';
import { readJourneys } from '../import.js';
import { Empty, Sheet, useToast } from '../ui.jsx';
import { TripForm } from './TripForm.jsx';
import { fmtDate, fmtMiles, fmtRate, monthName, plural, uuid } from '../util.js';
import { vehicleName } from '../vehicles.js';

export function TripRow({ trip, rates, onOpen }) {
  const r = rateForTrip(trip, rates);
  const { vehicles } = useStore();
  const vehicle = vehicles.length > 1 ? vehicleName(vehicles, trip.vehicleId) : '';
  const hasOdo = trip.startOdometer !== null && trip.startOdometer !== undefined;
  return (
    <li>
      <button type="button" className="trip-row" onClick={() => onOpen(trip)}>
        <span className="trip-date">{fmtDate(trip.tripDate, { weekday: true, year: false })}</span>
        <span className="trip-desc">
          {trip.description || <span className="muted">Business journey</span>}
          <span className="trip-meta">
            {vehicle && <span>{vehicle}</span>}
            {hasOdo && <span className="num">{trip.startOdometer} to {trip.endOdometer}</span>}
            {r.pence === null ? <span className="warn-text">No rate</span> : <span>{fmtRate(r.pence)}{r.source === 'custom' ? ' custom' : ''}</span>}
            {trip.dirty && <span className="pending-dot" title="Waiting to sync">Not synced</span>}
            {trip.rejected && <span className="warn-text">Server rejected this entry</span>}
          </span>
        </span>
        <span className="trip-miles num">{fmtMiles(trip.miles)}</span>
      </button>
    </li>
  );
}

/** Bring in journeys from a CSV file: choose it, check what was found, then add them. */
function ImportJourneys({ onDone }) {
  const { liveTrips, liveVehicles } = useStore();
  const toast = useToast();
  const pick = useRef(null);
  const [found, setFound] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setFound({ name: file.name, ...readJourneys(await file.text(), { vehicles: liveVehicles, existing: liveTrips }) });
    } catch {
      setFound({ name: file.name, error: "That file couldn't be read." });
    }
  }

  async function add() {
    await store.saveMany('trips', found.rows.map((r) => ({ id: uuid(), ...r, deleted: false })));
    syncSoon();
    toast(`Imported ${plural(found.rows.length, 'journey')}`);
    onDone();
  }

  const rows = found?.rows || [];
  const dates = rows.map((r) => r.tripDate).sort();
  const miles = rows.reduce((s, r) => s + Math.round(r.miles * 10), 0) / 10;
  return (
    <>
      <p className="muted small">
        Choose a CSV file with a heading row. It needs a Date column and a Miles column (or Start odometer and End odometer).
        Journey and Vehicle columns are used if they're there. A file from Report, Journeys (CSV) works as it is.
      </p>
      <button type="button" className="btn btn-quiet" onClick={() => pick.current?.click()}>{found ? 'Choose a different file' : 'Choose CSV file'}</button>
      <input ref={pick} type="file" accept=".csv,text/csv,text/plain" hidden onChange={onFile} data-testid="import-picker" />
      {found?.error && <p className="notice notice-warn mt" role="alert">{found.error}</p>}
      {found && !found.error && (
        <div className="mt" role="status">
          <p><strong>{found.name}</strong></p>
          {rows.length > 0
            ? <p>{plural(rows.length, 'journey')} to import, {fmtDate(dates[0])} to {fmtDate(dates[dates.length - 1])}, {fmtMiles(miles)} miles in total.</p>
            : <p>No new journeys to import.</p>}
          {found.duplicates > 0 && <p className="muted small">{found.duplicates} already in your journeys, so left out.</p>}
          {found.skipped.length > 0 && (
            <>
              <p className="warn-text small">{plural(found.skipped.length, 'row')} can't be imported:</p>
              <ul className="small muted import-skipped">
                {found.skipped.slice(0, 5).map((s) => <li key={s.line}>Row {s.line}: {s.reason}</li>)}
                {found.skipped.length > 5 && <li>and {found.skipped.length - 5} more</li>}
              </ul>
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!rows.length} onClick={add}>
              {rows.length ? `Import ${plural(rows.length, 'journey')}` : 'Nothing to import'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function TripsScreen() {
  const { liveTrips, liveRates } = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [limit, setLimit] = useState(6);

  const months = useMemo(() => {
    const byMonth = new Map();
    for (const t of [...liveTrips].sort((a, b) => (a.tripDate === b.tripDate ? (b.startOdometer ?? 0) - (a.startOdometer ?? 0) : a.tripDate < b.tripDate ? 1 : -1))) {
      const k = t.tripDate.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, { key: k, trips: [], tenths: 0 });
      const m = byMonth.get(k);
      m.trips.push(t);
      m.tenths += Math.round(t.miles * 10);
    }
    return [...byMonth.values()];
  }, [liveTrips]);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Journeys</h1>
        <span className="head-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setImporting(true)}>Import</button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add journey</button>
        </span>
      </header>

      {months.length === 0 && (
        <Empty title="No journeys yet">
          <p>Log your first one from the Log tab or with Add journey. Kept them in a spreadsheet until now? Use Import.</p>
        </Empty>
      )}

      {months.slice(0, limit).map((m) => (
        <section key={m.key} className="list-section">
          <div className="list-head sticky">
            <h2>{monthName(m.key + '-01')}</h2>
            <span className="num muted">{fmtMiles(m.tenths / 10)} mi</span>
          </div>
          <ul className="logbook">
            {m.trips.map((t) => <TripRow key={t.id} trip={t} rates={liveRates} onOpen={setEditing} />)}
          </ul>
        </section>
      ))}
      {months.length > limit && (
        <button type="button" className="btn btn-quiet btn-block" onClick={() => setLimit(limit + 6)}>Show earlier months</button>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit journey">
        {editing && <TripForm trip={editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={importing} onClose={() => setImporting(false)} title="Import journeys">
        {importing && <ImportJourneys onDone={() => setImporting(false)} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a journey">
        {adding && <TripForm onDone={() => setAdding(false)} />}
      </Sheet>
    </div>
  );
}
