import { useEffect, useId, useRef, useState, createContext, useContext, useCallback } from 'react';

/** Mechanical odometer: whole-mile wheels plus a yellow tenths wheel. */
export function Odometer({ miles, label }) {
  const tenths = Math.max(0, Math.round((Number(miles) || 0) * 10));
  const whole = Math.floor(tenths / 10);
  const digits = String(whole).padStart(5, '0').split('');
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="odo" role="img" aria-label={`${(tenths / 10).toFixed(1)} miles ${label || ''}`}>
      {digits.map((d, i) => <Wheel key={i + digits.length} value={Number(d)} reduce={reduce} />)}
      <Wheel value={tenths % 10} tenths reduce={reduce} />
    </div>
  );
}

function Wheel({ value, tenths, reduce }) {
  return (
    <span className={`wheel${tenths ? ' wheel-tenths' : ''}`} aria-hidden="true">
      <span className="wheel-strip" style={{ transform: `translateY(${-value * 10}%)`, transition: reduce ? 'none' : undefined }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <span key={n}>{n}</span>)}
      </span>
    </span>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {child}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom sheet dialog using the native <dialog> element (focus trapping and Esc for free). */
export function Sheet({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, kind = 'ok') => {
    clearTimeout(timer.current);
    setToast({ message, kind, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-zone" aria-live="polite">
        {toast && <div key={toast.key} className={`toast toast-${toast.kind}`}>{toast.message}</div>}
      </div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

/** Parse a number typed on a phone keyboard ("1,234.5" or "48,5"). */
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // decimal comma
  s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const Icon = {
  log: <path d="M4 17l4-4 3 3 6-7M14 9h3v3" />,
  trips: <path d="M5 6h14M5 12h14M5 18h9" />,
  fuel: <path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M3 20h13M7 8h5M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3" />,
  rates: <path d="M7 4v16M17 4v16M7 9h10M7 15h10" />,
  report: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
};
export function NavIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Icon[name]}</svg>
  );
}
