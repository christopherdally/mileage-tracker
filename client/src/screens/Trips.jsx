import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { rateForTrip } from '../calc.js';
import { Empty, Sheet } from '../ui.jsx';
import { TripForm } from './TripForm.jsx';
import { fmtDate, fmtMiles, fmtRate, monthName } from '../util.js';

export function TripRow({ trip, rates, onOpen }) {
  const r = rateForTrip(trip, rates);
  const hasOdo = trip.startOdometer !== null && trip.startOdometer !== undefined;
  return (
    <li>
      <button type="button" className="trip-row" onClick={() => onOpen(trip)}>
        <span className="trip-date">{fmtDate(trip.tripDate, { weekday: true, year: false })}</span>
        <span className="trip-desc">
          {trip.description || <span className="muted">Business journey</span>}
          <span className="trip-meta">
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

export function TripsScreen() {
  const { liveTrips, liveRates } = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
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
        <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add journey</button>
      </header>

      {months.length === 0 && (
        <Empty title="No journeys yet">
          <p>Log your first one from the Log tab or with Add journey.</p>
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
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a journey">
        {adding && <TripForm onDone={() => setAdding(false)} />}
      </Sheet>
    </div>
  );
}
