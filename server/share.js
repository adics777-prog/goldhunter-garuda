// Sharing profit (product kind ea_share): weekly profit report per EA chart, commission invoice, licence rolling week by week.
//
// Source of the profit: the licensed EA's heartbeat (/ea/live, licence key lic.<id>.<token>). Every chart is one row in
// ea_setups (license_id = this licence). The EA sends `total` = its own closed profit (deals with its magic number on its
// symbol, incl. swap / commission / fee, manual trades and deposits excluded) since `since`; /ea/live keeps the value of
// the last heartbeat of each WIB day in ea_setup_days.total_end (tot_ok = 1, since_at = the `since` it belongs to).
// Week profit of a chart = total_end of the last day of the week - total_end of the last day before the week (same
// `since`), i.e. a difference of cumulative totals, so a deal closed while the EA was offline is not lost: it shows in the
// week the EA reports again. Fallback (marked "harian", approximate): sum of the daily `profit` rows (the EA's "today",
// broker day, can miss the hours between WIB midnight and broker midnight).
// Weeks: Sunday 00:00 WIB to the next Sunday 00:00 WIB; billed by the daily job from Sunday 08:00 WIB (catch-up if late).
import { now, DAY, esc, rupiah, fmtDate } from './util.js';
import {
  getSettings, notify, emailUser, emailAdmin, getUser, queueBuild, getUsdIdr, pickUniqueCode, ensureUniqueCode, newOrderCode,
  shareWeekEnd, shareDueFor, sharePct, shareDueDays, payBlockHtml,
} from './logic.js';

const WIB = 7 * 3600;
const wibDay = (t) => new Date((t + WIB) * 1000).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
// account currency -> USD (cent accounts: 100 USC = $1; IDR accounts through the live rate)
export function usdOf(v, cur, rate) {
  const c = String(cur || '').toUpperCase();
  if (['USC', 'USX', 'UST', 'CNT'].includes(c)) return v / 100;
  if (c === 'USD' || c === 'USDT') return v;
  if (c === 'IDR') return rate ? v / rate : null;
  return null;
}
const fmtUsd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCur = (v, cur) => `${v < 0 ? '-' : ''}${Math.abs(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || ''}`.trim();

// Profit of one licence in [start, end): one row per EA chart + total in USD
export async function computeSharePeriod(env, lic, start, end, rate) {
  const { results: setups } = await env.DB.prepare('SELECT id, login, symbol, magic, setup_name, label, currency FROM ea_setups WHERE license_id=? ORDER BY id').bind(lic.id).all();
  const dFrom = wibDay(start), dTo = wibDay(end - 1);
  const rows = [];
  let hasData = false;
  for (const su of setups) {
    const [{ results: inP }, baseRow] = await Promise.all([
      env.DB.prepare('SELECT day, profit, total_end, tot_ok, since_at, currency FROM ea_setup_days WHERE setup_id=? AND day >= ? AND day <= ? ORDER BY day').bind(su.id, dFrom, dTo).all(),
      env.DB.prepare('SELECT day, total_end, since_at FROM ea_setup_days WHERE setup_id=? AND day < ? AND tot_ok=1 ORDER BY day DESC LIMIT 1').bind(su.id, dFrom).first(),
    ]);
    if (!inP.length) continue;                    // this chart sent nothing during the week
    hasData = true;
    const ok = inP.filter((r) => r.tot_ok);
    let profit = 0, source = 'total';
    if (!ok.length) { profit = inP.reduce((a, r) => a + (r.profit || 0), 0); source = 'harian'; }
    else {
      // segments with the same `since` (the admin can restart a track record during the week)
      const segs = [];
      for (const r of ok) { const g = segs[segs.length - 1]; if (g && g.since === r.since_at) g.last = r; else segs.push({ since: r.since_at, first: r, last: r }); }
      segs.forEach((g, i) => {
        let base = null;
        if (i === 0 && baseRow && baseRow.since_at === g.since) base = baseRow.total_end;
        else if (g.since >= start - 3600) base = 0;  // the track record started inside the week
        if (base == null) {
          source = 'harian';
          profit += inP.filter((r) => r.day >= g.first.day && r.day <= g.last.day).reduce((a, r) => a + (r.profit || 0), 0);
        } else profit += g.last.total_end - base;
      });
    }
    const cur = (inP[inP.length - 1].currency || su.currency || '').toUpperCase();
    const usd = usdOf(profit, cur, rate);
    rows.push({ setup_id: su.id, label: su.label || su.setup_name || su.symbol, symbol: su.symbol, magic: su.magic, login: su.login, currency: cur,
      profit: r2(profit), profit_usd: usd == null ? null : r2(usd), source, days: inP.length });
  }
  return { rows, has_data: hasData, profit_usd: r2(rows.reduce((a, r) => a + (r.profit_usd || 0), 0)) };
}

// HTML table of a report (emails)
export function shareReportHtml(rep, rows) {
  const tr = rows.map((r) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #2a2a36">${esc(r.label)}<br><span style="color:#a3a3b2;font-size:12px">${esc(r.symbol)} · magic ${r.magic}${r.source === 'harian' ? ' · perkiraan' : ''}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #2a2a36;text-align:right">${esc(fmtCur(r.profit, r.currency))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #2a2a36;text-align:right">${r.profit_usd == null ? '-' : fmtUsd(r.profit_usd)}</td></tr>`).join('');
  return `<p>Periode: <b>${fmtDate(rep.period_start)} – ${fmtDate(rep.period_end - 1)}</b> (WIB)</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;margin:10px 0">
      <tr><th style="text-align:left;padding:6px 8px;color:#a3a3b2">Chart EA</th><th style="text-align:right;padding:6px 8px;color:#a3a3b2">Profit tertutup</th><th style="text-align:right;padding:6px 8px;color:#a3a3b2">USD</th></tr>
      ${tr || '<tr><td colspan="3" style="padding:8px;color:#a3a3b2">Tidak ada laporan EA pada periode ini.</td></tr>'}
      <tr><td style="padding:8px"><b>Total</b></td><td></td><td style="padding:8px;text-align:right"><b>${fmtUsd(rep.profit_usd)}</b></td></tr>
    </table>
    <p>Komisi ${rep.commission_pct}%: <b>${fmtUsd(rep.commission_usd)}</b>${rep.commission_idr ? ` = <b>${rupiah(rep.commission_idr)}</b> (kurs ${rupiah(rep.usd_idr)}/USD)` : ''}</p>`;
}

// Settled week (paid, nothing to pay) -> the licence (= the EA's expiry) moves to the due date of the running week.
// Not while an older invoice is unpaid, not while a finished week still waits to be billed, not without any EA report
// in the last 7 days (the profit must be measurable).
export async function shareMaybeExtend(env, base, licenseId, reason) {
  const t = now();
  const s = await getSettings(env);
  const lic = await env.DB.prepare(`SELECT l.*, p.kind AS product_kind, p.includes_ea FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.id=?`).bind(licenseId).first();
  if (!lic || lic.product_kind !== 'ea_share' || !['active', 'expired'].includes(lic.status)) return { extended: false, why: 'bukan lisensi sharing aktif' };
  if (lic.share_next && shareWeekEnd(lic.share_next) <= t) return { extended: false, why: 'minggu lalu belum ditagih' };
  const unpaid = await env.DB.prepare(`SELECT 1 FROM orders WHERE license_id=? AND kind='share' AND status IN ('awaiting_payment','awaiting_verification') LIMIT 1`).bind(lic.id).first();
  if (unpaid) return { extended: false, why: 'ada tagihan belum dibayar' };
  const seen = await env.DB.prepare('SELECT MAX(updated_at) AS at FROM ea_setups WHERE license_id=?').bind(lic.id).first();
  if (!seen || !seen.at || seen.at < t - 7 * DAY) return { extended: false, why: 'EA belum melapor 7 hari terakhir' };
  const target = shareDueFor(t, s);
  if (lic.expires_at && lic.expires_at >= target) return { extended: false, why: 'sudah berlaku' };
  await env.DB.prepare(`UPDATE licenses SET expires_at=?, status=CASE WHEN status='expired' THEN 'active' ELSE status END,
      reminder_exp=NULL, reminders_sent='', updated_at=? WHERE id=?`).bind(target, t, lic.id).run();
  if (lic.includes_ea) await queueBuild(env, lic.id, reason || 'Sharing profit: minggu berikutnya');
  return { extended: true, expires_at: target, reactivated: lic.status === 'expired' };
}

async function createShareInvoice(env, base, lic, rep, user) {
  const s = await getSettings(env);
  const t = now();
  const uniq0 = await pickUniqueCode(env);
  const code = await newOrderCode(env);
  const deadline = Math.max(lic.expires_at || 0, t + DAY);
  const r = await env.DB.prepare(`INSERT INTO orders (code, user_id, kind, product_id, license_id, platform, account_number, broker, broker_server,
      months, unit_price, discount_pct, subtotal, unique_code, total, status, created_at, pay_deadline, amount_usd, share_report_id)
      VALUES (?,?, 'share', ?,?,?,?,?,?, NULL, ?, 0, ?, ?, ?, 'awaiting_payment', ?, ?, ?, ?)`)
    .bind(code, lic.user_id, lic.product_id, lic.id, lic.platform, lic.account_number, lic.broker, lic.broker_server,
      rep.commission_idr, rep.commission_idr, uniq0, rep.commission_idr + uniq0, t, deadline, rep.commission_usd, rep.id).run();
  const id = r.meta.last_row_id;
  const uniq = await ensureUniqueCode(env, id);
  await env.DB.prepare('UPDATE share_reports SET order_id=? WHERE id=?').bind(id, rep.id).run();
  const total = rep.commission_idr + uniq;
  const title = `Tagihan sharing profit akun ${lic.account_number}: ${rupiah(total)}`;
  await notify(env, lic.user_id, title, `Profit EA minggu ini ${fmtUsd(rep.profit_usd)}, komisi ${rep.commission_pct}%. Bayar sebelum ${fmtDate(deadline)} 23:59 WIB.`, '#/bayar/' + id);
  await emailUser(env, user, title,
    `<p>Halo ${esc(user.name)},</p><p>Berikut laporan profit EA GOLD HUNTER GARUDA minggu ini untuk akun <b>${esc(lic.account_number)}</b> dan tagihan komisi sharing profit <b>${esc(code)}</b>.</p>
     ${shareReportHtml(rep, rep.rows)}
     <p>Jatuh tempo: <b>${fmtDate(deadline)} 23:59 WIB</b>. Bila belum dibayar, EA berhenti membuka posisi baru sampai tagihan lunas.</p>
     ${payBlockHtml(s, total, uniq)}`,
    { text: 'Lihat & Bayar Tagihan', url: `${base}/member#/bayar/${id}` });
  return id;
}

// Daily job: bill every finished week of every sharing licence (normally once, on Sunday)
export async function runShareBilling(env, base) {
  const t = now();
  const s = await getSettings(env);
  const pct = sharePct(s), minIdr = Math.max(0, Number(s.share_min_idr) || 0);
  const out = { periods: 0, invoices: 0, extended: 0, waiting_rate: 0 };
  const { results: lics } = await env.DB.prepare(`SELECT l.*, p.name AS product_name, p.kind AS product_kind FROM licenses l JOIN products p ON p.id=l.product_id
      WHERE p.kind='ea_share' AND l.status IN ('active','expired') AND l.share_next > 0 AND l.share_next < ?`).bind(t).all();
  if (!lics.length) return out;
  const { rate } = await getUsdIdr(env);
  for (const lic of lics) {
    const user = await getUser(env, lic.user_id);
    if (!user) continue;
    let guard = 0;
    while (guard++ < 10) {
      const start = lic.share_next, end = shareWeekEnd(start);
      if (end > t) break;
      const res = await computeSharePeriod(env, lic, start, end, rate);
      const commission_usd = res.profit_usd > 0 ? r2(res.profit_usd * pct / 100) : 0;
      if (commission_usd > 0 && !rate) { out.waiting_rate++; break; }   // no USD/IDR rate yet: retried on the next run
      const commission_idr = commission_usd > 0 ? Math.ceil(commission_usd * rate) : 0;
      const status = !res.has_data ? 'no_data' : commission_usd <= 0 ? 'no_profit' : commission_idr < minIdr ? 'below_min' : 'invoiced';
      const note = { no_data: 'EA tidak mengirim laporan selama periode ini', no_profit: 'Tidak ada profit: tidak ditagih', below_min: `Komisi di bawah minimum ${rupiah(minIdr)}: tidak ditagih`, invoiced: '' }[status];
      const ins = await env.DB.prepare(`INSERT INTO share_reports (license_id, user_id, period_start, period_end, rows, profit_usd, commission_pct, commission_usd, commission_idr, usd_idr, status, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(license_id, period_start) DO NOTHING`)
        .bind(lic.id, lic.user_id, start, end, JSON.stringify(res.rows), res.profit_usd, pct, status === 'invoiced' ? commission_usd : 0,
          status === 'invoiced' ? commission_idr : 0, rate || 0, status, note, t).run();
      await env.DB.prepare('UPDATE licenses SET share_next=? WHERE id=? AND share_next=?').bind(end, lic.id, start).run();
      lic.share_next = end;
      if (!ins.meta.changes) continue;          // another run billed this week already
      out.periods++;
      const rep = { id: ins.meta.last_row_id, period_start: start, period_end: end, rows: res.rows, profit_usd: res.profit_usd, commission_pct: pct,
        commission_usd: status === 'invoiced' ? commission_usd : 0, commission_idr: status === 'invoiced' ? commission_idr : 0, usd_idr: rate || 0, status };
      if (status === 'invoiced') {
        await createShareInvoice(env, base, lic, rep, user);
        out.invoices++;
      } else {
        const title = `Laporan sharing profit akun ${lic.account_number}: ${status === 'no_data' ? 'EA tidak melapor' : 'tidak ada tagihan'}`;
        await notify(env, lic.user_id, title, `${fmtDate(start)} – ${fmtDate(end - 1)}: profit ${fmtUsd(res.profit_usd)}. ${note}.`, '#/lisensi');
        await emailUser(env, user, title,
          `<p>Halo ${esc(user.name)},</p><p>Laporan profit EA GOLD HUNTER GARUDA minggu ini untuk akun <b>${esc(lic.account_number)}</b>.</p>${shareReportHtml(rep, res.rows)}
           <p><b>${esc(note)}.</b>${status === 'no_data' ? ' Izinkan WebRequest <b>https://goldhuntergaruda.com</b> di MetaTrader (Tools → Options → Expert Advisors) agar EA melapor; tanpa laporan lisensi tidak diperpanjang.' : ' Lisensi otomatis berlanjut ke minggu berikutnya.'}</p>`,
          { text: 'Buka Lisensi', url: `${base}/member#/lisensi` });
      }
    }
    const ext = await shareMaybeExtend(env, base, lic.id, 'Sharing profit: minggu berikutnya');
    if (ext.extended) out.extended++;
  }
  return out;
}

// A sharing invoice is paid (bank confirmed by the admin, USDT found on chain, Tripay callback)
export async function settleSharePaid(env, base, orderId) {
  const t = now();
  const upd = await env.DB.prepare(`UPDATE orders SET status='completed', paid_at=COALESCE(paid_at, ?), confirmed_at=COALESCE(confirmed_at, ?), processed_at=?, completed_at=?
      WHERE id=? AND kind='share' AND status IN ('awaiting_payment','awaiting_verification')`).bind(t, t, t, t, orderId).run();
  if (!upd.meta.changes) return { ok: false };
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
  const ext = await shareMaybeExtend(env, base, o.license_id, `Tagihan sharing ${o.code} lunas`);
  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(o.license_id).first();
  const user = await getUser(env, o.user_id);
  const s = await getSettings(env);
  const line = ext.extended ? `Lisensi berlaku sampai ${fmtDate(ext.expires_at)}${ext.reactivated ? ', EA aktif lagi (file EA baru sedang dibuat)' : ''}.`
    : `Lisensi berlaku sampai ${fmtDate(lic && lic.expires_at)}.`;
  await notify(env, o.user_id, `Tagihan ${o.code} lunas`, `Pembayaran ${rupiah(o.total)} diterima. ${line}`, '#/pesanan/' + o.id);
  await emailUser(env, user, `Tagihan sharing profit ${o.code} lunas`,
    `<p>Halo ${esc(user.name)},</p><p>Pembayaran komisi sharing profit <b>${rupiah(o.total)}</b> untuk akun <b>${esc(o.account_number)}</b> sudah kami terima. Terima kasih!</p><p>${line}</p>
     <p style="color:#a3a3b2;font-size:13px">Laporan &amp; tagihan berikutnya: Minggu depan. Jatuh tempo selalu ${shareDueDays(s)} hari setelah Minggu.</p>`,
    { text: 'Buka Lisensi', url: `${base}/member#/lisensi` });
  await emailAdmin(env, base, `Tagihan sharing ${o.code} lunas (${o.paid_via || 'manual'})`,
    `<p>${esc(user.name)} membayar komisi <b>${rupiah(o.total)}</b> untuk akun ${esc(o.account_number)} lewat <b>${esc(o.paid_via || 'manual')}</b>. ${esc(line)}</p>`, '/admin#/pesanan/' + o.id);
  return { ok: true, ...ext };
}
