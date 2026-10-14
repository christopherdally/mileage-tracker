import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryPeriod } from '../PeriodSettings.jsx';
import { currentMonth, reportPeriod } from '../periods.js';
import { store, useStore } from '../store.js';
import { syncSoon } from '../sync.js';
import { addReceipts, getReceiptBlob } from '../receipts.js';
import { buildReport, fuelSummary, pencePerLitre } from '../calc.js';
import { OfflineError } from '../api.js';
import { Empty, Field, Sheet, parseNum, useToast } from '../ui.jsx';
import { fmtDate, fmtPounds, monthName, today, uuid, plural } from '../util.js';

const fmtLitres = (l) => `${Number(l).toLocaleString('en-GB', { maximumFractionDigits: 2 })} L`;
const fmtPpl = (p) => `${p.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}p/L`;

/** One receipt thumbnail. Loads from the phone, or from the server if it was added on another device. */
export function ReceiptThumb({ id, onOpen, onRemove }) {
  const { files } = useStore();
  const meta = files.get(id);
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading');
  const [mime, setMime] = useState(meta?.mime || '');

  useEffect(() => {
    let cancelled = false;
    let made = null;
    getReceiptBlob(id)
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
        setMime(blob.type);
        setState('ready');
      })
      .catch((e) => !cancelled && setState(e instanceof OfflineError ? 'offline' : 'missing'));
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [id]);

  const isPdf = mime === 'application/pdf';
  return (
    <div className="receipt">
      <button type="button" className="receipt-open" disabled={state !== 'ready'} onClick={() => onOpen?.({ url, mime })}
        aria-label={isPdf ? 'Open receipt PDF' : 'View receipt photo'}>
        {state === 'ready' && !isPdf && <img src={url} alt="" />}
        {state === 'ready' && isPdf && <span className="receipt-pdf">PDF</span>}
        {state === 'loading' && <span className="receipt-note">Loading</span>}
        {state === 'offline' && <span className="receipt-note">On another device</span>}
        {state === 'missing' && <span className="receipt-note">Not found</span>}
      </button>
      {meta && !meta.uploaded && !meta.failed && <span className="receipt-badge" title="Waiting to upload">Not uploaded</span>}
      {meta?.failed && <span className="receipt-badge bad" title={meta.failed}>Upload refused</span>}
      {onRemove && (
        <button type="button" className="receipt-remove" onClick={onRemove} aria-label="Remove receipt">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}

export function ReceiptViewer({ open, onClose }) {
  return (
    <Sheet open={!!open} onClose={onClose} title="Receipt">
      {open && (open.mime === 'application/pdf'
        ? <p><a className="btn btn-primary" href={open.url} target="_blank" rel="noopener">Open PDF</a></p>
        : <img className="receipt-full" src={open.url} alt="Fuel receipt" />)}
    </Sheet>
  );
}

export function FuelForm({ purchase, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState(purchase?.purchaseDate || today());
  const [amount, setAmount] = useState(purchase ? (purchase.amountPence / 100).toFixed(2) : '');
  const [litres, setLitres] = useState(purchase?.litres ?? '');
  const [odometer, setOdometer] = useState(purchase?.odometer ?? '');
  const [description, setDescription] = useState(purchase?.description || '');
  const [receiptIds, setReceiptIds] = useState(purchase?.receiptIds || []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const pickRef = useRef(null);
  const cameraRef = useRef(null);
  const scanRef = useRef(null);
  const scanCameraRef = useRef(null);
  const scanAbort = useRef(null);
  const [scanStatus, setScanStatus] = useState('');
  const [scanResult, setScanResult] = useState(null);
  useEffect(() => () => scanAbort.current?.abort(), []);

  async function onScan(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (receiptIds.length >= 20) { toast('Remove a receipt before adding another', 'error'); return; }
    setBusy(true);
    setScanResult(null);
    setScanStatus('Preparing receipt…');
    const controller = new AbortController();
    scanAbort.current = controller;
    try {
      const ids = await addReceipts([file]);
      if (controller.signal.aborted) return;
      setReceiptIds(cur => [...cur, ...ids]);
      const blob = await getReceiptBlob(ids[0]);
      const { scanReceipt } = await import('../receipt-scan.js');
      const result = await scanReceipt(blob, setScanStatus, controller.signal);
      if (!controller.signal.aborted) setScanResult(result);
    } catch (err) {
      if (!controller.signal.aborted) toast(`Could not read receipt: ${err.message}. You can enter details manually; any attached receipt is kept.`, 'error');
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setScanStatus(''); }
    }
  }
  function applyScan() {
    const fields = scanResult.fields;
    if (fields.date) setDate(fields.date);
    if (fields.amount) setAmount(fields.amount);
    if (fields.litres) setLitres(fields.litres);
    if (fields.description) setDescription(fields.description);
    setScanResult(null);
    toast('Receipt details filled in. Check them before saving.');
  }

  const a = parseNum(amount);
  const l = parseNum(litres);
  const ppl = a > 0 && l > 0 ? Math.round((a * 100 / l) * 10) / 10 : null;

  async function onFiles(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    try {
      const ids = await addReceipts(list);
      setReceiptIds((cur) => [...cur, ...ids].slice(0, 20));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    if (!date) errs.date = 'Choose the date you bought the fuel';
    if (a === null || Number.isNaN(a) || a <= 0) errs.amount = 'Enter what you paid, e.g. 89.99';
    else if (a > 100000) errs.amount = 'That amount looks too large';
    if (l !== null && (Number.isNaN(l) || l <= 0 || l > 2000)) errs.litres = 'Enter litres as a number, or leave it empty';
    const o = parseNum(odometer);
    if (o !== null && (Number.isNaN(o) || o < 0)) errs.odometer = 'Enter the odometer reading, or leave it empty';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    await store.save('fuel', {
      id: purchase?.id || uuid(),
      purchaseDate: date,
      amountPence: Math.round(a * 100),
      litres: l === null ? null : Math.round(l * 100) / 100,
      odometer: o,
      description: description.trim(),
      receiptIds,
      deleted: false,
    });
    syncSoon();
    toast(purchase ? 'Fuel updated' : `Saved ${fmtPounds(Math.round(a * 100))} of fuel`);
    if (!purchase) {
      setAmount(''); setLitres(''); setOdometer(''); setDescription(''); setReceiptIds([]);
    }
    onDone?.();
  }

  async function remove() {
    if (!confirm('Delete this fuel purchase and its receipts? It will be removed from every device.')) return;
    await store.softDelete('fuel', purchase.id);
    syncSoon();
    toast('Fuel purchase deleted');
    onDone?.();
  }

  return (
    <form onSubmit={submit} noValidate>
      <section className="panel">
        <h2 className="panel-title">Scan a paid fuel receipt</h2>
        <p className="field-hint">Take a photo or upload a picture to read the date, amount paid, litres and retailer. Review the suggestions before using them. You can edit every field. Internet is needed to load the scanner; text recognition runs on your device.</p>
        <div className="btn-row wrap">
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => scanCameraRef.current?.click()}>Scan with camera</button>
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => scanRef.current?.click()}>Scan uploaded photo</button>
        </div>
        <input ref={scanCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onScan} />
        <input ref={scanRef} type="file" accept="image/*" hidden onChange={onScan} />
        {scanStatus && <p role="status" aria-live="polite">{scanStatus}</p>}
      </section>
      <EntryPeriod date={date} kind="fuel" />
      <div className="row-2">
        <Field label="Date" error={errors.date}>
          {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Amount paid" error={errors.amount}>
          {(id) => (
            <div className="input-affix prefix">
              <span>£</span>
              <input id={id} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 89.99" />
            </div>
          )}
        </Field>
      </div>
      <div className="row-2">
        <Field label="Litres" hint="Optional" error={errors.litres}>
          {(id) => <input id={id} inputMode="decimal" autoComplete="off" value={litres} onChange={(e) => setLitres(e.target.value)} placeholder="e.g. 61.2" />}
        </Field>
        <Field label="Odometer" hint="Optional" error={errors.odometer}>
          {(id) => <input id={id} inputMode="decimal" autoComplete="off" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 41300" />}
        </Field>
      </div>
      <Field label="Where" hint="e.g. Tesco Extra, Cardiff">
        {(id) => <input id={id} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />}
      </Field>

      <div className="field">
        <span className="label-like">Receipts</span>
        {receiptIds.length > 0 && (
          <div className="receipts">
            {receiptIds.map((rid) => (
              <ReceiptThumb key={rid} id={rid} onOpen={setViewing} onRemove={() => setReceiptIds((cur) => cur.filter((x) => x !== rid))} />
            ))}
          </div>
        )}
        <div className="btn-row wrap receipt-buttons">
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => cameraRef.current?.click()}>Take photo</button>
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => pickRef.current?.click()}>Choose files</button>
          {busy && <span className="muted small">Preparing…</span>}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
        <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onFiles} data-testid="receipt-picker" />
        <p className="field-hint">Photos are kept with this entry for your records. They aren't added to the claim PDF.</p>
      </div>

      <div className="form-foot">
        <p className="calc-line" aria-live="polite">
          {a > 0 ? <><strong className="num">{fmtPounds(Math.round(a * 100))}</strong>{ppl ? <> at <strong className="num">{fmtPpl(ppl)}</strong></> : null}</> : 'Enter the amount from the receipt'}
        </p>
        <div className="btn-row">
          {purchase && <button type="button" className="btn btn-danger-quiet" onClick={remove}>Delete</button>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{purchase ? 'Save changes' : 'Save fuel'}</button>
        </div>
      </div>
      <Sheet open={!!scanResult} onClose={() => setScanResult(null)} title="Review scanned receipt">
        {scanResult && <>
          <p className="notice">Check these suggestions against your receipt. Blank fields will leave your existing input unchanged. Using suggestions replaces matching fields; nothing is saved until you press Save fuel.</p>
          {['date', 'amount', 'litres', 'description'].map(key => <Field key={key} label={{date:'Purchase date',amount:'Amount paid (£)',litres:'Litres',description:'Retailer'}[key]}>
            {id => <input id={id} type={key === 'date' ? 'date' : 'text'} value={scanResult.fields[key]} onChange={e => { const value = e.target.value; setScanResult(cur => ({ ...cur, fields: { ...cur.fields, [key]: value } })); }} />}
          </Field>)}
          <details><summary>Read receipt text</summary><pre style={{whiteSpace:'pre-wrap'}}>{scanResult.text}</pre></details>
          <div className="btn-row">
            <button type="button" className="btn btn-quiet" onClick={() => setScanResult(null)}>Keep current input</button>
            <button type="button" className="btn btn-primary" onClick={applyScan}>Use these details</button>
          </div>
        </>}
      </Sheet>
      <ReceiptViewer open={viewing} onClose={() => setViewing(null)} />
    </form>
  );
}

/** Fuel paid vs mileage claimed, for a date range. */
export function FuelComparison({ claimPence, fuelPence, fuelCount }) {
  const diff = claimPence - fuelPence;
  return (
    <div className="compare">
      <div><span>Mileage claimed</span><strong className="num">{fmtPounds(claimPence)}</strong></div>
      <div><span>Fuel paid ({plural(fuelCount, 'receipt')})</span><strong className="num">{fmtPounds(fuelPence)}</strong></div>
      <div className={`compare-diff ${diff < 0 ? 'neg' : ''}`}>
        <span>{diff >= 0 ? 'Claim is more than fuel by' : 'Fuel cost more than the claim by'}</span>
        <strong className="num">{fmtPounds(Math.abs(diff))}</strong>
      </div>
    </div>
  );
}

export function FuelScreen({ claimStartDay }) {
  const { liveFuel, liveTrips, liveRates, meta } = useStore();
  const settings = meta.periodSettings?.days || {};
  const [month, setMonth] = useState(() => currentMonth(today(), "fuel", settings));
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const period = reportPeriod(month, "fuel", settings);
  const mileagePeriod = reportPeriod(month, "mileage", settings);
  const sum = useMemo(() => fuelSummary({ fuel: liveFuel, ...period }), [liveFuel, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const claim = useMemo(() => buildReport({ trips: liveTrips, rates: liveRates, ...mileagePeriod }), [liveTrips, liveRates, mileagePeriod.from, mileagePeriod.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => {
    const by = new Map();
    for (const f of [...liveFuel].sort((a, b) => (a.purchaseDate < b.purchaseDate ? 1 : -1))) {
      const k = f.purchaseDate.slice(0, 7);
      if (!by.has(k)) by.set(k, { key: k, rows: [], pence: 0 });
      by.get(k).rows.push(f);
      by.get(k).pence += f.amountPence;
    }
    return [...by.values()];
  }, [liveFuel]);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Fuel</h1>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add fuel</button>
      </header>
      <p className="lede">What you actually paid at the pump, so you can compare it with your mileage claim.</p>

      <Field label="Report month">{id => <input id={id} type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} />}</Field>
      <p><a href={`#company-dates?month=${month}&back=fuel`}>Company end dates: fuel through {fmtDate(period.to)}, mileage through {fmtDate(mileagePeriod.to)}</a></p>
      <p className="muted small">Mileage: {fmtDate(mileagePeriod.from)} to {fmtDate(mileagePeriod.to)}</p>
      <section className="panel">
        <h2 className="panel-title">{fmtDate(period.from, { year: false })} to {fmtDate(period.to, { year: false })}</h2>
        <FuelComparison claimPence={claim.totalPence} fuelPence={sum.totalPence} fuelCount={sum.count} />
        {sum.avgPencePerLitre && <p className="muted small mt-s">{fmtLitres(sum.litres)} at an average of {fmtPpl(sum.avgPencePerLitre)}</p>}
      </section>

      {months.length === 0 && (
        <Empty title="No fuel logged yet">
          <p>Add each fill-up with a photo of the receipt.</p>
        </Empty>
      )}
      {months.map((m) => (
        <section key={m.key} className="list-section">
          <div className="list-head sticky">
            <h2>{monthName(m.key + '-01')}</h2>
            <span className="num muted">{fmtPounds(m.pence)}</span>
          </div>
          <ul className="logbook">
            {m.rows.map((f) => {
              const p = pencePerLitre(f);
              return (
                <li key={f.id}>
                  <button type="button" className="trip-row" onClick={() => setEditing(f)}>
                    <span className="trip-date">{fmtDate(f.purchaseDate, { weekday: true, year: false })}</span>
                    <span className="trip-desc">
                      {f.description || <span className="muted">Fuel</span>}
                      <span className="trip-meta">
                        {f.litres ? <span className="num">{fmtLitres(f.litres)}{p ? `, ${fmtPpl(p)}` : ''}</span> : null}
                        <span>{f.receiptIds?.length ? plural(f.receiptIds.length, 'receipt') : <span className="warn-text">No receipt</span>}</span>
                        {f.dirty && <span className="pending-dot">Not synced</span>}
                      </span>
                    </span>
                    <span className="trip-miles num">{fmtPounds(f.amountPence)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add fuel">
        {adding && <FuelForm onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit fuel">
        {editing && <FuelForm purchase={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

