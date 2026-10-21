'use strict';
/* Spoolio - magazzino filamenti, archivio stampe, calcolo costi. Sync cloud via Firebase Realtime Database (REST). */
const KEY = 'spoolio_v1', CFG = 'spoolio_cfg', PH = 'spoolio_photos', CALC = 'spoolio_calc';
const OF = 'onfocus="this.select()"';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const eur = n => (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const fmtT = m => { m = Math.round(m || 0); return m ? (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? (m % 60) + 'm' : '') : '—'; };
const roundHalf = n => Math.ceil(n * 2 - 1e-9) / 2;
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } };

const BRANDS = {
  'sunlu': 'sunlu.com', 'bambu lab': 'bambulab.com', 'bambu': 'bambulab.com', 'esun': 'esun3d.com',
  'polymaker': 'polymaker.com', 'elegoo': 'elegoo.com', 'creality': 'creality.com', 'overture': 'overture3d.com',
  'eryone': 'eryone3d.com', 'jayo': 'jayo3d.com', 'anycubic': 'anycubic.com', 'kingroon': 'kingroon.com',
  'flashforge': 'flashforge.com', 'prusament': 'prusa3d.com', 'geeetech': 'geeetech.com', 'siraya tech': 'siraya.tech',
  'hatchbox': 'hatchbox3d.com', 'fiberlogy': 'fiberlogy.com', 'filamentive': 'filamentive.com', 'fillamentum': 'fillamentum.com',
};
const PAL = [['Nero', '#1a1a1a'], ['Antracite', '#3b3f45'], ['Grigio', '#8b9097'], ['Grigio chiaro', '#c9cdd2'], ['Bianco', '#f6f6f4'], ['Bone', '#eee5d0'], ['Beige', '#e3cfb4'], ['Sabbia', '#d8b98a'],
  ['Rosso', '#d62828'], ['Ciliegia', '#a4161a'], ['Corallo', '#ff6b6b'], ['Sakura', '#f7c6d4'], ['Rosa', '#f7a8c4'], ['Fucsia', '#e91e8c'], ['Magenta', '#d6249f'], ['Pesca', '#ffb48a'],
  ['Arancio', '#ff8a1f'], ['Terracotta', '#c8553d'], ['Giallo', '#f8d21b'], ['Oro', '#d4a72c'], ['Senape', '#c79a1d'], ['Lime', '#a3d93b'], ['Verde', '#3f9d46'], ['Foresta', '#1f6b3a'],
  ['Oliva', '#6b7a2a'], ['Salvia', '#9db38a'], ['Menta', '#a6e6d0'], ['Verde acqua', '#2cc5b0'], ['Ice', '#bfe4f3'], ['Azzurro', '#6ec1f0'], ['Cielo', '#4aa3df'], ['Blu', '#2563eb'],
  ['Klein', '#002fa7'], ['Navy', '#1c2541'], ['Oceano', '#1b6ca8'], ['Blu grey', '#6f8397'], ['Lavanda', '#c8b5ea'], ['Lilla', '#b9a2d8'], ['Viola', '#7c3aed'], ['Prugna', '#5b2a6e'],
  ['Galaxy', '#4f4a8f'], ['Cioccolato', '#5b3a29'], ['Caffe', '#7a4a2b'], ['Quercia', '#b38a58'], ['Argilla', '#b8704f'], ['Argento', '#c0c0c8'], ['Rame', '#b87333'], ['Bronzo', '#8c6a3f']];
const TYPES = ['PLA', 'PLA+', 'PLA Matte', 'PLA Silk', 'PLA Basic', 'PLA Marble', 'PLA Galaxy', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC'];

/* ---------- stato ---------- */
let S = jget(KEY, null);
if (!S || !S.filaments) S = seedState();
S.settings = { ...DEF_SETTINGS, ...S.settings };
S.meta = { dirty: {}, photoDirty: {}, pushedAll: 0, ...S.meta };
if (!S.meta.mig2) { // migrazione unica: marca Sunlu e costo 12,99 sulle bobine gia' presenti
  S.meta.mig2 = 1;
  for (const f of S.filaments) if (f.id.startsWith('f_') && !f.d) { if (!f.brand) f.brand = 'Sunlu'; if (!(f.costo > 0)) f.costo = 12.99; f.u = Date.now(); S.meta.dirty['filaments:' + f.id] = 1; }
  jset(KEY, S);
}
const ensurePrinters = () => { if (!Array.isArray(S.settings.printers) || !S.settings.printers.length) S.settings.printers = [{ id: 'p1', nome: 'Bambu Lab P2S', watt: S.settings.watt || 150, usuraOra: S.settings.usuraOra ?? 0.25 }]; };
ensurePrinters();
let PHOTOS = jget(PH, {});
let V = { tab: 'mag', q: '', flt: 'all', pq: '' };
const save = () => jset(KEY, S);
const list = c => S[c].filter(x => !x.d);
const fil = id => S.filaments.find(f => f.id === id && !f.d);
function touch(coll, rec) {
  rec.u = Date.now();
  S.meta.dirty[(coll === 'settings' ? 'settings:main' : coll + ':' + rec.id)] = 1;
  save(); schedSync();
}

/* ---------- logica filamenti / costi ---------- */
const fname = f => [f.brand, f.type, f.color].filter(Boolean).join(' ');
const tot = f => (f.nuove || 0) + (f.usate || 0);
const gTot = f => (f.nuove || 0) * (f.peso || 1000) + (f.residuo || 0);
function reWhy(f) {
  if (f.ignora) return '';
  const st = S.settings;
  if (tot(f) <= 0) return '0 bobine';
  if (f.riordina) return 'Forzato';
  if (st.sogliaNuove > 0 && (f.nuove || 0) < st.sogliaNuove) return (f.nuove || 0) + ' nuove';
  if (st.sogliaGr > 0 && gTot(f) < st.sogliaGr) return Math.round(gTot(f)) + ' g rimasti';
  return '';
}
const needRe = f => !!reWhy(f);
const gcost = f => (f.costo > 0 ? f.costo / (f.peso || 1000) : S.settings.costoKg / 1000);
const gSearch = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
const site = b => BRANDS[(b || '').toLowerCase().trim()];
const isSunlu = f => (f.brand || '').toLowerCase().trim() === 'sunlu';
const IT_EN = { grigio: 'grey', giallo: 'yellow', rosa: 'pink', bianco: 'white', verde: 'green', blu: 'blue', rosso: 'red', nero: 'black', arancio: 'orange', viola: 'purple', marrone: 'brown', azzurro: 'light blue', oro: 'gold', argento: 'silver', lucido: 'silk', opaco: 'matte', matt: 'matte', cioccolato: 'chocolate', lavanda: 'lavender', acqua: 'aqua', viola_: 'violet' };
const trWords = t => t.split(/\s+/).filter(Boolean).map(w => IT_EN[w.toLowerCase()] || w).join(' ');
function colorQueries(f) {
  const m = f.color.match(/\((.*?)\)/), outer = f.color.replace(/\(.*?\)/g, '').trim(), inner = m ? m[1].trim() : '';
  const t = f.type || 'PLA', qs = [];
  [outer, inner].filter(Boolean).forEach(c => { const e = trWords(c); qs.push(`${t} ${e}`, `${t} ${e.split(' ').pop()}`); });
  qs.push(`${t} ${trWords(outer).split(' ')[0]}`, t, 'PLA');
  return [...new Set(qs.map(x => x.replace(/\s+/g, ' ').trim()))];
}
function productLink(f) {
  if (f.url) return f.url;
  if (isSunlu(f)) return 'https://store.sunlu.com/search?type=product&q=' + encodeURIComponent(colorQueries(f)[0]);
  const s = site(f.brand);
  return s ? gSearch(`site:${s} ${f.type || ''} ${f.color}`.replace(/\s+/g, ' ')) : gSearch(`${fname(f)} filamento 3D`);
}
const brandLink = f => site(f.brand) ? 'https://' + (site(f.brand) === 'sunlu.com' ? 'store.sunlu.com' : site(f.brand)) : gSearch(f.brand + ' filamento 3D');
function openUrl(u) { // browser predefinito del telefono
  try {
    const L = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
    if (L && L.openUrl) { L.openUrl({ url: u }); return; }
  } catch (e) { }
  window.open(u, '_blank');
}
/* prezzi e link dal sito Sunlu (richieste native dal telefono, nessun blocco CORS) */
async function nget(url) {
  const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (H && H.get) { const r = await H.get({ url, headers: { Accept: 'application/json' } }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
  const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
}
const SUNLU = 'https://store.sunlu.com', PRK = 'spoolio_pr2';
const okTitle = t => /filament|pla|petg|abs|tpu|asa|silk/i.test(t) && !/combo|bundle|spools|box|gift|dryer|printer|sample|sticker|nozzle/i.test(t);
async function sunluLookup(f, cache) {
  for (const q of colorQueries(f)) {
    if (!(q in cache)) {
      try { const d = await nget(`${SUNLU}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`); cache[q] = (d.resources && d.resources.results && d.resources.results.products) || []; } catch { cache[q] = []; }
    }
    const p = cache[q].find(x => okTitle(x.title || ''));
    if (p) { let pr = parseFloat(p.price) || 0; if (pr >= 100 && /^\d+$/.test(String(p.price))) pr /= 100; return { url: SUNLU + String(p.url).split('?')[0], price: pr }; }
  }
  return null;
}
const rateCache = {};
async function eurRate(origin) {
  if (origin in rateCache) return rateCache[origin];
  let r = 0;
  try {
    const c = (await nget(origin + '/cart.js')).currency;
    r = !c || c === 'EUR' ? 1 : ((await nget('https://api.frankfurter.app/latest?from=' + c + '&to=EUR')).rates.EUR || 0);
  } catch { r = 0; }
  return (rateCache[origin] = r);
}
const spoolsOf = t => { const m = t.match(/(\d+)\s*(?:x\s*)?(?:spools?|rolls?|pcs|pack|bobine)/i) || t.match(/(\d+)\s*kg/i); return m ? Math.max(1, +m[1]) : 1; };
/* prezzo per UNA bobina da 1 kg dalla pagina prodotto (variante del colore giusto) */
async function productPrice(f, url) {
  const m = url.match(/^(https?:\/\/[^/]*sunlu[^/]*)\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/([^/?#]+)/i); if (!m) return null;
  const d = await nget(`${m[1]}/products/${m[2]}.js`), vs = d.variants || []; if (!vs.length) return null;
  const vtxt = v => v.title || [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
  const per = v => v.price / 100 / spoolsOf(vtxt(v));
  const vid = (url.match(/[?&]variant=(\d+)/) || [])[1];
  let pick = vid ? vs.find(v => String(v.id) === vid) : null;
  if (!pick) {
    const outer = f.color.replace(/\(.*?\)/g, '').trim(), inner = (f.color.match(/\((.*?)\)/) || [])[1] || '';
    const words = [...new Set([outer, inner].filter(Boolean).flatMap(c => [...c.toLowerCase().split(/\s+/), ...trWords(c).toLowerCase().split(/\s+/)]))].filter(w => w.length > 2 && !['matte', 'matt', 'pla'].includes(w));
    const sc = v => words.filter(w => vtxt(v).toLowerCase().includes(w)).length;
    const best = Math.max(...vs.map(sc));
    let pool = best > 0 ? vs.filter(v => sc(v) === best) : vs;
    const one = pool.filter(v => spoolsOf(vtxt(v)) === 1); if (one.length) pool = one;
    pick = pool.reduce((a, v) => (per(v) < per(a) ? v : a), pool[0]);
  }
  const mq = (String(d.title || '') + ' ' + vtxt(pick)).match(/(?:\bmin\.?|moq)\s*(\d+)/i);
  return { price: per(pick), origin: m[1], variant: vtxt(pick), id: pick.id, moq: mq ? +mq[1] : 0 };
}
async function cartSheet() {
  const fs = list('filaments').filter(f => needRe(f) && /^https?:\/\/[^/]+\/(?:[a-z-]+\/)?products\//i.test(f.url || ''));
  if (!fs.length) { toast('Nessuna bobina da riordinare con link prodotto'); return; }
  toast('Preparo il carrello…'); const it = [];
  for (const f of fs) {
    try {
      const pv = await productPrice(f, f.url); if (!pv) continue;
      const rate = await eurRate(pv.origin), pr = rate ? Math.round(pv.price * rate * 100) / 100 : (f.costo || 0);
      it.push({ f, o: pv.origin, id: pv.id, v: pv.variant, pr, q: 1, on: true, moq: pv.moq, why: reWhy(f) });
    } catch (e) { console.warn(e); }
  }
  if (!it.length) { toast('Impossibile leggere gli store'); return; }
  const eur = n => n.toFixed(2).replace('.', ',') + ' €';
  const row = (x, i) => `<div class="crow ${x.on ? '' : 'off'}" data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9">
    <input type="checkbox" class="cc" ${x.on ? 'checked' : ''} style="width:20px;height:20px;flex:none">
    <span style="width:14px;height:14px;border-radius:50%;background:${esc(x.f.hex || '#999')};border:1px solid #0002;flex:none"></span>
    <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.9rem">${esc(fname(x.f))}</div>
      <div style="font-size:.72rem;color:#6b7280">${esc(x.v)} · ${eur(x.pr)}${x.why ? ` · <span class="badge b-amb" style="padding:1px 6px">${esc(x.why)}</span>` : ''}</div></div>
    <div style="display:flex;align-items:center;gap:4px;flex:none"><button class="btn ghost cm" style="padding:2px 10px">−</button><b class="cn" style="min-width:18px;text-align:center">${x.q}</b><button class="btn ghost cp" style="padding:2px 10px">+</button></div>
    <b class="ct" style="width:62px;text-align:right;font-size:.85rem;flex:none">${eur(x.pr * x.q)}</b>
    <button class="cd" style="border:0;background:none;font-size:1.1rem;flex:none">🗑</button></div>`;
  const body = `<div id="clist">${it.map(row).join('')}</div>
    <div id="cwarn" style="display:none;margin-top:8px;padding:8px 10px;border-radius:10px;background:#fffbeb;color:#92400e;font-size:.82rem"></div>
    <div id="ctot" style="margin:10px 0 6px;font-weight:700"></div>
    <button class="btn ghost" id="ccopy" style="width:100%">Copia lista spesa</button>`;
  const sel = () => it.filter(x => x.on && x.q > 0);
  openSheet('Carrello riordino', body, { label: 'Apri carrello', save: el => {
    const g = {}; sel().forEach(x => (g[x.o] = g[x.o] || []).push(x.id + ':' + x.q));
    const urls = Object.entries(g).map(([o, l]) => o + '/cart/' + l.join(','));
    if (!urls.length) { toast('Nessuna bobina selezionata'); return false; }
    urls.forEach((u, i) => setTimeout(() => openUrl(u), i * 1500));
  }, init: el => {
    const upd = () => {
      el.querySelectorAll('.crow').forEach(r => { const x = it[+r.dataset.i]; r.classList.toggle('off', !x.on); r.style.opacity = x.on ? 1 : .45; r.querySelector('.cn').textContent = x.q; r.querySelector('.ct').textContent = eur(x.pr * x.q); r.querySelector('.cc').checked = x.on; });
      const n = sel().reduce((a, x) => a + x.q, 0), t = sel().reduce((a, x) => a + x.q * x.pr, 0);
      $('#ctot', el).textContent = `Totale stimato: ${eur(t)} · ${n} bobine`;
      const moq = S.settings.sogliaMin > 0 ? S.settings.sogliaMin : Math.max(0, ...it.map(x => x.moq || 0)), miss = moq - n;
      const w = $('#cwarn', el); w.style.display = moq && miss > 0 ? 'block' : 'none'; w.textContent = `⚠️ Minimo ${moq} bobine per questo ordine: ne mancano ${miss}.`;
      const ok = el.querySelector('[data-s=ok]'); ok.textContent = `Apri carrello (${n})` + (moq && miss > 0 ? ` · mancano ${miss}` : '');
    };
    el.addEventListener('click', e => {
      const r = e.target.closest('.crow'); if (!r) { if (e.target.id === 'ccopy') share('Lista spesa:\n' + sel().map(x => `- ${x.q}x ${fname(x.f)}`).join('\n') + `\nTotale: ${eur(sel().reduce((a, x) => a + x.q * x.pr, 0))}`, 'Lista spesa'); return; }
      const x = it[+r.dataset.i];
      if (e.target.closest('.cp')) x.q++;
      else if (e.target.closest('.cm')) x.q = Math.max(1, x.q - 1);
      else if (e.target.closest('.cd')) x.on = false;
      else if (e.target.classList.contains('cc')) x.on = e.target.checked;
      else return;
      upd();
    });
    upd();
  } });
}
let PRB = false;
async function refreshPrices(force) {
  if (PRB) return;
  if (!force && Date.now() - jget(PRK, 0) < 600e3) return;
  const fs = list('filaments').filter(f => isSunlu(f) && f.auto !== 0 && (!f.url || /sunlu/i.test(f.url)));
  if (!fs.length) { if (force) toast('Nessuna bobina Sunlu da aggiornare'); return; }
  PRB = true; let n = 0, ok = 0;
  try {
    const cache = {};
    for (const f of fs) {
      try {
        let url = f.url, ch = false;
        if (!/\/products\//.test(url || '')) {
          const r = await sunluLookup(f, cache); if (!r) continue;
          url = r.url; if (!f.url || f.urlAuto) { f.url = url; f.urlAuto = 1; ch = true; }
        }
        const pv = await productPrice(f, url); if (!pv) continue; ok++;
        const rate = await eurRate(pv.origin), pr = Math.round(pv.price * rate * 100) / 100;
        if ((f.costo || 0) > 25) { f.costo = 12.99; ch = true; }
        if (rate && pr >= 6 && pr <= 25) { if (Math.abs((f.costo || 0) - pr) > 0.004) { f.costo = pr; ch = true; } if (f.pvar !== pv.variant) { f.pvar = pv.variant; ch = true; } if (!f.pagg || ch) f.pagg = Date.now(); }
        if (ch) { touch('filaments', f); n++; }
      } catch (e) { console.warn(e); }
    }
    if (ok) jset(PRK, Date.now());
  } catch (e) { console.warn(e); }
  PRB = false;
  if (n && !sheet && V.tab === 'mag') render();
  if (force) toast(ok ? `Prezzi aggiornati (${n} modificati su ${ok})` : 'Sito Sunlu non raggiungibile');
}
/* costi */
const printerOf = id => { const L = S.settings.printers || []; return L.find(p => p.id === id) || L[0] || { id: 'p1', nome: 'Stampante', watt: S.settings.watt || 150, usuraOra: S.settings.usuraOra || 0.25 }; };
function calc(items, min, o = {}) {
  const st = S.settings, pr = printerOf(o.pid); let mat = 0, est = false, nc = 0;
  for (const it of items) {
    if (!(it.g > 0)) continue; nc++;
    if (it.f) { mat += it.g * gcost(it.f); if (!(it.f.costo > 0)) est = true; }
    else { const k = it.costKg > 0 ? it.costKg : st.costoKg; mat += it.g * k / 1000; if (!(it.costKg > 0)) est = true; }
  }
  const purge = nc > 1 ? mat * (st.purge || 0) / 100 : 0;
  const h = (min || 0) / 60, kwhP = st.kwh > 0 ? st.bolletta / st.kwh : 0;
  const en = h * kwhP * pr.watt / 1000, us = h * pr.usuraOra;
  const lav = (o.lav || 0) / 60 * (st.manoOra || 0), extra = o.extra || 0;
  const run = mat + purge + en + us, fail = run * st.fallimento / 100, t = run + fail + lav + extra;
  return { mat, purge, en, us, fail, lav, extra, tot: t, price: roundHalf(t * st.ricarico), est, kwhP, pr };
}
const printItems = p => (p.colori || []).map(c => ({ f: fil(c.fid), g: num(c.g) }));
const printGrams = p => (p.colori || []).reduce((a, c) => a + num(c.g), 0);
const printCalc = p => calc(printItems(p), p.minuti, { pid: p.pid, extra: p.extra, lav: p.lav });
const hexOf = c => (c.fid && fil(c.fid) ? fil(c.fid).hex : '');
function consume(f, g) { // scarico automatico: prima le bobine usate, poi apre le nuove
  const w = f.peso || 1000, open0 = Math.max(0, f.residuo - f.nuove * w);
  f.residuo = Math.max(0, f.residuo - g);
  if (g < open0) f.usate = Math.max(1, Math.ceil(f.usate * (open0 - g) / open0));
  else {
    const k = Math.min(f.nuove, Math.ceil((g - open0) / w)); f.nuove -= k;
    f.usate = f.residuo - f.nuove * w > 0.5 ? 1 : 0;
  }
  if (tot(f) <= 0) f.riordina = 1;
}

/* ---------- UI helpers ---------- */
let toastT;
function toast(msg, undo) {
  const t = $('#toast'); t.innerHTML = esc(msg) + (undo ? '<button>Annulla</button>' : '');
  t.className = 'on'; clearTimeout(toastT);
  if (undo) $('button', t).onclick = () => { undo(); t.className = ''; };
  toastT = setTimeout(() => t.className = '', undo ? 5000 : 2200);
}
let acBoxes = [];
function clearAC() { acBoxes.forEach(b => b.remove()); acBoxes = []; }
function attachAC(input, getItems, onPick) {
  const box = document.createElement('div'); box.className = 'ac'; box.hidden = true;
  document.body.appendChild(box); acBoxes.push(box);
  let idx = -1, items = [];
  const hide = () => { box.hidden = true; idx = -1; };
  const mark = () => $$('div', box).forEach((d, i) => d.classList.toggle('on', i === idx));
  const show = () => {
    items = getItems(input.value.trim()).slice(0, 8);
    if (!items.length) return hide();
    box.innerHTML = items.map((it, i) => `<div data-i="${i}">${it.hex ? `<i style="background:${esc(it.hex)}"></i>` : ''}<span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>`).join('');
    const r = input.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.width = Math.max(r.width, 200) + 'px';
    const below = innerHeight - r.bottom > 200;
    box.style.top = below ? r.bottom + 2 + 'px' : 'auto'; box.style.bottom = below ? 'auto' : innerHeight - r.top + 2 + 'px';
    box.hidden = false; idx = -1;
  };
  const pick = i => { hide(); onPick(items[i]); };
  input.addEventListener('input', show); input.addEventListener('focus', show);
  input.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { idx = (idx + 1) % items.length; mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = (idx - 1 + items.length) % items.length; mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(idx >= 0 ? idx : 0); }
    else if (e.key === 'Tab' && idx >= 0) { pick(idx); }
    else if (e.key === 'Escape') { e.stopPropagation(); hide(); }
  }, true);
  input.addEventListener('blur', () => setTimeout(hide, 160));
  box.addEventListener('mousedown', e => { e.preventDefault(); const d = e.target.closest('[data-i]'); if (d) pick(+d.dataset.i); });
}
const filItems = q => {
  const t = q.toLowerCase().split(/\s+/).filter(Boolean);
  return list('filaments').filter(f => t.every(w => fname(f).toLowerCase().includes(w)))
    .sort((a, b) => (tot(b) > 0) - (tot(a) > 0) || fname(a).localeCompare(fname(b)))
    .map(f => ({ label: fname(f), hex: f.hex, sub: tot(f) > 0 ? tot(f) + ' bob.' : 'esaurito', f }));
};
const listItems = arr => q => arr().filter(x => x.toLowerCase().includes(q.toLowerCase()) && x.toLowerCase() !== q.toLowerCase()).map(x => ({ label: x }));

/* sheet (finestra modale) */
let sheet = null, skipPop = false;
function openSheet(title, body, o = {}) {
  removeSheet();
  const el = document.createElement('div'); el.className = 'sheet-bg';
  el.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div><h2>${esc(title)}</h2><div class="sbody">${body}</div><div class="sbtns">${o.del ? '<button class="btn danger" data-s="del">Elimina</button>' : ''}<span style="flex:1"></span><button class="btn ghost" data-s="x">Annulla</button><button class="btn primary" data-s="ok">${o.label || 'Salva'}</button></div></div>`;
  document.body.appendChild(el);
  sheet = { el, ...o }; history.pushState({ sheet: 1 }, '');
  const doSave = () => { if (o.save && o.save(el) === false) return; closeSheet(); };
  el.addEventListener('mousedown', e => { if (e.target === el) closeSheet(); });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'x') closeSheet();
    else if (b.dataset.s === 'ok') doSave();
    else if (b.dataset.s === 'del') {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Sicuro? Tocca ancora'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Elimina'; }, 3000); return; }
      o.del(); closeSheet();
    }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
    else if (e.key === 'Enter' && e.target.matches('input:not([type=file]):not([type=checkbox])')) { e.preventDefault(); doSave(); }
  });
  if (o.init) o.init(el);
  const sh = $('.sheet', el), sb = $('.sbody', el); let y0 = 0, dy = 0, drag = false, t0 = 0, hdr = false, noDrag = false;
  sh.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; drag = false; t0 = Date.now(); hdr = !e.target.closest('.sbody'); noDrag = !!e.target.closest('input[type=range]'); }, { passive: true });
  sh.addEventListener('touchmove', e => {
    const d = e.touches[0].clientY - y0;
    if (!drag) { if (!noDrag && d > 8 && (hdr || sb.scrollTop <= 0) && !e.target.closest('.sbtns')) { drag = true; acBoxes.forEach(b => b.hidden = true); if (document.activeElement) document.activeElement.blur(); } else return; }
    dy = Math.max(0, d); sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; el.style.background = `rgba(15,23,42,${.45 * Math.max(0, 1 - dy / 500)})`; e.preventDefault();
  }, { passive: false });
  sh.addEventListener('touchend', () => {
    if (!drag) return; drag = false;
    sh.style.transition = 'transform .18s';
    if (dy > 110 || dy / Math.max(1, Date.now() - t0) > .6) { sh.style.transform = 'translateY(100%)'; setTimeout(closeSheet, 170); }
    else { sh.style.transform = ''; el.style.background = ''; }
  });
}
function removeSheet() { if (sheet) { sheet.el.remove(); sheet = null; } clearAC(); }
function closeSheet() { removeSheet(); if (history.state && history.state.sheet) { skipPop = true; history.back(); } }
try {
  const A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (A && A.addListener) A.addListener('backButton', () => {
    if ($('.scan')) $('.scan button').click(); else if (sheet) closeSheet(); else if (V.tab !== 'mag') { V.tab = 'mag'; render(); } else if (A.exitApp) A.exitApp();
  });
} catch (e) { }
addEventListener('popstate', () => { if (skipPop) { skipPop = false; return; } removeSheet(); });

/* ---------- render ---------- */
function render() {
  clearAC();
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === V.tab));
  $('#fab').style.display = (V.tab === 'mag' || V.tab === 'print') ? 'grid' : 'none';
  const v = $('#view');
  v.innerHTML = { mag: viewMag, print: viewPrint, calc: viewCalc, set: viewSet }[V.tab]();
  ({ calc: bindCalc, set: bindSet }[V.tab] || (() => { }))();
  setDot();
}

const MAT = { PLA: 'b-g', PETG: 'b-b', ABS: 'b-red', ASA: 'b-o', TPU: 'b-q' };
const typeBadge = f => {
  if (!f.type) return `<a class="badge b-gy" data-a="edit" data-id="${f.id}">tipo?</a>`;
  const k = Object.keys(MAT).find(m => f.type.toUpperCase().startsWith(m));
  return `<span class="badge ${MAT[k] || 'b-gy'}">${esc(f.type)}</span>`;
};
const STATI = { sigillata: '🔒 Sigillata', drybox: '📦 Dry Box', essicca: '💧 Da essiccare' };
function viewMag() {
  const all = list('filaments');
  const out = f => tot(f) <= 0, low = f => !out(f) && f.residuo < S.settings.soglia;
  const nOut = all.filter(needRe).length;
  const q = V.q.toLowerCase();
  let rows = all.filter(f => (!q || (fname(f) + ' ' + f.note + ' ' + (f.barcode || '')).toLowerCase().includes(q)) && ({
    all: () => true, stock: () => !out(f), low: () => low(f), out: () => needRe(f), new: () => f.nuove > 0, used: () => f.usate > 0, dry: () => f.stato === 'essicca' || f.stato === 'drybox',
  })[V.flt]());
  rows.sort((a, b) => (out(a) - out(b)) || fname(a).localeCompare(fname(b)));
  return `<div class="stats">
    <button class="stat ${V.flt === 'stock' ? 'on' : ''}" data-a="flt" data-t="1" data-k="stock"><b>${all.filter(f => !out(f)).length}</b><span>Tipi</span></button>
    <button class="stat ${V.flt === 'new' ? 'on' : ''}" data-a="flt" data-t="1" data-k="new"><b>${all.reduce((a, f) => a + (f.nuove || 0), 0)}</b><span>Nuove</span></button>
    <button class="stat ${V.flt === 'used' ? 'on' : ''}" data-a="flt" data-t="1" data-k="used"><b>${all.reduce((a, f) => a + (f.usate || 0), 0)}</b><span>Usate</span></button>
    <button class="stat ${nOut ? 'warn' : ''} ${V.flt === 'out' ? 'on' : ''}" data-a="flt" data-t="1" data-k="out"><b>${nOut}</b><span>Riordina</span></button></div>
  <div style="display:flex;gap:8px;align-items:center"><input class="search" id="q" type="text" ${OF} placeholder="Cerca marca, tipo, colore o codice" value="${esc(V.q)}" style="flex:1;min-width:0"><button data-a="cart" aria-label="Carrello riordino" style="position:relative;flex:none;width:46px;height:46px;border-radius:14px;border:1px solid #d1fae5;background:#ecfdf5;font-size:1.25rem">🛒${nOut ? `<span style="position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;border-radius:10px;background:#059669;color:#fff;font-size:.7rem;font-weight:700;line-height:19px;text-align:center;padding:0 4px">${nOut}</span>` : ''}</button></div>
  <div class="chips">${[['all', 'Tutti'], ['stock', 'In scorta'], ['low', 'Bassi'], ['dry', '💧 Essiccazione']].map(([k, l]) => `<button class="chip ${V.flt === k ? 'on' : ''}" data-a="flt" data-k="${k}">${l}</button>`).join('')}
    <button class="chip" data-a="scan">📷 Scansiona</button><button class="chip" data-a="prices">↻ Prezzi Sunlu</button>
    ${V.flt === 'out' && rows.length ? '<button class="chip" data-a="copyreorder">Copia lista</button>' : ''}</div>
  <div class="list">${rows.map(filCard).join('') || '<div class="empty">Nessuna bobina. Tocca + per aggiungerne una, oppure collega il cloud in Impostazioni.</div>'}</div>`;
}
function filCard(f) {
  const t = tot(f), isOut = t <= 0, isLow = !isOut && f.residuo < S.settings.soglia;
  const pct = t > 0 ? Math.min(100, Math.round(100 * f.residuo / (t * (f.peso || 1000)))) : 0;
  return `<div class="card" data-id="${f.id}" data-c="f">
    <div class="crow1"><div class="sw" style="background:${esc(f.hex || '#ccc')}"></div>
      <div class="ti"><div class="small">${f.brand ? `<a class="lk has" data-a="brand" data-id="${f.id}">${esc(f.brand)}</a>` : '<a class="lk" data-a="edit" data-id="' + f.id + '">marca?</a>'} ${typeBadge(f)}
        ${isOut ? '<span class="badge b-red">Esaurito</span>' : ''}${needRe(f) && !isOut ? '<span class="badge b-amb">Riordina</span>' : ''}${isLow ? '<span class="badge b-amb">Basso</span>' : ''}${STATI[f.stato] ? `<span class="badge b-gy">${STATI[f.stato]}</span>` : ''}</div>
        <div class="name"><a class="lk ${f.url ? 'has' : ''}" data-a="link" data-id="${f.id}" title="${f.url ? 'Apri link prodotto' : 'Cerca sul sito'}">${esc(f.color)} ${f.url ? '↗' : '🔍'}</a></div></div>
      <div class="money">${f.costo > 0 ? eur(f.costo) : '<span class="small">costo?</span>'}<small>bobina${f.pagg && f.auto !== 0 ? ' · dal sito' : ''}</small></div></div>
    <div class="bar ${isLow || isOut ? 'low' : ''}"><i style="width:${pct}%"></i></div>
    <div class="meta"><div class="steps">
      <div class="stp">Nuove <button data-a="n" data-id="${f.id}" data-k="nuove" data-d="-1">−</button><b>${f.nuove}</b><button data-a="n" data-id="${f.id}" data-k="nuove" data-d="1">+</button></div>
      <div class="stp">Usate <button data-a="n" data-id="${f.id}" data-k="usate" data-d="-1">−</button><b>${f.usate}</b><button data-a="n" data-id="${f.id}" data-k="usate" data-d="1">+</button></div></div>
      <a class="lk" data-a="resid" data-id="${f.id}" title="Imposta peso residuo">≈ ${f.residuo >= 1000 ? (f.residuo / 1000).toFixed(2) + ' kg' : Math.round(f.residuo) + ' g'} ✎</a></div></div>`;
}

function viewPrint() {
  const all = list('prints'), q = V.pq.toLowerCase();
  const rows = all.filter(p => !q || p.nome.toLowerCase().includes(q) || (p.colori || []).some(c => c.nome.toLowerCase().includes(q))).sort((a, b) => a.nome.localeCompare(b.nome));
  const withCost = all.filter(p => printGrams(p) > 0 || p.minuti > 0);
  const marg = withCost.length ? withCost.reduce((a, p) => a + (p.prezzo - printCalc(p).tot), 0) / withCost.length : null;
  return `<div class="stats">
    <div class="stat"><b>${all.length}</b><span>Oggetti</span></div>
    <div class="stat"><b>${all.reduce((a, p) => a + (p.scorta || 0), 0)}</b><span>In magazzino</span></div>
    <div class="stat"><b>${eur(all.reduce((a, p) => a + (p.scorta || 0) * (p.prezzo || 0), 0)).replace(',00', '')}</b><span>Valore</span></div>
    <div class="stat"><b>${marg === null ? '—' : eur(marg).replace(',00', '')}</b><span>Margine medio</span></div></div>
  <input class="search" id="pq" type="text" ${OF} placeholder="Cerca oggetto o colore" value="${esc(V.pq)}">
  <div style="height:10px"></div>
  <div class="list">${rows.map(printCard).join('') || '<div class="empty">Nessuna stampa. Tocca + per aggiungerne una.</div>'}</div>`;
}
function printCard(p) {
  const g = printGrams(p), has = g > 0 || p.minuti > 0, c = has ? printCalc(p) : null, m = c ? p.prezzo - c.tot : null;
  const ph = PHOTOS[p.id] && PHOTOS[p.id].data;
  return `<div class="card" data-id="${p.id}" data-c="p">
    <div class="crow1">${ph ? `<img class="thumb" src="${ph}" alt="">` : '<div class="thumb">🧸</div>'}
      <div class="ti"><div class="name">${esc(p.nome)}</div><div class="small">${p.minuti ? '⏱ ' + fmtT(p.minuti) : ''}${p.minuti && g ? ' · ' : ''}${g ? '⚖ ' + Math.round(g) + ' g' : ''}${!has ? 'ore e grammi da inserire' : ''}</div></div>
      <div class="money">${eur(p.prezzo).replace(',00', '')}<small>${c ? 'costo ' + eur(c.tot) + ' · <span class="' + (m >= 0 ? 'pos' : 'neg') + '">' + (m >= 0 ? '+' : '') + eur(m) + '</span>' : 'prezzo'}</small></div></div>
    <div class="dots">${(p.colori || []).map(x => `<span class="dot ${hexOf(x) ? '' : 'x'}"><i style="background:${esc(hexOf(x))}"></i>${esc(x.nome)}</span>`).join('')}</div>
    <div class="meta"><div class="stp">In magazzino <button data-a="pn" data-id="${p.id}" data-d="-1">−</button><b>${p.scorta || 0}</b><button data-a="pn" data-id="${p.id}" data-d="1">+</button></div>
      ${p.file ? `<a class="lk has small" data-a="pfile" data-id="${p.id}">📎 File 3D</a>` : '<span class="small">+ = stampato (scala i grammi)</span>'}</div></div>`;
}

/* ---------- calcolatore ---------- */
const freshCS = () => ({ rows: [{ fid: '', name: '', g: '' }], h: '', m: '', x: '', l: '', pid: '' });
let CS = freshCS();
const prChips = (cur, attr) => { const L = S.settings.printers || [], c = printerOf(cur); return `<div class="lab" style="margin:10px 0 4px">Stampante</div><div class="chips wrap" style="padding:2px 0">${L.map(p => `<button type="button" class="chip ${c.id === p.id ? 'on' : ''}" ${attr}="${p.id}">🖨 ${esc(p.nome)}</button>`).join('')}</div><p class="hint" style="margin:2px 0 6px">${c.watt} W · usura ${eur(c.usuraOra)}/h</p>`; };
function viewCalc() {
  return `<div class="res"><button class="rst" data-a="resetcalc">Azzera</button><div class="rl">Costo totale</div><div class="rbig" id="rtot">€0,00</div>
    <div class="rrow"><div><span>Prezzo consigliato</span><b id="rprice">€0</b></div><div><span>Guadagno</span><b id="rgain">€0</b></div></div>
    <div class="rl" id="rest" style="margin-top:8px;text-transform:none"></div></div>
  <div class="panel"><h3>Filamenti</h3><div id="crows">${CS.rows.map(rowHtml).join('')}</div>
    <button class="btn sm" data-a="addrow">+ Colore</button>
    <p class="hint" id="purgehint"></p>
    <h3 style="margin-top:14px">Tempo di stampa</h3><div class="g2">
      <div class="f"><label>Ore</label><input id="ch" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${esc(CS.h)}"></div>
      <div class="f"><label>Minuti</label><input id="cm" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${esc(CS.m)}"></div></div>
    <div class="chips wrap" style="padding-top:0">${[15, 30, 60, 120].map(m => `<button type="button" class="chip" data-a="addt" data-m="${m}">+${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`).join('')}</div>
    ${prChips(CS.pid, 'data-pr')}
    <h3 style="margin-top:14px">Extra</h3><div class="g2">
      <div class="f"><label>Accessori €</label><input id="cx" type="number" min="0" step="any" inputmode="decimal" ${OF} placeholder="magneti, viti, box" value="${esc(CS.x)}"></div>
      <div class="f"><label>Lavorazione (min)</label><input id="cl" type="number" min="0" step="1" inputmode="numeric" ${OF} placeholder="rifinitura" value="${esc(CS.l)}"></div></div></div>
  <div class="panel"><h3>Dettaglio costi</h3><table class="dt" id="cbreak"></table></div>
  <button class="btn primary" style="width:100%" data-a="saveprint">Salva come stampa</button>`;
}
function rowHtml(r) {
  return `<div class="crow"><input class="inp cname" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Marca / colore" value="${esc(r.name)}" data-fid="${esc(r.fid || '')}"><input class="inp cg" type="number" min="0" step="any" inputmode="decimal" ${OF} placeholder="grammi" value="${esc(r.g)}"><button data-a="delrow" tabindex="-1">✕</button></div>`;
}
function bindRows(root, onChange) {
  $$('.crow', root).forEach(row => {
    const inp = $('.cname', row);
    if (inp.dataset.bound) return; inp.dataset.bound = 1;
    attachAC(inp, filItems, it => { inp.value = it.label; inp.dataset.fid = it.f.id; onChange(); $('.cg', row).focus(); });
    inp.addEventListener('input', () => { inp.dataset.fid = ''; onChange(); });
    inp.addEventListener('change', () => {
      const m = list('filaments').find(f => fname(f).toLowerCase() === inp.value.trim().toLowerCase());
      if (m) inp.dataset.fid = m.id; onChange();
    });
  });
}
const readRows = root => $$('.crow', root).map(r => ({ fid: $('.cname', r).dataset.fid || '', name: $('.cname', r).value.trim(), g: $('.cg', r).value }));
function breakHtml(r) {
  const row = (l, v) => `<tr><td>${l}</td><td>${eur(v)}</td></tr>`, st = S.settings;
  return `<tr><th>Voce</th><th>Costo</th></tr>${row('Filamento', r.mat)}${r.purge > 0 ? row(`Spreco cambio colore (${st.purge}%)`, r.purge) : ''}${row(`Energia (${eur(r.kwhP)}/kWh · ${r.pr.watt} W)`, r.en)}${row('Usura ' + esc(r.pr.nome), r.us)}${row(`Rischio fallimento (${st.fallimento}%)`, r.fail)}${r.lav > 0 ? row('Lavorazione manuale', r.lav) : ''}${r.extra > 0 ? row('Accessori extra', r.extra) : ''}<tr class="tot"><td>Totale</td><td>${eur(r.tot)}</td></tr>${row(`Prezzo consigliato (×${st.ricarico})`, r.price)}`;
}
function bindCalc() {
  const root = $('#view');
  const opts = () => ({ pid: CS.pid, extra: num(CS.x), lav: num(CS.l) });
  const upd = () => {
    CS = { ...CS, rows: readRows($('#crows')), h: $('#ch').value, m: $('#cm').value, x: $('#cx').value, l: $('#cl').value };
    const min = num(CS.h) * 60 + num(CS.m), r = calc(CS.rows.map(x => ({ f: fil(x.fid), g: num(x.g) })), min, opts());
    $('#rtot').textContent = eur(r.tot); $('#rprice').textContent = eur(r.price); $('#rgain').textContent = eur(r.price - r.tot);
    $('#rest').textContent = r.est ? '* include costo stimato (€/kg di riserva) per bobine senza costo' : '';
    $('#purgehint').textContent = r.purge > 0 ? `Più colori: aggiunto ${S.settings.purge}% di spreco per cambi colore e torre di spurgo.` : '';
    $('#cbreak').innerHTML = breakHtml(r);
  };
  bindRows(root, upd); upd();
  root.oninput = e => { if (e.target.matches('#ch,#cm,#cx,#cl,.cg')) upd(); };
  root.onkeydown = e => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (e.target.matches('.cg')) { e.preventDefault(); const rows = $$('.crow'); if (e.target.closest('.crow') === rows[rows.length - 1] && num(e.target.value) > 0) addRow(); else $$('.cname')[rows.indexOf(e.target.closest('.crow')) + 1]?.focus(); }
    else if (e.target.matches('#ch')) { e.preventDefault(); $('#cm').focus(); }
    else if (e.target.matches('#cm')) { e.preventDefault(); $('#cx').focus(); }
    else if (e.target.matches('#cx')) { e.preventDefault(); $('#cl').focus(); }
    else if (e.target.matches('#cl')) { e.preventDefault(); e.target.blur(); }
  };
  function addRow() { $('#crows').insertAdjacentHTML('beforeend', rowHtml({ fid: '', name: '', g: '' })); bindRows(root, upd); $$('.cname').pop().focus(); }
  root.onclick = e => {
    const pc = e.target.closest('[data-pr]'); if (pc) { upd(); CS.pid = pc.dataset.pr; render(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'resetcalc') { CS = freshCS(); render(); return; }
    if (b.dataset.a === 'addt') { const t = num($('#ch').value) * 60 + num($('#cm').value) + +b.dataset.m; $('#ch').value = Math.floor(t / 60) || ''; $('#cm').value = t % 60 || ''; upd(); return; }
    if (b.dataset.a === 'addrow') addRow();
    if (b.dataset.a === 'delrow') { if ($$('.crow').length > 1) b.closest('.crow').remove(); else { $('.cname').value = ''; $('.cname').dataset.fid = ''; $('.cg').value = ''; } upd(); }
    if (b.dataset.a === 'saveprint') {
      upd(); const rows = CS.rows.filter(r => r.name || num(r.g) > 0), min = num(CS.h) * 60 + num(CS.m);
      printSheet({ nome: '', prezzo: calc(CS.rows.map(x => ({ f: fil(x.fid), g: num(x.g) })), min, opts()).price, scorta: 0, minuti: min, pid: CS.pid, extra: num(CS.x), lav: num(CS.l), colori: rows.map(r => ({ fid: r.fid, nome: r.name, g: num(r.g) })), note: '' }, true);
    }
  };
}

/* ---------- schede modifica ---------- */
const hex2hsl = hx => { hx = hx.replace('#', ''); const r = parseInt(hx.slice(0, 2), 16) / 255, g = parseInt(hx.slice(2, 4), 16) / 255, b = parseInt(hx.slice(4, 6), 16) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let H = 0; if (d) { H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H = Math.round(H * 60); if (H < 0) H += 360; } const L = (mx + mn) / 2; return [H, Math.round((d ? d / (1 - Math.abs(2 * L - 1)) : 0) * 100), Math.round(L * 100)]; };
const hsl2hex = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
async function scanBarcode() {
  if (!('BarcodeDetector' in window)) { toast('Scanner non supportato su questo telefono: scrivi il codice a mano'); return null; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('Permesso fotocamera negato'); return null; }
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'scan'; ov.innerHTML = '<video playsinline muted></video><div class="frame"></div><p>Inquadra il codice a barre o QR</p><button class="btn">Chiudi</button>';
    document.body.appendChild(ov); const v = $('video', ov); v.srcObject = stream; v.play();
    const det = new BarcodeDetector(); let on = true;
    const done = c => { on = false; stream.getTracks().forEach(t => t.stop()); ov.remove(); res(c); };
    $('button', ov).onclick = () => done(null);
    (async function loop() { while (on) { try { const r = await det.detect(v); if (r.length) return done(r[0].rawValue); } catch { } await new Promise(r => setTimeout(r, 250)); } })();
  });
}
async function scanAction() {
  const c = await scanBarcode(); if (!c) return;
  const f = list('filaments').find(x => x.barcode === c);
  if (f) { toast('Bobina trovata'); filSheet(f); } else { toast('Codice nuovo: aggiungi la bobina'); filSheet(null, { barcode: c }); }
}
function residSheet(f) {
  openSheet('Peso residuo', `<p class="hint" style="margin:0 0 10px">${esc(fname(f) || f.color)}: grammi rimasti in totale (pesa la bobina e togli il rocchetto vuoto).</p>
    <div class="f"><label>Grammi residui</label><input id="rg" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${Math.round(f.residuo)}"></div>
    <div class="chips wrap">${[0, 100, 250, 500, 750, 1000].map(g => `<button type="button" class="chip" data-g="${g}">${g} g</button>`).join('')}</div>`, {
    init: el => { el.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) { $('#rg', el).value = b.dataset.g; } }); },
    save: el => { f.residuo = Math.max(0, num($('#rg', el).value)); if (tot(f) <= 0) f.riordina = 1; touch('filaments', f); render(); },
  });
}
function filSheet(f, pre) {
  const isNew = !f; f = f || { id: uid(), brand: '', type: '', color: '', hex: '#10b981', url: '', nuove: 1, usate: 0, peso: 1000, residuo: 1000, costo: 0, note: '', riordina: 0, stato: '', barcode: '', ...pre };
  let stato = f.stato || '';
  const hx = esc(f.hex || '#10b981');
  const body = `<div class="g2"><div class="f"><label>Marca</label><input id="fb" type="text" ${OF} value="${esc(f.brand)}" placeholder="es. Sunlu"></div>
    <div class="f"><label>Tipo</label><input id="ft" type="text" ${OF} value="${esc(f.type)}" placeholder="es. PLA Matte"></div></div>
    <div class="f"><label>Colore</label><input id="fc" type="text" ${OF} value="${esc(f.color)}" placeholder="es. Grigio"></div>
    <div class="pick"><div class="sw big" id="fprev" style="background:${hx}"></div><div><div class="name" id="fpn"></div><div class="small">Scegli la tinta</div></div></div>
    <div class="hsl" id="hsl" hidden>
      <div class="hr"><span>Tonalità</span><input type="range" id="hh" min="0" max="360" class="rng hue"></div>
      <div class="hr"><span>Intensità</span><input type="range" id="hs" min="0" max="100" class="rng"></div>
      <div class="hr"><span>Luce</span><input type="range" id="hl" min="0" max="100" class="rng"></div>
      <div class="hr"><span>Codice</span><input class="inp" id="hx" type="text" maxlength="7" ${OF}></div></div>
    <div class="pal" id="pal">${PAL.map(([n, h]) => `<button type="button" class="pc" data-h="${h}" title="${n}" style="background:${h}"></button>`).join('')}<button type="button" class="pc cust" id="pcust" title="Colore personalizzato"></button></div>
    <input id="fh" type="hidden" value="${hx}">
    <div class="f"><label>Stato bobina</label><div class="chips wrap" id="fst" style="padding:2px 0">${[['', 'Non indicato'], ['sigillata', '🔒 Sigillata'], ['aperta', 'Aperta'], ['drybox', '📦 Dry Box'], ['essicca', '💧 Da essiccare']].map(([k, l]) => `<button type="button" class="chip ${stato === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div></div>
    <div class="f"><label>Link prodotto (opzionale)</label><input id="fu" type="text" ${OF} value="${esc(f.url)}" placeholder="https://..."></div>
    <div class="row" style="margin:-4px 0 10px"><button class="btn sm" type="button" id="fsearch">🔍 Cerca sul sito</button><button class="btn sm" type="button" id="fopen">↗ Apri link</button></div>
    <div class="g3"><div class="f"><label>Nuove</label><input id="fn" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${f.nuove}"></div>
    <div class="f"><label>Usate</label><input id="fus" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${f.usate}"></div>
    <div class="f"><label>Peso bobina g</label><input id="fp" type="number" min="1" step="any" inputmode="decimal" ${OF} value="${f.peso}"></div></div>
    <div class="g2"><div class="f"><label>Residuo totale g</label><input id="fr" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${Math.round(f.residuo)}"></div>
    <div class="f"><label>Costo bobina €</label><input id="fk" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${f.costo || ''}"></div></div>
    <label class="row" style="font-size:.86rem;font-weight:600;margin-bottom:4px"><input id="fau" type="checkbox" ${f.auto !== 0 ? 'checked' : ''}> Prezzo e link automatici dal sito (solo Sunlu)</label>
    ${f.pagg ? `<p class="hint" style="margin:0 0 10px">Prezzo letto dal sito il ${new Date(f.pagg).toLocaleDateString('it-IT')}${f.pvar ? ' (variante: ' + esc(f.pvar) + ')' : ''}</p>` : '<div style="height:8px"></div>'}
    <div class="f"><label>Codice a barre / QR</label><div class="row" style="flex-wrap:nowrap"><input id="fbc" class="inp" type="text" ${OF} value="${esc(f.barcode || '')}" placeholder="scansiona o scrivi"><button class="btn sm" type="button" id="fscan">📷</button></div></div>
    <div class="f"><label>Note</label><input id="fno" type="text" ${OF} value="${esc(f.note)}"></div>
    <label class="row" style="font-size:.9rem;font-weight:600"><input id="fri" type="checkbox" ${f.riordina ? 'checked' : ''}> Forza riordino</label>
    <label class="row" style="font-size:.9rem;font-weight:600"><input id="fig" type="checkbox" ${f.ignora ? 'checked' : ''}> Ignora riordino (colore raro)</label>`;
  openSheet(isNew ? 'Nuova bobina' : 'Modifica bobina', body, {
    del: isNew ? null : () => { f.d = 1; touch('filaments', f); render(); toast('Bobina eliminata'); },
    init: el => {
      attachAC($('#fb', el), listItems(() => [...new Set([...list('filaments').map(x => x.brand).filter(Boolean), ...Object.keys(BRANDS).map(b => b.replace(/\b\w/g, c => c.toUpperCase()))])]), it => { $('#fb', el).value = it.label; $('#ft', el).focus(); });
      attachAC($('#ft', el), listItems(() => [...new Set([...list('filaments').map(x => x.type).filter(Boolean), ...TYPES])]), it => { $('#ft', el).value = it.label; $('#fc', el).focus(); });
      const est = () => { if (!$('#fr', el).dataset.m) $('#fr', el).value = Math.round(num($('#fn', el).value) * num($('#fp', el).value) + num($('#fus', el).value) * num($('#fp', el).value) / 2); };
      ['#fn', '#fus', '#fp'].forEach(q => $(q, el).addEventListener('input', est));
      $('#fr', el).addEventListener('input', () => $('#fr', el).dataset.m = 1);
      $('#fk', el).addEventListener('input', () => $('#fau', el).checked = false);
      const grad = (h, s2, l) => { $('#hs', el).style.background = `linear-gradient(90deg,${hsl2hex(h, 0, l)},${hsl2hex(h, 100, l)})`; $('#hl', el).style.background = `linear-gradient(90deg,#000,${hsl2hex(h, s2, 50)},#fff)`; };
      const setHex = (h, fromPal, keepSliders) => {
        $('#fh', el).value = h; $('#fprev', el).style.background = h;
        const m = PAL.find(p => p[1].toLowerCase() === h.toLowerCase());
        $$('.pc[data-h]', el).forEach(b => b.classList.toggle('on', !!m && b.dataset.h.toLowerCase() === h.toLowerCase()));
        $('#pcust', el).classList.toggle('on', !m);
        $('#fpn', el).textContent = m ? m[0] : 'Personalizzato';
        if (!keepSliders) { const [H, S2, L] = hex2hsl(h); $('#hh', el).value = H; $('#hs', el).value = S2; $('#hl', el).value = L; $('#hx', el).value = h; grad(H, S2, L); }
        if (fromPal && m && !$('#fc', el).value.trim()) $('#fc', el).value = m[0];
      };
      setHex($('#fh', el).value);
      $('#pal', el).addEventListener('click', e => { const b = e.target.closest('.pc[data-h]'); if (b) { setHex(b.dataset.h, true); $('#hsl', el).hidden = true; } });
      $('#pcust', el).onclick = () => { $('#hsl', el).hidden = !$('#hsl', el).hidden; };
      const fromSl = () => { const h = hsl2hex(+$('#hh', el).value, +$('#hs', el).value, +$('#hl', el).value); $('#hx', el).value = h; grad(+$('#hh', el).value, +$('#hs', el).value, +$('#hl', el).value); setHex(h, false, true); };
      ['#hh', '#hs', '#hl'].forEach(q => $(q, el).addEventListener('input', fromSl));
      $('#hx', el).addEventListener('input', e => { let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) setHex(v.toLowerCase()); });
      $('#fc', el).addEventListener('input', e => { const m = PAL.find(p => p[0].toLowerCase() === e.target.value.trim().toLowerCase()); if (m) setHex(m[1]); });
      $('#fst', el).addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (!b) return; stato = b.dataset.st; $$('#fst .chip', el).forEach(x => x.classList.toggle('on', x === b)); });
      $('#fscan', el).onclick = async () => { const c = await scanBarcode(); if (c) $('#fbc', el).value = c; };
      const tmp = () => ({ brand: $('#fb', el).value.trim(), type: $('#ft', el).value.trim(), color: $('#fc', el).value.trim(), url: $('#fu', el).value.trim() });
      $('#fsearch', el).onclick = () => openUrl(productLink({ ...tmp(), url: '' }));
      $('#fopen', el).onclick = () => openUrl(productLink(tmp()));
    },
    save: el => {
      const color = $('#fc', el).value.trim(); if (!color) { $('#fc', el).focus(); toast('Inserisci il colore'); return false; }
      const nu = $('#fu', el).value.trim(); if (nu !== f.url) f.urlAuto = 0;
      Object.assign(f, {
        brand: $('#fb', el).value.trim(), type: $('#ft', el).value.trim(), color, hex: $('#fh', el).value, url: nu,
        nuove: Math.max(0, Math.round(num($('#fn', el).value))), usate: Math.max(0, Math.round(num($('#fus', el).value))),
        peso: num($('#fp', el).value) || 1000, residuo: Math.max(0, num($('#fr', el).value)), costo: num($('#fk', el).value),
        note: $('#fno', el).value.trim(), riordina: $('#fri', el).checked ? 1 : 0, ignora: $('#fig', el).checked ? 1 : 0, stato, barcode: $('#fbc', el).value.trim(), auto: $('#fau', el).checked ? 1 : 0,
      });
      if (isNew) S.filaments.push(f); touch('filaments', f); render();
      if (isSunlu(f) && f.auto !== 0 && !f.url) refreshPrices(true);
    },
  });
}

function compress(file, max = 320) {
  return new Promise(res => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', .72));
    };
    img.onerror = () => res(null); img.src = u;
  });
}
function printSheet(p, isNew) {
  isNew = isNew || !p; p = p || { id: uid(), nome: '', prezzo: 0, scorta: 0, minuti: 0, colori: [], note: '', foto: 0, fu: 0 };
  if (!p.id) p = { ...p, id: uid() };
  let photo = (PHOTOS[p.id] && PHOTOS[p.id].data) || null, photoChanged = false, pid = p.pid || '';
  const rows = (p.colori && p.colori.length ? p.colori : [{ fid: '', nome: '', g: '' }]).map(c => ({ fid: c.fid, name: c.nome, g: c.g || '' }));
  const body = `<div id="pph"></div>
    <div class="f"><label>Nome oggetto</label><input id="pn" type="text" ${OF} value="${esc(p.nome)}" placeholder="es. Snoopy"></div>
    <div class="g2"><div class="f"><label>Prezzo vendita €</label><input id="pp" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${p.prezzo || ''}"></div>
    <div class="f"><label>Pezzi in magazzino</label><input id="ps" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${p.scorta || 0}"></div></div>
    <div class="g2"><div class="f"><label>Ore stampa</label><input id="ph" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${Math.floor((p.minuti || 0) / 60) || ''}"></div>
    <div class="f"><label>Minuti</label><input id="pm" type="number" min="0" max="59" step="1" inputmode="numeric" ${OF} value="${(p.minuti || 0) % 60 || ''}"></div></div>
    <div id="ppr">${prChips(pid, 'data-pp')}</div>
    <div class="lab" style="margin:8px 0 4px">Colori usati (dal magazzino) e grammi</div><div id="crows">${rows.map(rowHtml).join('')}</div>
    <button class="btn sm" type="button" id="padd" style="margin-bottom:10px">+ Colore</button>
    <div class="g2"><div class="f"><label>Accessori extra €</label><input id="pex" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${p.extra || ''}"></div>
    <div class="f"><label>Lavorazione (min)</label><input id="plv" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${p.lav || ''}"></div></div>
    <div class="f"><label>File 3D / profilo (link 3MF, G-code, MakerWorld)</label><div class="row" style="flex-wrap:nowrap"><input id="pfl" class="inp" type="text" ${OF} value="${esc(p.file || '')}" placeholder="https://... oppure nota"><button class="btn sm" type="button" id="pfo">↗</button></div></div>
    <div class="f"><label>Foto</label><input id="pf" type="file" accept="image/*"></div>
    <div class="f"><label>Note</label><input id="pno" type="text" ${OF} value="${esc(p.note)}"></div>
    <table class="dt" id="pbreak"></table><p class="hint" id="pgain"></p>`;
  openSheet(isNew ? 'Nuova stampa' : 'Modifica stampa', body, {
    del: isNew ? null : () => { p.d = 1; touch('prints', p); delete PHOTOS[p.id]; jset(PH, PHOTOS); render(); toast('Stampa eliminata'); },
    init: el => {
      const showPh = () => { $('#pph', el).innerHTML = photo ? `<img class="photo" src="${photo}" alt=""><button class="btn sm danger" type="button" id="prm" style="margin-bottom:8px">Rimuovi foto</button>` : ''; const r = $('#prm', el); if (r) r.onclick = () => { photo = null; photoChanged = true; showPh(); }; };
      showPh();
      const upd = () => {
        const m = num($('#ph', el).value) * 60 + num($('#pm', el).value), r = readRows($('#crows', el));
        const c = calc(r.map(x => ({ f: fil(x.fid), g: num(x.g) })), m, { pid, extra: num($('#pex', el).value), lav: num($('#plv', el).value) });
        $('#pbreak', el).innerHTML = breakHtml(c);
        const gain = num($('#pp', el).value) - c.tot;
        $('#pgain', el).innerHTML = `Margine sul prezzo inserito: <b class="${gain >= 0 ? 'pos' : 'neg'}">${eur(gain)}</b>${c.est ? ' (costo filamento stimato)' : ''}`;
      };
      bindRows(el, upd); upd();
      el.addEventListener('input', e => { if (e.target.matches('#ph,#pm,#pp,#pex,#plv,.cg')) upd(); });
      $('#padd', el).onclick = () => { $('#crows', el).insertAdjacentHTML('beforeend', rowHtml({ fid: '', name: '', g: '' })); bindRows(el, upd); $$('.cname', el).pop().focus(); };
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-a=delrow]'); if (b) { if ($$('.crow', el).length > 1) b.closest('.crow').remove(); else { $('.cname', el).value = ''; $('.cname', el).dataset.fid = ''; $('.cg', el).value = ''; } upd(); }
        const pc = e.target.closest('[data-pp]'); if (pc) { pid = pc.dataset.pp; $('#ppr', el).innerHTML = prChips(pid, 'data-pp'); upd(); }
      });
      $('#pfo', el).onclick = () => { const v = $('#pfl', el).value.trim(); if (/^https?:\/\//i.test(v)) openUrl(v); else toast('Inserisci un link che inizia con https://'); };
      $('#pf', el).onchange = async e => { const f = e.target.files[0]; if (f) { photo = await compress(f); photoChanged = true; showPh(); } };
    },
    save: el => {
      const nome = $('#pn', el).value.trim(); if (!nome) { $('#pn', el).focus(); toast('Inserisci il nome'); return false; }
      Object.assign(p, {
        nome, prezzo: num($('#pp', el).value), scorta: Math.max(0, Math.round(num($('#ps', el).value))),
        minuti: Math.round(num($('#ph', el).value) * 60 + num($('#pm', el).value)), note: $('#pno', el).value.trim(), pid,
        extra: num($('#pex', el).value), lav: num($('#plv', el).value), file: $('#pfl', el).value.trim(),
        colori: readRows($('#crows', el)).filter(r => r.name || num(r.g) > 0).map(r => ({ fid: r.fid, nome: r.name || (fil(r.fid) ? fname(fil(r.fid)) : ''), g: num(r.g) })),
      });
      if (photoChanged) {
        p.fu = Date.now(); p.foto = photo ? 1 : 0;
        if (photo) { PHOTOS[p.id] = { fu: p.fu, data: photo }; S.meta.photoDirty[p.id] = 1; } else { delete PHOTOS[p.id]; S.meta.photoDirty[p.id] = -1; }
        jset(PH, PHOTOS);
      }
      if (!S.prints.includes(p)) S.prints.push(p);
      touch('prints', p); render();
    },
  });
}

/* ---------- impostazioni ---------- */
const RULES = '{\n  "rules": {\n    ".read": false,\n    ".write": false,\n    "archivi": {\n      "$code": { ".read": true, ".write": true }\n    }\n  }\n}';
const SB_SQL = `create table if not exists spoolio (
  code text not null, coll text not null, id text not null,
  data jsonb, u bigint default 0, primary key (code, coll, id));
alter table spoolio enable row level security;
create policy "per codice" on spoolio for all
  using (code = (current_setting('request.headers', true)::json->>'x-code'))
  with check (code = (current_setting('request.headers', true)::json->>'x-code'));`;
const cfg = () => ({ url: '', code: '', ...jget(CFG, {}) });
const setCfg = c => jset(CFG, c);
function viewSet() {
  const s = S.settings, c = cfg(), kwhP = s.kwh > 0 ? s.bolletta / s.kwh : 0;
  const srow = (k, l, sub, step = 'any') => `<div class="srow"><label for="s_${k}">${l}<small>${sub}</small></label><input class="inp" id="s_${k}" data-k="${k}" type="number" min="0" step="${step}" inputmode="decimal" ${OF} value="${s[k] ?? ''}"></div>`;
  const prow = p => `<div class="prow" data-id="${p.id}"><input class="inp pn" type="text" ${OF} value="${esc(p.nome)}" placeholder="Nome"><input class="inp pw" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${p.watt}" placeholder="W"><input class="inp pu" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${p.usuraOra}" placeholder="€/h"><button data-a="delpr" data-id="${p.id}" tabindex="-1">✕</button></div>`;
  return `<div class="panel"><h3>Stampanti</h3>
    <div class="prow ph"><span>Nome</span><span>Watt</span><span>Usura €/h</span><span></span></div>
    <div id="prl">${s.printers.map(prow).join('')}</div>
    <button class="btn sm" data-a="addpr">+ Stampante</button>
    <p class="hint">Watt = potenza media in stampa (Bambu P2S circa 120-180 W). Usura €/h = prezzo macchina / ore di vita. Con più stampanti scegli quale usare nel calcolo.</p></div>
  <div class="panel"><h3>Costi di stampa</h3>
    ${srow('kwh', 'kWh consumati nel mese', 'dalla bolletta')}${srow('bolletta', 'Costo bolletta €', 'stesso periodo')}
    <p class="hint" id="kwhinfo" style="margin:-2px 0 10px">= ${eur(kwhP)} per kWh</p>
    ${srow('fallimento', 'Fallimento stampe %', 'aggiunto al costo')}${srow('purge', 'Spreco cambio colore %', 'solo con più colori (spurgo)')}
    ${srow('manoOra', 'Manodopera €/ora', 'per la lavorazione manuale')}${srow('ricarico', 'Ricarico prezzo consigliato ×', 'costo × ricarico')}
    ${srow('costoKg', 'Costo di riserva €/kg', 'se la bobina non ha un costo')}${srow('soglia', 'Soglia scorta bassa (g)', 'sotto = badge "Basso"')}
    ${srow('sogliaNuove', 'Riordina se bobine nuove sotto', '0 = disattivo (es. 1)')}${srow('sogliaMin', 'Minimo bobine per ordine', '0 = automatico dal sito (es. "Min. 6")')}${srow('sogliaGr', 'Riordina se grammi totali sotto', '0 = disattivo (es. 500)')}</div>
  <div class="panel"><h3>Cloud condiviso</h3>
    <p class="hint" style="margin:0 0 10px">Stesso archivio su tutti i dispositivi. Senza cloud l'app funziona solo in locale.</p>
    <div class="f"><label>URL database (Supabase o Firebase)</label><input class="inp" id="c_url" type="text" ${OF} placeholder="https://xxxx.supabase.co" value="${esc(c.url)}"></div>
    <div class="f"><label>Chiave anon (solo Supabase)</label><input class="inp" id="c_key" type="text" ${OF} value="${esc(c.key || '')}"></div>
    <div class="f"><label>Codice archivio (segreto)</label><input class="inp" id="c_code" type="text" ${OF} value="${esc(c.code)}"></div>
    <div class="row"><button class="btn primary sm" data-a="syncnow">Sincronizza ora</button><button class="btn sm" data-a="newcode">Nuovo codice</button><button class="btn sm" data-a="sharelink">Condividi collegamento</button></div>
    <div class="f" style="margin-top:10px"><label>Incolla collegamento ricevuto</label><input class="inp" id="c_paste" type="text" ${OF} placeholder="spoolio:..."></div>
    <details><summary>Come attivarlo (2 minuti)</summary><ol>
      <li><b>Supabase (consigliato):</b> supabase.com, New project. SQL Editor, incolla lo script sotto, Run. Settings, API: copia Project URL e anon key.</li>
      <li><b>Firebase:</b> console.firebase.google.com, crea un progetto (senza Analytics).</li>
      <li>Build, Realtime Database, Crea database (qualsiasi regione).</li>
      <li>Scheda Regole: incolla le regole qui sotto e Pubblica.</li>
      <li>Copia l'URL del database in cima alla scheda Dati e incollalo sopra.</li>
      <li>Premi "Condividi collegamento" e incollalo sugli altri dispositivi.</li></ol>
      <pre class="code" id="rules">${esc(RULES)}</pre><button class="btn sm" data-a="copyrules">Copia regole Firebase</button>
      <pre class="code">${esc(SB_SQL)}</pre><button class="btn sm" data-a="copysql">Copia script Supabase</button></details></div>
  <div class="panel"><h3>Dati</h3><div class="row"><button class="btn sm" data-a="csvf">CSV bobine</button><button class="btn sm" data-a="csvp">CSV stampe</button><button class="btn sm" data-a="export">Backup completo</button><button class="btn sm" data-a="import">Ripristina backup</button></div>
    <div class="row" style="margin-top:8px"><button class="btn sm danger" data-a="wipe">Svuota archivio locale</button></div>
    <input type="file" id="impf" accept=".json,application/json" hidden><p class="hint">Spoolio · v2.2</p></div>`;
}
function savePrinters() {
  S.settings.printers = $$('#prl .prow').map(r => ({ id: r.dataset.id, nome: $('.pn', r).value.trim() || 'Stampante', watt: num($('.pw', r).value), usuraOra: num($('.pu', r).value) }));
  touch('settings', S.settings);
}
function bindSet() {
  const root = $('#view');
  root.onchange = e => {
    const k = e.target.dataset.k;
    if (k) { S.settings[k] = num(e.target.value); touch('settings', S.settings); }
    if (e.target.closest('#prl')) savePrinters();
    if (e.target.id === 'c_url' || e.target.id === 'c_code' || e.target.id === 'c_key') {
      setCfg({ key: $('#c_key').value.trim(), url: $('#c_url').value.trim().replace(/\.json$/, '').replace(/\/+$/, '').replace(/\/rest\/v1.*$/, ''), code: $('#c_code').value.trim().replace(/[^A-Za-z0-9_-]/g, '') });
      $('#c_code').value = cfg().code; $('#c_url').value = cfg().url; S.meta.pushedAll = 0; save(); setDot(); if (cfgOK()) syncNow(true);
    }
    if (e.target.id === 'c_paste') { parseLink(e.target.value); e.target.value = ''; }
    if (e.target.id === 'impf') importFile(e.target.files[0]);
  };
  root.oninput = e => {
    if (!e.target.dataset.k) return;
    const s = { ...S.settings, [e.target.dataset.k]: num(e.target.value) };
    $('#kwhinfo').textContent = '= ' + eur(s.kwh > 0 ? s.bolletta / s.kwh : 0) + ' per kWh';
  };
  root.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('input') && e.target.id !== 'impf') { e.preventDefault(); const i = $$('input.inp', root), n = i[i.indexOf(e.target) + 1]; e.target.blur(); if (n) n.focus(); } };
}
function parseLink(v) {
  try {
    const o = JSON.parse(atob(v.trim().replace(/^spoolio:/, '')));
    if (!o.u || !o.c) throw 0;
    setCfg({ url: o.u, code: o.c, key: o.k || '' }); S.meta.pushedAll = 0; save(); render(); toast('Collegato al cloud'); syncNow(true);
  } catch { toast('Collegamento non valido'); }
}
const randCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
async function share(text, title) {
  try { if (navigator.share) { await navigator.share({ title, text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copiato negli appunti'); } catch { prompt(title, text); }
}
async function shareFile(file, title) {
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast('File scaricato');
}
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
const fmtN = n => String(Math.round(n * 100) / 100).replace('.', ',');
function exportCsv(kind) {
  const rows = kind === 'f'
    ? [['Marca', 'Tipo', 'Colore', 'Nuove', 'Usate', 'Residuo g', 'Costo bobina', 'Stato', 'Codice', 'Link'], ...list('filaments').map(f => [f.brand, f.type, f.color, f.nuove, f.usate, Math.round(f.residuo), fmtN(f.costo || 0), STATI[f.stato] || f.stato || '', f.barcode || '', f.url || ''])]
    : [['Oggetto', 'Prezzo', 'Pezzi', 'Minuti', 'Grammi', 'Costo', 'Margine', 'Colori', 'File 3D'], ...list('prints').map(p => { const c = printCalc(p), has = printGrams(p) > 0 || p.minuti > 0; return [p.nome, fmtN(p.prezzo || 0), p.scorta || 0, p.minuti || 0, Math.round(printGrams(p)), has ? fmtN(c.tot) : '', has ? fmtN(p.prezzo - c.tot) : '', (p.colori || []).map(x => x.nome).join(', '), p.file || '']; })];
  shareFile(new File([toCsv(rows)], kind === 'f' ? 'spoolio-bobine.csv' : 'spoolio-stampe.csv', { type: 'text/csv' }), 'Export Spoolio');
}
async function exportData() {
  const data = JSON.stringify({ v: 1, filaments: list('filaments'), prints: list('prints'), settings: S.settings, photos: PHOTOS }, null, 1);
  const file = new File([data], 'spoolio-backup.json', { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup Spoolio' }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast('Backup scaricato');
}
async function importFile(f) {
  if (!f) return;
  try {
    const o = JSON.parse(await f.text()); let n = 0;
    for (const c of ['filaments', 'prints']) for (const r of o[c] || []) { const i = S[c].findIndex(x => x.id === r.id); if (i >= 0) S[c][i] = r; else S[c].push(r); touch(c, r); n++; }
    if (o.photos) { PHOTOS = { ...PHOTOS, ...o.photos }; jset(PH, PHOTOS); }
    if (o.settings) { S.settings = { ...S.settings, ...o.settings }; touch('settings', S.settings); }
    render(); toast(n + ' elementi importati');
  } catch { toast('File non valido'); }
}

/* ---------- sync Firebase RTDB ---------- */
const SY = { busy: false, t: null, state: 'off', msg: '' };
const isSb = () => /supabase\.co/.test(cfg().url) || !!cfg().key;
const cfgOK = () => { const c = cfg(); return c.url && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1))/.test(c.url) && c.code && (!isSb() || c.key); };
const base = () => cfg().url + '/archivi/' + cfg().code;
async function fb(path, opt = {}) {
  const r = await fetch(base() + path + '.json', { ...opt, headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function sb(q, opt = {}) {
  const c = cfg(), r = await fetch(c.url + '/rest/v1/spoolio' + q, { ...opt, headers: { apikey: c.key, ...(c.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + c.key } : {}), 'x-code': c.code, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const sbq = c => `?code=eq.${encodeURIComponent(cfg().code)}&coll=eq.${c}`;
// interfaccia unica: Firebase RTDB oppure Supabase
async function bGet(c) {
  if (!isSb()) return (await fb('/' + c)) || {};
  const o = {}; for (const r of (await sb(sbq(c) + '&select=id,data')) || []) o[r.id] = r.data; return o;
}
async function bPush(upd) { // upd: {'coll/id': rec}
  if (!isSb()) return fb('', { method: 'PATCH', body: JSON.stringify(upd) });
  const code = cfg().code, rows = Object.entries(upd).map(([k, d]) => { const [coll, id] = k.split('/'); return { code, coll, id, data: d, u: d.u || 0 }; });
  return sb('?on_conflict=code,coll,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
}
async function bPhotoGet(id) { if (!isSb()) return fb('/photos/' + id); const r = await sb(sbq('photos') + '&id=eq.' + id + '&select=data'); return r && r[0] ? r[0].data : null; }
async function bPhotoPut(id, d) { return isSb() ? bPush({ ['photos/' + id]: { d, u: Date.now() } }) : fb('/photos/' + id, { method: 'PUT', body: JSON.stringify(d) }); }
async function bPhotoDel(id) { return isSb() ? sb(sbq('photos') + '&id=eq.' + id, { method: 'DELETE' }) : fb('/photos/' + id, { method: 'DELETE' }); }
function setDot() {
  const b = $('#syncbtn'); if (!b) return;
  const st = !cfgOK() ? 'off' : SY.state;
  b.className = 'sync ' + st; $('span', b).textContent = { off: 'Locale', ok: 'Sincronizzato', busy: 'Sync…', err: 'Errore sync' }[st];
}
function schedSync() { if (!cfgOK()) return; clearTimeout(SY.t); SY.t = setTimeout(() => syncNow(), 1500); }
async function syncNow(manual) {
  if (!cfgOK()) { if (manual) toast('Configura il cloud in Impostazioni'); return; }
  if (SY.busy) return; SY.busy = true; SY.state = 'busy'; setDot();
  try {
    const remote = {};
    for (const c of ['filaments', 'prints', 'settings']) remote[c] = await bGet(c);
    if (!S.meta.pushedAll && !Object.keys(remote.filaments).length && !Object.keys(remote.prints).length && !Object.keys(remote.settings).length) {
      S.filaments.forEach(r => S.meta.dirty['filaments:' + r.id] = 1); S.prints.forEach(r => S.meta.dirty['prints:' + r.id] = 1); S.meta.dirty['settings:main'] = 1;
    }
    S.meta.pushedAll = 1;
    let changed = false;
    for (const c of ['filaments', 'prints']) for (const id in remote[c]) {
      const r = remote[c][id]; if (!r || !r.id) continue; r.colori = r.colori || [];
      const i = S[c].findIndex(x => x.id === id);
      if (i < 0) { S[c].push(r); changed = true; } else if ((r.u || 0) > (S[c][i].u || 0)) { S[c][i] = r; delete S.meta.dirty[c + ':' + id]; changed = true; }
    }
    const rs = remote.settings.main;
    if (rs && (rs.u || 0) > (S.settings.u || 0)) { S.settings = { ...DEF_SETTINGS, ...rs }; ensurePrinters(); delete S.meta.dirty['settings:main']; changed = true; }
    // foto mancanti o aggiornate
    for (const p of S.prints) if (!p.d && p.foto && (!PHOTOS[p.id] || PHOTOS[p.id].fu < p.fu)) {
      try { let d = await bPhotoGet(p.id); if (d && d.d) d = d.d; if (d) { PHOTOS[p.id] = { fu: p.fu, data: d }; changed = true; } } catch { }
    }
    jset(PH, PHOTOS);
    // push
    const upd = {}, keys = Object.keys(S.meta.dirty);
    for (const k of keys) {
      const [c, id] = k.split(':'), rec = c === 'settings' ? S.settings : S[c].find(x => x.id === id);
      if (rec) upd[c === 'settings' ? 'settings/main' : c + '/' + id] = rec;
    }
    if (Object.keys(upd).length) await bPush(upd);
    for (const id in S.meta.photoDirty) {
      if (S.meta.photoDirty[id] === 1 && PHOTOS[id]) await bPhotoPut(id, PHOTOS[id].data);
      else await bPhotoDel(id);
    }
    S.meta.dirty = {}; S.meta.photoDirty = {}; save();
    SY.state = 'ok'; SY.msg = '';
    if (changed && !sheet) render();
    if (manual) toast('Sincronizzato');
  } catch (e) {
    SY.state = 'err'; SY.msg = String(e.message || e);
    if (manual) toast('Errore sync: ' + SY.msg);
  }
  SY.busy = false; setDot();
}
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

/* ---------- eventi globali ---------- */
function stepFil(id, k, d) { const f = fil(id); f[k] = Math.max(0, (f[k] || 0) + d); if (k === 'nuove') f.residuo = Math.max(0, f.residuo + d * f.peso); touch('filaments', f); render(); }
function stepPrint(id, d) {
  const p = list('prints').find(x => x.id === id), prev = []; let used = 0;
  if (d > 0) for (const c of p.colori || []) { const f = fil(c.fid); if (f && num(c.g) > 0) { prev.push(JSON.stringify(f)); used += num(c.g); consume(f, num(c.g)); touch('filaments', f); } }
  const was = p.scorta || 0; p.scorta = Math.max(0, was + d); touch('prints', p); render();
  toast(d > 0 ? (used ? `+1 ${p.nome} · scalati ${Math.round(used)} g` : `+1 ${p.nome}`) : `−1 ${p.nome}`, () => {
    p.scorta = was; touch('prints', p);
    prev.forEach(j => { const o = JSON.parse(j), f = fil(o.id); Object.assign(f, o); touch('filaments', f); }); render();
  });
}
document.addEventListener('click', e => {
  const tab = e.target.closest('#tabs [data-tab]'); if (tab) { V.tab = tab.dataset.tab; render(); scrollTo(0, 0); return; }
  const a = e.target.closest('[data-a]');
  if (a && !a.closest('.sheet') && !(a.closest('#view') && V.tab === 'calc')) {
    const id = a.dataset.id, act = a.dataset.a;
    if (act === 'link') { e.stopPropagation(); openUrl(productLink(fil(id))); return; }
    if (act === 'brand') { e.stopPropagation(); openUrl(brandLink(fil(id))); return; }
    if (act === 'edit') { e.stopPropagation(); filSheet(fil(id)); return; }
    if (act === 'resid') { e.stopPropagation(); residSheet(fil(id)); return; }
    if (act === 'pfile') { e.stopPropagation(); const p = list('prints').find(x => x.id === id); if (p && /^https?:\/\//i.test(p.file)) openUrl(p.file); else toast(p ? p.file : ''); return; }
    if (act === 'scan') { scanAction(); return; }
    if (act === 'prices') { refreshPrices(true); return; }
    if (act === 'csvf') { exportCsv('f'); return; }
    if (act === 'csvp') { exportCsv('p'); return; }
    if (act === 'addpr') { S.settings.printers.push({ id: uid(), nome: 'Nuova stampante', watt: 100, usuraOra: 0.2 }); touch('settings', S.settings); render(); return; }
    if (act === 'delpr') { if (S.settings.printers.length > 1) { S.settings.printers = S.settings.printers.filter(p => p.id !== id); touch('settings', S.settings); render(); } else toast('Serve almeno una stampante'); return; }
    if (act === 'n') { e.stopPropagation(); stepFil(id, a.dataset.k, +a.dataset.d); return; }
    if (act === 'pn') { e.stopPropagation(); stepPrint(id, +a.dataset.d); return; }
    if (act === 'flt') { V.flt = (a.dataset.t && V.flt === a.dataset.k) ? 'all' : a.dataset.k; render(); return; }
    if (act === 'add') { V.tab === 'print' ? printSheet() : filSheet(); return; }
    if (act === 'sync') { if (!cfgOK()) { V.tab = 'set'; render(); } else syncNow(true); return; }
    if (act === 'syncnow') { syncNow(true); return; }
    if (act === 'newcode') { $('#c_code').value = randCode(); $('#c_code').dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (act === 'sharelink') { const c = cfg(); if (!cfgOK()) { toast('Prima inserisci URL e codice'); return; } share('spoolio:' + btoa(JSON.stringify({ u: c.url, c: c.code, k: c.key || '' })), 'Collegamento Spoolio'); return; }
    if (act === 'copysql') { share(SB_SQL, 'Script Supabase'); return; }
    if (act === 'copyrules') { share(RULES, 'Regole Firebase'); return; }
    if (act === 'cart') { cartSheet(); return; }
    if (act === 'copyreorder') { share('Da riordinare:\n' + list('filaments').filter(needRe).map(f => '- ' + fname(f)).join('\n'), 'Lista riordino'); return; }
    if (act === 'export') { exportData(); return; }
    if (act === 'import') { $('#impf').click(); return; }
    if (act === 'wipe') {
      if (!a.dataset.sure) { a.dataset.sure = 1; a.textContent = 'Sicuro? Tocca ancora'; setTimeout(() => { a.dataset.sure = ''; a.textContent = 'Svuota archivio locale'; }, 3000); return; }
      S.filaments = []; S.prints = []; S.meta.dirty = {}; PHOTOS = {}; jset(PH, PHOTOS); save(); toast('Archivio locale svuotato'); render(); return;
    }
  }
  const card = e.target.closest('.card[data-id]');
  if (card && !e.target.closest('a,button')) { card.dataset.c === 'f' ? filSheet(fil(card.dataset.id)) : printSheet(list('prints').find(p => p.id === card.dataset.id)); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { V.q = e.target.value; const p = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(p, p); }
  if (e.target.id === 'pq') { V.pq = e.target.value; const p = e.target.selectionStart; render(); const q = $('#pq'); q.focus(); q.setSelectionRange(p, p); }
});
render();
if (cfgOK()) syncNow();
setTimeout(() => refreshPrices(), 2500);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => refreshPrices(), 1500); });

/* tastiera: il campo attivo resta visibile */
document.addEventListener('focusin', e => {
  if (!e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea')) return;
  document.body.classList.add('kb');
  setTimeout(() => { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { } }, 320);
});
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input,textarea')) document.body.classList.remove('kb'); }, 250));

const H0 = Math.max(innerHeight, screen.height * 0.5);
const kbCheck = () => document.body.classList.toggle('kbopen', Math.min(innerHeight, (window.visualViewport || { height: 1e9 }).height) < H0 * 0.78);
addEventListener('resize', kbCheck); if (window.visualViewport) visualViewport.addEventListener('resize', kbCheck);
