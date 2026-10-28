// Trade posts: the form a student fills for each trade, and the card that shows one.
import { api } from './api.js';
import { SCREENSHOT_RETENTION_DAYS, SETUPS } from './config.js';
import { fmtTime12, phTimeToNY } from './dates.js';
import { sessionFor } from './rules.js';
import { $, busy, esc, openModal, toast } from './ui.js';

const SYMBOLS = ['NAS100', 'US30', 'SPX500', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD'];
const MAX_SIDE = 1600;

// Shrinks a screenshot to at most 1600px on its longest side, as JPEG.
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

export function showImage(src) {
  openModal(`<img class="full-img" src="${esc(src)}" alt="MT5 execution screenshot">`);
}

// Fills every <img data-path> inside root with a viewable URL.
export function loadImages(root) {
  root.querySelectorAll('img[data-path]').forEach(async (img) => {
    try {
      img.src = await api.imageUrl(img.dataset.path);
      img.onclick = () => showImage(img.src);
    } catch {
      img.alt = 'Image unavailable';
    }
  });
}

export function tradeCard(t, { actions = false } = {}) {
  const r = Number(t.result_r);
  return `
    <div class="trade-card" data-trade="${t.id}">
      <div class="trade-thumbs">
        ${t.images_removed_at
          ? `<div class="thumb-gone">Screenshots removed after ${SCREENSHOT_RETENTION_DAYS} days</div>`
          : `${t.chart_path ? `<figure><img class="trade-thumb" data-path="${esc(t.chart_path)}" alt="MT5 chart execution"><figcaption>Chart</figcaption></figure>` : ''}
        <figure><img class="trade-thumb" data-path="${esc(t.mt5_path)}" alt="MT5 trade history"><figcaption>History</figcaption></figure>`}
      </div>
      <div class="trade-body">
        <div class="row-between">
          <strong>${esc(t.symbol)} · ${esc(t.direction)}</strong>
          <span class="r ${r > 0 ? 'pos' : r < 0 ? 'neg' : ''}">${r > 0 ? '+' : ''}${r}R</span>
        </div>
        <div class="muted small">${[t.setup, t.session, t.entry_time_ny ? `${fmtTime12(t.entry_time_ny.slice(0, 5))} NY` : null, `risk ${Number(t.risk_pct)}%`, t.ticket ? `#${t.ticket}` : null].filter(Boolean).map(esc).join(' · ')}</div>
        <p class="thoughts">${esc(t.thoughts)}</p>
        <div class="row-gap small">
          ${t.chart_url ? `<a href="${esc(t.chart_url)}" target="_blank" rel="noopener">TradingView ↗</a>` : ''}
          ${actions ? '<button type="button" class="link" data-edit-trade>Edit</button><button type="button" class="link danger-text" data-del-trade>Delete</button>' : ''}
        </div>
      </div>
    </div>`;
}

export function openTradeForm({ studentId, date, trade, onSaved }) {
  const t = trade ?? {};
  // chart = the trade on the MT5 chart (entry, SL, TP); history = the trade in MT5 History.
  const blobs = { chart: null, history: null };
  const saved = { chart: t.chart_path, history: t.mt5_path };
  openModal(`
    <h3>${trade ? 'Edit trade' : 'Post a trade'}</h3>
    <form class="form" data-form>
      <div class="form-row">
        <label>Market<input class="input" name="symbol" list="symbols" required value="${esc(t.symbol)}" placeholder="NAS100"></label>
        <label>Direction<select class="input" name="direction" required>
          <option value="Long" ${t.direction === 'Long' ? 'selected' : ''}>Long (buy)</option>
          <option value="Short" ${t.direction === 'Short' ? 'selected' : ''}>Short (sell)</option>
        </select></label>
      </div>
      <datalist id="symbols">${SYMBOLS.map((s) => `<option value="${s}">`).join('')}</datalist>
      <div class="form-row">
        <label>Entry time <span class="muted small">(PH time)</span><input class="input" type="time" name="entry_ph" required></label>
        <label>Entry model<select class="input" name="setup"><option value="">—</option>${SETUPS.map((s) => `<option ${t.setup === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      </div>
      <div class="muted small" data-session></div>
      <div class="form-row">
        <label>Risk on this trade (%)<input class="input" type="number" name="risk_pct" step="0.01" min="0" required value="${esc(t.risk_pct)}" placeholder="1"></label>
        <label>Result (R)<input class="input" type="number" name="result_r" step="0.01" required value="${esc(t.result_r)}" placeholder="2 or -1"></label>
      </div>
      <label>MT5 ticket / position # <span class="muted small">(optional)</span><input class="input" name="ticket" value="${esc(t.ticket)}" inputmode="numeric"></label>
      <label>1. MT5 chart execution screenshot <span class="req">Required</span>
        <span class="muted small" style="font-weight:400">The MT5 chart showing your entry, stop loss and take profit.</span>
        <input class="input" type="file" accept="image/*" data-file="chart">
      </label>
      <img class="preview" data-preview="chart" ${saved.chart ? `data-path="${esc(saved.chart)}"` : 'hidden'} alt="">
      <label>2. MT5 trade history screenshot <span class="req">Required</span>
        <span class="muted small" style="font-weight:400">The trade in your MT5 History tab, showing ticket, time, price, lot and result.</span>
        <input class="input" type="file" accept="image/*" data-file="history">
      </label>
      <img class="preview" data-preview="history" ${saved.history ? `data-path="${esc(saved.history)}"` : 'hidden'} alt="">
      <p class="hint">Tip: on a computer you can paste a screenshot with Ctrl+V. It fills the first empty slot.</p>
      <label>TradingView chart link <span class="muted small">(optional)</span><input class="input" type="url" name="chart_url" value="${esc(t.chart_url)}" placeholder="https://www.tradingview.com/x/..."></label>
      <label>Thought process <span class="req">Required</span>
        <textarea class="input" name="thoughts" rows="5" required minlength="40" placeholder="HTF bias and why. What liquidity was taken. What confirmed the entry (MSS, FVG...). Where your stop and target were and why.">${esc(t.thoughts)}</textarea>
      </label>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save trade</button></div>
    </form>`, (dlg) => {
    const form = $('[data-form]', dlg);
    if (saved.chart || saved.history) loadImages(dlg);
    // Show the saved NY time back in PH time for editing. Manila is 12h ahead of New York
    // during US daylight time and 13h ahead otherwise.
    if (t.entry_time_ny) {
      const [h, m] = t.entry_time_ny.split(':').map(Number);
      for (const off of [12, 13]) {
        const v = (h * 60 + m + off * 60) % 1440;
        const hhmm = `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
        if (phTimeToNY(date, hhmm) === t.entry_time_ny.slice(0, 5)) form.entry_ph.value = hhmm;
      }
    }
    const showSession = () => {
      const ny = form.entry_ph.value ? phTimeToNY(date, form.entry_ph.value) : null;
      $('[data-session]', dlg).textContent = ny ? `= ${fmtTime12(ny)} New York · ${sessionFor(ny) ?? 'outside the session windows'}` : '';
    };
    form.entry_ph.addEventListener('input', showSession);
    showSession();

    const setFile = async (slot, file) => {
      if (!file?.type?.startsWith('image/')) return toast('That is not an image.', 'err');
      blobs[slot] = await compress(file);
      const preview = $(`[data-preview="${slot}"]`, dlg);
      preview.src = URL.createObjectURL(blobs[slot]);
      preview.hidden = false;
    };
    dlg.querySelectorAll('[data-file]').forEach((inp) => inp.addEventListener('change', (e) => setFile(inp.dataset.file, e.target.files[0])));
    dlg.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      const slot = ['chart', 'history'].find((s) => !blobs[s] && !saved[s]) ?? 'history';
      setFile(slot, item.getAsFile());
    });
    const upload = async (slot) => {
      if (!blobs[slot]) return saved[slot];
      const path = await api.uploadExecution(studentId, blobs[slot]);
      if (saved[slot] && saved[slot] !== 'sample') api.deleteImage(saved[slot]).catch(() => {});
      return path;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      if (!blobs.chart && !saved.chart) return toast('Add your MT5 chart execution screenshot (1).', 'err');
      if (!blobs.history && !saved.history) return toast('Add your MT5 trade history screenshot (2).', 'err');
      if (f.chart_url.trim() && !/^https?:\/\//i.test(f.chart_url.trim())) return toast('The TradingView link must start with https://', 'err');
      if (f.thoughts.trim().length < 40) return toast('Write a bit more about your thought process (at least 40 characters).', 'err');
      const ny = phTimeToNY(date, f.entry_ph);
      await busy(e.submitter, async () => {
        const chart_path = await upload('chart');
        const mt5_path = await upload('history');
        const row = await api.saveTrade({
          ...(t.id ? { id: t.id } : {}),
          student_id: studentId, date,
          symbol: f.symbol.trim().toUpperCase(), direction: f.direction,
          setup: f.setup || null, entry_time_ny: ny, session: sessionFor(ny),
          risk_pct: Number(f.risk_pct), result_r: Number(f.result_r),
          ticket: f.ticket.trim() || null, mt5_path, chart_path,
          chart_url: f.chart_url.trim() || null, thoughts: f.thoughts.trim(),
        });
        dlg.close();
        onSaved(row);
      });
    });
  });
}
