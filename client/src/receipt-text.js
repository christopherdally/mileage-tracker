// Conservative UK receipt suggestions. Missing or ambiguous fields stay empty.
export function parseReceiptText(text) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = { date: '', amount: '', litres: '', description: '' };
  const dates = new Set();
  for (const match of String(text).matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g)) {
    const day = Number(match[1]), month = Number(match[2]);
    const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    const date = new Date(year, month - 1, day);
    if (year >= 2000 && year <= 2100 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) dates.add(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  }
  if (dates.size === 1) out.date = [...dates][0];
  const amounts = [];
  const volumes = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Never treat VAT, subtotal, change, unit price or card numbers as the paid total.
    if (/\b(total|amount\s*(?:paid|due)|sale\s*amount|debit|credit)\b/i.test(line) && !/\b(sub\s*total|vat|tax|change|per\s*litre)\b/i.test(line)) {
      const source = /\d+[.,]\d{2}\b/.test(line) ? line : line + ' ' + (lines[i + 1] || '');
      const values = [...source.matchAll(/(?:£\s*)?\b(\d{1,5}[.,]\d{2})\b/g)];
      if (values.length === 1) {
        const value = Number(values[0][1].replace(',', '.'));
        if (value > 0 && value <= 100000) amounts.push({value, priority: /\btotal\b|amount\s*paid/i.test(line) ? 2 : 1});
      }
    }
    const volume = line.match(/\b(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:litres?|ltrs?|l)\b/i) || line.match(/\b(?:litres?|ltrs?|volume)\s*[:=]?\s*(\d{1,4}(?:[.,]\d{1,3})?)\b/i);
    if (volume && !/per\s*litre|\/\s*l\b/i.test(line)) {
      const n = Number(volume[1].replace(',', '.'));
      if (n > 0 && n <= 2000) volumes.add(n.toFixed(2));
    }
  }
  const best = amounts.filter(a => a.priority === Math.max(...amounts.map(x => x.priority)));
  const unique = new Set(best.map(a => a.value.toFixed(2)));
  if (unique.size === 1) out.amount = [...unique][0];
  if (volumes.size === 1) out.litres = [...volumes][0];
  out.description = lines.slice(0, 5).find(line => /[a-z]{3}/i.test(line) && !/receipt|welcome|thank|vat|tel|date|time|www\.|https?:/i.test(line) && !/\d{5}/.test(line))?.slice(0, 300) || '';
  return out;
}
