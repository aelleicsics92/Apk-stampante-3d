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
const TYPES = ['PLA', 'PLA+', 'PLA Matte', 'PLA Silk', 'PLA Basic', 'PLA Marble', 'PLA Galaxy', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC'];

/* ---------- stato ---------- */
let S = jget(KEY, null);
if (!S || !S.filaments) S = seedState();
S.settings = { ...DEF_SETTINGS, ...S.settings };
S.meta = { dirty: {}, photoDirty: {}, pushedAll: 0, ...S.meta };
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
const gcost = f => (f.costo > 0 ? f.costo / (f.peso || 1000) : S.settings.costoKg / 1000);
const gSearch = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
const site = b => BRANDS[(b || '').toLowerCase().trim()];
function productLink(f) {
  if (f.url) return f.url;
  const s = site(f.brand);
  return s ? gSearch(`site:${s} ${f.type || ''} ${f.color}`.replace(/\s+/g, ' ')) : gSearch(`${fname(f)} filamento 3D`);
}
const brandLink = f => site(f.brand) ? 'https://' + site(f.brand) : gSearch(f.brand + ' filamento 3D');
function openUrl(u) {
  try {
    const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (B && B.open) { B.open({ url: u }); return; }
  } catch (e) { }
  window.open(u, '_blank');
}
function calc(items, min) {
  const st = S.settings; let mat = 0, est = false;
  for (const it of items) {
    if (!(it.g > 0)) continue;
    if (it.f) { mat += it.g * gcost(it.f); if (!(it.f.costo > 0)) est = true; }
    else { const k = it.costKg > 0 ? it.costKg : st.costoKg; mat += it.g * k / 1000; if (!(it.costKg > 0)) est = true; }
  }
  const h = (min || 0) / 60, kwhP = st.kwh > 0 ? st.bolletta / st.kwh : 0;
  const en = h * kwhP * st.watt / 1000, us = h * st.usuraOra;
  const base = mat + en + us, fail = base * st.fallimento / 100, t = base + fail;
  return { mat, en, us, fail, tot: t, price: roundHalf(t * st.ricarico), est, kwhP };
}
const printItems = p => (p.colori || []).map(c => ({ f: fil(c.fid), g: num(c.g) }));
const printGrams = p => (p.colori || []).reduce((a, c) => a + num(c.g), 0);
const printCalc = p => calc(printItems(p), p.minuti);
const hexOf = c => (c.fid && fil(c.fid) ? fil(c.fid).hex : '');

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
  const first = $('input:not([type=color]):not([type=file])', el); if (first) first.focus();
}
function removeSheet() { if (sheet) { sheet.el.remove(); sheet = null; } clearAC(); }
function closeSheet() { removeSheet(); if (history.state && history.state.sheet) { skipPop = true; history.back(); } }
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

function viewMag() {
  const all = list('filaments');
  const out = f => tot(f) <= 0, low = f => !out(f) && f.residuo < S.settings.soglia;
  const nOut = all.filter(f => out(f) || f.riordina).length;
  const q = V.q.toLowerCase();
  let rows = all.filter(f => (!q || (fname(f) + ' ' + f.note).toLowerCase().includes(q)) && ({
    all: () => true, stock: () => !out(f), low: () => low(f), out: () => out(f) || f.riordina,
  })[V.flt]());
  rows.sort((a, b) => (out(a) - out(b)) || fname(a).localeCompare(fname(b)));
  const nm = all.filter(f => !f.brand).length;
  return `<div class="stats">
    <div class="stat"><b>${all.filter(f => !out(f)).length}</b><span>Tipi</span></div>
    <div class="stat"><b>${all.reduce((a, f) => a + (f.nuove || 0), 0)}</b><span>Nuove</span></div>
    <div class="stat"><b>${all.reduce((a, f) => a + (f.usate || 0), 0)}</b><span>Usate</span></div>
    <div class="stat ${nOut ? 'warn' : ''}"><b>${nOut}</b><span>Riordina</span></div></div>
  <input class="search" id="q" type="text" ${OF} placeholder="Cerca marca, tipo o colore" value="${esc(V.q)}">
  <div class="chips">${[['all', 'Tutti'], ['stock', 'In scorta'], ['low', 'Bassi'], ['out', 'Da riordinare']].map(([k, l]) => `<button class="chip ${V.flt === k ? 'on' : ''}" data-a="flt" data-k="${k}">${l}</button>`).join('')}
    ${V.flt === 'out' && rows.length ? '<button class="chip" data-a="copyreorder">Copia lista</button>' : ''}</div>
  ${nm ? `<p class="hint" style="margin:0 0 10px">${nm} bobine senza marca: tocca "marca?" per aggiungerla e avere i link ai siti.</p>` : ''}
  <div class="list">${rows.map(filCard).join('') || '<div class="empty">Nessuna bobina. Tocca + per aggiungerne una.</div>'}</div>`;
}
function filCard(f) {
  const t = tot(f), isOut = t <= 0, isLow = !isOut && f.residuo < S.settings.soglia;
  const pct = t > 0 ? Math.min(100, Math.round(100 * f.residuo / (t * (f.peso || 1000)))) : 0;
  return `<div class="card" data-id="${f.id}" data-c="f">
    <div class="crow1"><div class="sw" style="background:${esc(f.hex || '#ccc')}"></div>
      <div class="ti"><div class="small">${f.brand ? `<a class="lk has" data-a="brand" data-id="${f.id}">${esc(f.brand)}</a>` : '<a class="lk" data-a="edit" data-id="' + f.id + '">marca?</a>'}${f.type ? ' · ' + esc(f.type) : ''}
        ${isOut ? '<span class="badge b-red">Esaurito</span>' : ''}${f.riordina && !isOut ? '<span class="badge b-amb">Riordina</span>' : ''}${isLow ? '<span class="badge b-amb">Basso</span>' : ''}</div>
        <div class="name"><a class="lk ${f.url ? 'has' : ''}" data-a="link" data-id="${f.id}" title="${f.url ? 'Apri link prodotto' : 'Cerca sul sito'}">${esc(f.color)} ${f.url ? '↗' : '🔍'}</a></div></div>
      <div class="money">${f.costo > 0 ? eur(f.costo) : '<span class="small">costo?</span>'}<small>bobina</small></div></div>
    <div class="bar ${isLow || isOut ? 'low' : ''}"><i style="width:${pct}%"></i></div>
    <div class="meta"><div class="steps">
      <div class="stp">Nuove <button data-a="n" data-id="${f.id}" data-k="nuove" data-d="-1">−</button><b>${f.nuove}</b><button data-a="n" data-id="${f.id}" data-k="nuove" data-d="1">+</button></div>
      <div class="stp">Usate <button data-a="n" data-id="${f.id}" data-k="usate" data-d="-1">−</button><b>${f.usate}</b><button data-a="n" data-id="${f.id}" data-k="usate" data-d="1">+</button></div></div>
      <span>≈ ${f.residuo >= 1000 ? (f.residuo / 1000).toFixed(2) + ' kg' : Math.round(f.residuo) + ' g'}</span></div></div>`;
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
      <span class="small">+ = stampato (scala i grammi)</span></div></div>`;
}

/* ---------- calcolatore ---------- */
let CS = jget(CALC, { rows: [{ fid: '', name: '', g: '' }], h: '', m: '' });
function viewCalc() {
  return `<div class="res"><div class="rl">Costo totale</div><div class="rbig" id="rtot">€0,00</div>
    <div class="rrow"><div><span>Prezzo consigliato</span><b id="rprice">€0</b></div><div><span>Guadagno</span><b id="rgain">€0</b></div></div>
    <div class="rl" id="rest" style="margin-top:8px;text-transform:none"></div></div>
  <div class="panel"><h3>Filamenti</h3><div id="crows">${CS.rows.map(rowHtml).join('')}</div>
    <button class="btn sm" data-a="addrow">+ Colore</button>
    <h3 style="margin-top:14px">Tempo di stampa</h3><div class="g2">
      <div class="f"><label>Ore</label><input id="ch" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${esc(CS.h)}"></div>
      <div class="f"><label>Minuti</label><input id="cm" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${esc(CS.m)}"></div></div></div>
  <div class="panel"><h3>Dettaglio costi</h3><table class="dt" id="cbreak"></table></div>
  <button class="btn primary" style="width:100%" data-a="saveprint">Salva come stampa</button>`;
}
function rowHtml(r) {
  return `<div class="crow"><input class="inp cname" type="text" ${OF} placeholder="Marca / colore" value="${esc(r.name)}" data-fid="${esc(r.fid || '')}"><input class="inp cg" type="number" min="0" step="any" inputmode="decimal" ${OF} placeholder="grammi" value="${esc(r.g)}"><button data-a="delrow" tabindex="-1">✕</button></div>`;
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
function bindCalc() {
  const root = $('#view');
  const upd = () => {
    CS = { rows: readRows($('#crows')), h: $('#ch').value, m: $('#cm').value }; jset(CALC, CS);
    const min = num(CS.h) * 60 + num(CS.m), r = calc(CS.rows.map(x => ({ f: fil(x.fid), g: num(x.g) })), min);
    $('#rtot').textContent = eur(r.tot); $('#rprice').textContent = eur(r.price); $('#rgain').textContent = eur(r.price - r.tot);
    $('#rest').textContent = r.est ? '* include costo stimato (€/kg di riserva) per bobine senza costo' : '';
    $('#cbreak').innerHTML = breakHtml(r);
  };
  bindRows(root, upd); upd();
  root.oninput = e => { if (e.target.matches('#ch,#cm,.cg')) upd(); };
  root.onkeydown = e => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (e.target.matches('.cg')) { e.preventDefault(); const rows = $$('.crow'); if (e.target.closest('.crow') === rows[rows.length - 1] && num(e.target.value) > 0) addRow(); else $$('.cname')[rows.indexOf(e.target.closest('.crow')) + 1]?.focus(); }
    else if (e.target.matches('#ch')) { e.preventDefault(); $('#cm').focus(); }
    else if (e.target.matches('#cm')) { e.preventDefault(); e.target.blur(); }
  };
  function addRow() { $('#crows').insertAdjacentHTML('beforeend', rowHtml({ fid: '', name: '', g: '' })); bindRows(root, upd); $$('.cname').pop().focus(); }
  root.onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'addrow') addRow();
    if (b.dataset.a === 'delrow') { if ($$('.crow').length > 1) b.closest('.crow').remove(); else { $('.cname').value = ''; $('.cname').dataset.fid = ''; $('.cg').value = ''; } upd(); }
    if (b.dataset.a === 'saveprint') {
      const rows = CS.rows.filter(r => r.name || num(r.g) > 0);
      printSheet({ nome: '', prezzo: calc(CS.rows.map(x => ({ f: fil(x.fid), g: num(x.g) })), num(CS.h) * 60 + num(CS.m)).price, scorta: 0, minuti: num(CS.h) * 60 + num(CS.m), colori: rows.map(r => ({ fid: r.fid, nome: r.name, g: num(r.g) })), note: '' }, true);
    }
  };
}
function breakHtml(r) {
  return `<tr><th>Voce</th><th>Costo</th></tr><tr><td>Filamento</td><td>${eur(r.mat)}</td></tr><tr><td>Energia (${eur(r.kwhP)}/kWh · ${S.settings.watt} W)</td><td>${eur(r.en)}</td></tr><tr><td>Usura stampante</td><td>${eur(r.us)}</td></tr><tr><td>Rischio fallimento (${S.settings.fallimento}%)</td><td>${eur(r.fail)}</td></tr><tr class="tot"><td>Totale</td><td>${eur(r.tot)}</td></tr><tr><td>Prezzo consigliato (×${S.settings.ricarico})</td><td>${eur(r.price)}</td></tr>`;
}

/* ---------- schede modifica ---------- */
function filSheet(f) {
  const isNew = !f; f = f || { id: uid(), brand: '', type: '', color: '', hex: '#10b981', url: '', nuove: 1, usate: 0, peso: 1000, residuo: 1000, costo: 0, note: '', riordina: 0 };
  const body = `<div class="g2"><div class="f"><label>Marca</label><input id="fb" type="text" ${OF} value="${esc(f.brand)}" placeholder="es. Sunlu"></div>
    <div class="f"><label>Tipo</label><input id="ft" type="text" ${OF} value="${esc(f.type)}" placeholder="es. PLA Matte"></div></div>
    <div class="g2"><div class="f"><label>Colore</label><input id="fc" type="text" ${OF} value="${esc(f.color)}" placeholder="es. Grigio"></div>
    <div class="f"><label>Tinta</label><input id="fh" type="color" value="${esc(f.hex || '#10b981')}" style="height:42px;padding:3px"></div></div>
    <div class="f"><label>Link prodotto (opzionale)</label><input id="fu" type="text" ${OF} value="${esc(f.url)}" placeholder="https://..."></div>
    <div class="row" style="margin:-4px 0 10px"><button class="btn sm" type="button" id="fsearch">🔍 Cerca sul sito</button><button class="btn sm" type="button" id="fopen">↗ Apri link</button></div>
    <div class="g3"><div class="f"><label>Nuove</label><input id="fn" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${f.nuove}"></div>
    <div class="f"><label>Usate</label><input id="fus" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${f.usate}"></div>
    <div class="f"><label>Peso bobina g</label><input id="fp" type="number" min="1" step="any" inputmode="decimal" ${OF} value="${f.peso}"></div></div>
    <div class="g2"><div class="f"><label>Residuo totale g (stima)</label><input id="fr" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${Math.round(f.residuo)}"></div>
    <div class="f"><label>Costo bobina €</label><input id="fk" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${f.costo || ''}"></div></div>
    <div class="f"><label>Note</label><input id="fno" type="text" ${OF} value="${esc(f.note)}"></div>
    <label class="row" style="font-size:.9rem;font-weight:600"><input id="fri" type="checkbox" ${f.riordina ? 'checked' : ''}> Da riordinare</label>`;
  openSheet(isNew ? 'Nuova bobina' : 'Modifica bobina', body, {
    del: isNew ? null : () => { f.d = 1; touch('filaments', f); render(); toast('Bobina eliminata'); },
    init: el => {
      attachAC($('#fb', el), listItems(() => [...new Set([...list('filaments').map(x => x.brand).filter(Boolean), ...Object.keys(BRANDS).map(b => b.replace(/\b\w/g, c => c.toUpperCase()))])]), it => { $('#fb', el).value = it.label; $('#ft', el).focus(); });
      attachAC($('#ft', el), listItems(() => [...new Set([...list('filaments').map(x => x.type).filter(Boolean), ...TYPES])]), it => { $('#ft', el).value = it.label; $('#fc', el).focus(); });
      const est = () => { if (!$('#fr', el).dataset.m) $('#fr', el).value = Math.round(num($('#fn', el).value) * num($('#fp', el).value) + num($('#fus', el).value) * num($('#fp', el).value) / 2); };
      ['#fn', '#fus', '#fp'].forEach(s => $(s, el).addEventListener('input', est));
      $('#fr', el).addEventListener('input', () => $('#fr', el).dataset.m = 1);
      const tmp = () => ({ brand: $('#fb', el).value.trim(), type: $('#ft', el).value.trim(), color: $('#fc', el).value.trim(), url: $('#fu', el).value.trim() });
      $('#fsearch', el).onclick = () => openUrl(productLink({ ...tmp(), url: '' }));
      $('#fopen', el).onclick = () => openUrl(productLink(tmp()));
    },
    save: el => {
      const color = $('#fc', el).value.trim(); if (!color) { $('#fc', el).focus(); toast('Inserisci il colore'); return false; }
      Object.assign(f, {
        brand: $('#fb', el).value.trim(), type: $('#ft', el).value.trim(), color, hex: $('#fh', el).value, url: $('#fu', el).value.trim(),
        nuove: Math.max(0, Math.round(num($('#fn', el).value))), usate: Math.max(0, Math.round(num($('#fus', el).value))),
        peso: num($('#fp', el).value) || 1000, residuo: Math.max(0, num($('#fr', el).value)), costo: num($('#fk', el).value),
        note: $('#fno', el).value.trim(), riordina: $('#fri', el).checked ? 1 : 0,
      });
      if (isNew) S.filaments.push(f); touch('filaments', f); render();
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
  let photo = (PHOTOS[p.id] && PHOTOS[p.id].data) || null, photoChanged = false;
  const rows = (p.colori && p.colori.length ? p.colori : [{ fid: '', nome: '', g: '' }]).map(c => ({ fid: c.fid, name: c.nome, g: c.g || '' }));
  const body = `<div id="pph"></div>
    <div class="f"><label>Nome oggetto</label><input id="pn" type="text" ${OF} value="${esc(p.nome)}" placeholder="es. Snoopy"></div>
    <div class="g2"><div class="f"><label>Prezzo vendita €</label><input id="pp" type="number" min="0" step="any" inputmode="decimal" ${OF} value="${p.prezzo || ''}"></div>
    <div class="f"><label>Pezzi in magazzino</label><input id="ps" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${p.scorta || 0}"></div></div>
    <div class="g2"><div class="f"><label>Ore stampa</label><input id="ph" type="number" min="0" step="1" inputmode="numeric" ${OF} value="${Math.floor((p.minuti || 0) / 60) || ''}"></div>
    <div class="f"><label>Minuti</label><input id="pm" type="number" min="0" max="59" step="1" inputmode="numeric" ${OF} value="${(p.minuti || 0) % 60 || ''}"></div></div>
    <div class="lab" style="margin-bottom:4px">Colori usati (dal magazzino) e grammi</div><div id="crows">${rows.map(rowHtml).join('')}</div>
    <button class="btn sm" type="button" id="padd" style="margin-bottom:10px">+ Colore</button>
    <div class="f"><label>Foto</label><input id="pf" type="file" accept="image/*"></div>
    <div class="f"><label>Note</label><input id="pno" type="text" ${OF} value="${esc(p.note)}"></div>
    <table class="dt" id="pbreak"></table><p class="hint" id="pgain"></p>`;
  openSheet(isNew ? 'Nuova stampa' : 'Modifica stampa', body, {
    del: isNew ? null : () => { p.d = 1; touch('prints', p); delete PHOTOS[p.id]; jset(PH, PHOTOS); render(); toast('Stampa eliminata'); },
    init: el => {
      const showPh = () => { $('#pph', el).innerHTML = photo ? `<img class="photo" src="${photo}" alt=""><button class="btn sm danger" type="button" id="prm" style="margin-bottom:8px">Rimuovi foto</button>` : ''; const r = $('#prm', el); if (r) r.onclick = () => { photo = null; photoChanged = true; showPh(); }; };
      showPh();
      const cur = () => { const m = num($('#ph', el).value) * 60 + num($('#pm', el).value); return { m, r: readRows($('#crows', el)) }; };
      const upd = () => {
        const { m, r } = cur(), c = calc(r.map(x => ({ f: fil(x.fid), g: num(x.g) })), m);
        $('#pbreak', el).innerHTML = breakHtml(c);
        const gain = num($('#pp', el).value) - c.tot;
        $('#pgain', el).innerHTML = `Margine sul prezzo inserito: <b class="${gain >= 0 ? 'pos' : 'neg'}">${eur(gain)}</b>${c.est ? ' (costo filamento stimato)' : ''}`;
      };
      bindRows(el, upd); upd();
      el.addEventListener('input', e => { if (e.target.matches('#ph,#pm,#pp,.cg')) upd(); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.cg') && !e.defaultPrevented) { /* Enter salva (gestito dalla scheda) */ } });
      $('#padd', el).onclick = () => { $('#crows', el).insertAdjacentHTML('beforeend', rowHtml({ fid: '', name: '', g: '' })); bindRows(el, upd); $$('.cname', el).pop().focus(); };
      el.addEventListener('click', e => { const b = e.target.closest('[data-a=delrow]'); if (b) { if ($$('.crow', el).length > 1) b.closest('.crow').remove(); else { $('.cname', el).value = ''; $('.cname', el).dataset.fid = ''; $('.cg', el).value = ''; } upd(); } });
      $('#pf', el).onchange = async e => { const f = e.target.files[0]; if (f) { photo = await compress(f); photoChanged = true; showPh(); } };
    },
    save: el => {
      const nome = $('#pn', el).value.trim(); if (!nome) { $('#pn', el).focus(); toast('Inserisci il nome'); return false; }
      Object.assign(p, {
        nome, prezzo: num($('#pp', el).value), scorta: Math.max(0, Math.round(num($('#ps', el).value))),
        minuti: Math.round(num($('#ph', el).value) * 60 + num($('#pm', el).value)), note: $('#pno', el).value.trim(),
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
  const srow = (k, l, sub, step = 'any') => `<div class="srow"><label for="s_${k}">${l}<small>${sub}</small></label><input class="inp" id="s_${k}" data-k="${k}" type="number" min="0" step="${step}" inputmode="decimal" ${OF} value="${s[k]}"></div>`;
  return `<div class="panel"><h3>Costi di stampa</h3>
    ${srow('kwh', 'kWh consumati nel mese', 'dalla bolletta')}${srow('bolletta', 'Costo bolletta €', 'stesso periodo')}
    <p class="hint" id="kwhinfo" style="margin:-2px 0 10px">= ${eur(kwhP)} per kWh</p>
    ${srow('watt', 'Potenza media stampante (W)', 'Bambu P2S in stampa: ~120-180 W')}
    ${srow('usuraOra', 'Usura stampante €/ora', 'prezzo macchina / ore di vita')}
    <p class="hint" id="usinfo" style="margin:-2px 0 10px">= ${eur(s.usuraOra / 60)} al minuto</p>
    ${srow('fallimento', 'Fallimento stampe %', 'aggiunto al costo')}${srow('ricarico', 'Ricarico prezzo consigliato ×', 'costo × ricarico')}
    ${srow('costoKg', 'Costo di riserva €/kg', 'se la bobina non ha un costo')}${srow('soglia', 'Soglia scorta bassa (g)', 'sotto = badge "Basso"')}</div>
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
  <div class="panel"><h3>Dati</h3><div class="row"><button class="btn sm" data-a="export">Esporta backup</button><button class="btn sm" data-a="import">Importa backup</button><button class="btn sm danger" data-a="wipe">Svuota archivio locale</button></div>
    <input type="file" id="impf" accept=".json,application/json" hidden><p class="hint">Spoolio · v1.0</p></div>`;
}
function bindSet() {
  const root = $('#view');
  root.onchange = e => {
    const k = e.target.dataset.k;
    if (k) { S.settings[k] = num(e.target.value); touch('settings', S.settings); }
    if (e.target.id === 'c_url' || e.target.id === 'c_code' || e.target.id === 'c_key') {
      setCfg({ key: $('#c_key').value.trim(), url: $('#c_url').value.trim().replace(/\.json$/, '').replace(/\/+$/, ''), code: $('#c_code').value.trim().replace(/[^A-Za-z0-9_-]/g, '') });
      $('#c_code').value = cfg().code; S.meta.pushedAll = 0; save(); setDot(); if (cfgOK()) syncNow(true);
    }
    if (e.target.id === 'c_paste') { parseLink(e.target.value); e.target.value = ''; }
    if (e.target.id === 'impf') importFile(e.target.files[0]);
  };
  root.oninput = e => {
    if (!e.target.dataset.k) return;
    const s = { ...S.settings, [e.target.dataset.k]: num(e.target.value) };
    $('#kwhinfo').textContent = '= ' + eur(s.kwh > 0 ? s.bolletta / s.kwh : 0) + ' per kWh'; $('#usinfo').textContent = '= ' + eur(s.usuraOra / 60) + ' al minuto';
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
  const c = cfg(), r = await fetch(c.url + '/rest/v1/spoolio' + q, { ...opt, headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'x-code': c.code, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
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
    if (rs && (rs.u || 0) > (S.settings.u || 0)) { S.settings = { ...DEF_SETTINGS, ...rs }; delete S.meta.dirty['settings:main']; changed = true; }
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
  if (d > 0) for (const c of p.colori || []) { const f = fil(c.fid); if (f && num(c.g) > 0) { prev.push(JSON.stringify(f)); f.residuo = Math.max(0, f.residuo - num(c.g)); used += num(c.g); touch('filaments', f); } }
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
    if (act === 'n') { e.stopPropagation(); stepFil(id, a.dataset.k, +a.dataset.d); return; }
    if (act === 'pn') { e.stopPropagation(); stepPrint(id, +a.dataset.d); return; }
    if (act === 'flt') { V.flt = a.dataset.k; render(); return; }
    if (act === 'add') { V.tab === 'print' ? printSheet() : filSheet(); return; }
    if (act === 'sync') { if (!cfgOK()) { V.tab = 'set'; render(); } else syncNow(true); return; }
    if (act === 'syncnow') { syncNow(true); return; }
    if (act === 'newcode') { $('#c_code').value = randCode(); $('#c_code').dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (act === 'sharelink') { const c = cfg(); if (!cfgOK()) { toast('Prima inserisci URL e codice'); return; } share('spoolio:' + btoa(JSON.stringify({ u: c.url, c: c.code, k: c.key || '' })), 'Collegamento Spoolio'); return; }
    if (act === 'copysql') { share(SB_SQL, 'Script Supabase'); return; }
    if (act === 'copyrules') { share(RULES, 'Regole Firebase'); return; }
    if (act === 'copyreorder') { share('Da riordinare:\n' + list('filaments').filter(f => tot(f) <= 0 || f.riordina).map(f => '- ' + fname(f)).join('\n'), 'Lista riordino'); return; }
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
