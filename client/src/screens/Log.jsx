import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { buildReport, fuelSummary } from '../calc.js';
import { Odometer, Segmented, Sheet } from '../ui.jsx';
import { TripForm } from './TripForm.jsx';
import { FuelForm } from './Fuel.jsx';
import { claimPeriod, today, fmtDate, fmtMiles, fmtPounds } from '../util.js';
import { TripRow } from './Trips.jsx';

export function LogScreen({ claimStartDay }) {
  const { liveTrips, liveRates, liveFuel } = useStore();
  const [entry, setEntry] = useState('journey');
  const period = claimPeriod(today(), claimStartDay);
  const report = useMemo(() => buildReport({ trips: liveTrips, rates: liveRates, ...period }),
    [liveTrips, liveRates, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(null);
  const fuel = useMemo(() => fuelSummary({ fuel: liveFuel, ...period }), [liveFuel, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = today();
  const todays = liveTrips.filter((x) => x.tripDate === t).sort((a, b) => (a.startOdometer ?? 0) - (b.startOdometer ?? 0));
  const todayMiles = todays.reduce((s, x) => s + Math.round(x.miles * 10), 0) / 10;

  return (
    <div className="screen log-screen">
      <section className="dash">
        <Odometer miles={report.totalMiles} label="this claim period" />
        <p className="dash-sub">
          <strong className="num">{fmtPounds(report.totalPence)}</strong> to claim for {fmtDate(period.from, { year: false })} to {fmtDate(period.to, { year: false })}
        </p>
        {fuel.count > 0 && (
          <p className="dash-fuel">Fuel paid <strong className="num">{fmtPounds(fuel.totalPence)}</strong></p>
        )}
        {report.unratedMiles > 0 && (
          <p className="dash-warn">{fmtMiles(report.unratedMiles)} miles have no rate. Add one on the Rates tab.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-switch">
          <h2 className="visually-hidden">Add an entry</h2>
          <Segmented label="What to add" value={entry} onChange={setEntry}
            options={[{ value: 'journey', label: 'Journey' }, { value: 'fuel', label: 'Fuel' }]} />
        </div>
        {entry === 'journey' ? <TripForm /> : <FuelForm />}
      </section>

      <section className="list-section">
        <div className="list-head">
          <h2>Today</h2>
          {todays.length > 0 && <span className="num muted">{fmtMiles(todayMiles)} mi</span>}
        </div>
        {todays.length === 0
          ? <p className="muted pad">Nothing logged today yet.</p>
          : <ul className="logbook">{todays.map((x) => <TripRow key={x.id} trip={x} rates={liveRates} onOpen={setEditing} />)}</ul>}
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit journey">
        {editing && <TripForm trip={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
