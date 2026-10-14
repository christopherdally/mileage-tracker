import { useEffect, useState } from 'react';
import { api, downloadWithAuth } from '../api.js';
import { archivePdf } from '../report-archive.js';
import { Field, useToast } from '../ui.jsx';
import { today, monthName } from '../util.js';
import { shiftMonth } from '../periods.js';

export function ReportArchiveScreen({ back }) {
  const toast = useToast();
  const [reports, setReports] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(shiftMonth(today().slice(0, 7), -1));
  const [file, setFile] = useState(null);
  async function load() {
    setError(''); setLoading(true);
    try { const data = await api('GET', '/report-archives'); setReports(data.reports); setConfigured(data.configured); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function upload(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    try { await archivePdf(file, month, file.name); setFile(null); e.target.reset(); await load(); toast('Report archived in S3'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(report) {
    if (!confirm(`Delete ${report.filename} from your report archive?`)) return;
    setBusy(true);
    try { await api('DELETE', `/report-archives/${report.id}`); await load(); toast('Archived report deleted'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="screen">
    <header className="screen-head"><h1>Report archive</h1><button type="button" className="btn btn-quiet" onClick={back}>Back</button></header>
    <p className="lede">Keep previous monthly claim PDFs in S3 for checking later. Each upload is a separate copy. Only you can access your reports.</p>
    {error && <p className="notice" role="alert">{error} <button type="button" onClick={load}>Retry</button></p>}
    {loading ? <p role="status">Loading reports…</p> : !configured && <p className="notice">Ask your administrator to configure S3 storage before uploading reports.</p>}
    <form className="panel" onSubmit={upload}>
      <h2 className="panel-title">Upload previous report</h2>
      <Field label="Report month">{id => <input id={id} required type="month" value={month} max={shiftMonth(today().slice(0, 7), -1)} onChange={e => setMonth(e.target.value)} />}</Field>
      <Field label="Report PDF (up to 3 MB)">{id => <input id={id} required type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} />}</Field>
      <button type="submit" className="btn btn-primary" disabled={!configured || !file || busy || loading}>{busy ? 'Working…' : 'Upload to S3'}</button>
    </form>
    {!loading && reports.length === 0 && <p className="muted">No reports archived yet.</p>}
    {reports.map(report => <section className="panel" key={report.id}>
      <h2 className="panel-title">{monthName(`${report.month}-01`)}</h2>
      <p>{report.filename}</p><p className="muted small">Uploaded {new Date(report.createdAt).toLocaleString('en-GB')} · {Math.ceil(report.size / 1024)} KB</p>
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={async () => { try { await downloadWithAuth(`/report-archives/${report.id}/download`, report.filename); } catch (err) { setError(err.message); } }}>Download to check</button>
        <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={() => remove(report)}>Delete</button>
      </div>
    </section>)}
  </div>;
}
