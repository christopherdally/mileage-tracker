import { useMemo, useState } from 'react';
import { PeriodSettings } from '../PeriodSettings.jsx';
import { currentMonth, reportPeriod, shiftMonth } from '../periods.js';
import { store, useStore } from '../store.js';
import { buildReport, fuelSummary } from '../calc.js';
import { FuelComparison } from './Fuel.jsx';
import { saveBlob, session } from '../api.js';
import { Field, Segmented, useToast } from '../ui.jsx';
import { fmtDate, fmtMiles, fmtPounds, fmtRate, today, plural } from '../util.js';


export function ReportScreen({ claimStartDay }) {
  const { liveTrips, liveRates, liveFuel, meta } = useStore();
  const toast = useToast();
  const [preset, setPreset] = useState('current');
  const settings = meta.periodSettings?.days || {};
  const [month, setMonth] = useState(() => currentMonth(today(), "mileage", settings));
  const selectedMonth = preset === "last" ? shiftMonth(month, -1) : month;
  const cur = reportPeriod(month, "mileage", settings);
  const [custom, setCustom] = useState({ from: meta.customFrom || cur.from, to: meta.customTo || cur.to });
  const [busy, setBusy] = useState(false);

  const range = preset === 'current' ? cur : preset === 'last' ? reportPeriod(selectedMonth, 'mileage', settings) : custom;
  const valid = range.from && range.to && range.from <= range.to;
  const report = useMemo(
    () => (valid ? buildReport({ trips: liveTrips, rates: liveRates, ...range }) : null),
    [liveTrips, liveRates, range.from, range.to, valid] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const fuelRange = preset === "custom" ? range : reportPeriod(selectedMonth, "fuel", settings);
  const fuel = useMemo(
    () => (valid ? fuelSummary({ fuel: liveFuel, ...fuelRange }) : null),
    [liveFuel, fuelRange.from, fuelRange.to, valid] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function setCustomField(k, v) {
    const next = { ...custom, [k]: v };
    setCustom(next);
    store.setMeta(k === 'from' ? 'customFrom' : 'customTo', v);
  }

  async function makePdf(share) {
    setBusy(true);
    try {
      const { buildClaimPdf, claimFilename } = await import('../pdf.js');
      const bytes = await buildClaimPdf({ report, rates: liveRates, fuel: { ...fuel, ...fuelRange }, user: session.user || {} });
      const name = claimFilename(report, session.user || { username: 'me' });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const file = new File([blob], name, { type: 'application/pdf' });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mileage claim' }).catch(() => {});
      } else {
        saveBlob(blob, name);
        toast('PDF downloaded');
      }
    } catch (e) {
      toast(`Couldn't make the PDF: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare;

  return (
    <div className="screen">
      <header className="screen-head"><h1>Claim report</h1></header>

      <Segmented label="Period" value={preset} onChange={setPreset}
        options={[{ value: 'current', label: 'This period' }, { value: 'last', label: 'Last period' }, { value: 'custom', label: 'Custom dates' }]} />

      {preset === 'custom' ? (
        <div className="row-2 mt">
          <Field label="From">{(id) => <input id={id} type="date" value={custom.from} onChange={(e) => setCustomField('from', e.target.value)} />}</Field>
          <Field label="To" error={!valid ? 'Must be on or after the From date' : null}>
            {(id) => <input id={id} type="date" value={custom.to} min={custom.from} onChange={(e) => setCustomField('to', e.target.value)} />}
          </Field>
        </div>
      ) : (
        <p className="range-line">{fmtDate(range.from)} to {fmtDate(range.to)}</p>
      )}
      {preset !== 'custom' && <>
        <Field label="Report month">{id => <input id={id} type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} />}</Field>
        <PeriodSettings month={selectedMonth} />
      </>}
      <p className="range-line">Fuel: {fmtDate(fuelRange.from)} to {fmtDate(fuelRange.to)}</p>
      <p className="muted small">Entries dated after each cutoff appear on the next report.</p>

      {report && (
        <>
          <dl className="totals">
            <div><dt>Business miles</dt><dd className="num">{fmtMiles(report.totalMiles)}</dd></div>
            <div><dt>Journeys</dt><dd className="num">{report.tripCount}</dd></div>
            <div className="totals-claim"><dt>To claim</dt><dd className="num">{fmtPounds(report.totalPence)}</dd></div>
          </dl>

          <section className="workings">
            <h2>How it's worked out</h2>
            {report.groups.length === 0 && <p className="muted">No journeys in these dates.</p>}
            {report.groups.map((g) => (
              <div key={g.key} className={`working ${g.source === 'none' ? 'is-warn' : ''}`}>
                <div className="working-head">
                  <span>{g.label}</span>
                  <span className="num">{g.source === 'none' ? 'Not claimed' : fmtPounds(g.amountPence)}</span>
                </div>
                <p className="working-sum num">
                  {g.source === 'none'
                    ? `${fmtMiles(g.miles)} miles on dates with no rate`
                    : `${fmtMiles(g.miles)} mi × ${fmtRate(g.pence)} = ${fmtPounds(g.amountPence)}`}
                </p>
                <p className="muted small">{plural(g.trips.length, 'journey')}, {fmtDate(g.firstDate, { year: false })} to {fmtDate(g.lastDate, { year: false })}</p>
              </div>
            ))}
            {report.groups.length > 0 && (
              <div className="working-total">
                <span>Total</span><span className="num">{fmtPounds(report.totalPence)}</span>
              </div>
            )}
          </section>

          {fuel && fuel.count > 0 && (
            <section className="workings mt">
              <h2>Fuel paid compared with the claim</h2>
              <FuelComparison claimPence={report.totalPence} fuelPence={fuel.totalPence} fuelCount={fuel.count} />
              <p className="muted small mt-s">Fuel amounts appear on the PDF. Receipt photos stay in the app.</p>
            </section>
          )}

          <div className="btn-stack">
            <button type="button" className="btn btn-primary btn-block" disabled={busy || (!report.tripCount && !fuel?.count)} onClick={() => makePdf(false)}>
              {busy ? 'Making PDF…' : 'Download PDF'}
            </button>
            {canShare && (
              <button type="button" className="btn btn-quiet btn-block" disabled={busy || (!report.tripCount && !fuel?.count)} onClick={() => makePdf(true)}>
                Share PDF
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
