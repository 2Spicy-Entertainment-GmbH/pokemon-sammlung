/* Pokémon-Sammlung – eine kleine Web-App ohne Build-Schritt.
 * Kartendaten & Preise: TCGdex API (https://tcgdex.dev), Preise von Cardmarket in EUR.
 * Speicherung: localStorage dieses Browsers (+ JSON-Export/Import).
 */
(() => {
  'use strict';

  const API = 'https://api.tcgdex.net/v2';
  const STORAGE_KEY = 'pokemon-sammlung-v1';
  const CONDITIONS = { MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
  const VARIANTS = { normal: 'Normal', reverse: 'Reverse Holo', holo: 'Holo', firstEdition: '1. Edition' };
  const OWNER_COLORS = ['#e3350d', '#3b6fd8', '#1f9d55', '#9c27b0', '#f2a005', '#00897b'];

  // ---------- Zustand ----------
  const defaultState = () => ({
    version: 1,
    owners: [{ id: uid(), name: 'Gemeinsam', color: OWNER_COLORS[0] }],
    items: [],
    settings: { searchLang: 'de' },
  });

  let state = load();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.items) && Array.isArray(s.owners) && s.owners.length) {
          s.settings = s.settings || { searchLang: 'de' };
          return s;
        }
      }
    } catch (e) { console.warn('Konnte Sammlung nicht laden', e); }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Speichern fehlgeschlagen – bitte Sicherung exportieren!'); }
  }

  // ---------- Hilfsfunktionen ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const fmtEur = (v) => (v == null || isNaN(v) ? '–' : eur.format(v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ownerById = (id) => state.owners.find((o) => o.id === id);
  const starsText = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** Bild-URL aus TCGdex-Basis. quality: 'low' | 'high' */
  function imageUrl(base, quality = 'low') {
    if (!base) return '';
    return `${base}/${quality}.webp`;
  }
  /** Fällt bei fehlendem deutschen Bild auf das englische zurück. */
  function attachImgFallback(img) {
    img.addEventListener('error', function onErr() {
      if (img.dataset.fallback !== '1' && /\/(de|fr|it|es|pt)\//.test(img.src)) {
        img.dataset.fallback = '1';
        img.src = img.src.replace(/\/(de|fr|it|es|pt)\//, '/en/');
      } else {
        img.removeEventListener('error', onErr);
        const ph = document.createElement('div');
        ph.className = 'noimg';
        ph.textContent = img.alt || 'Kein Bild';
        img.replaceWith(ph);
      }
    });
  }

  /** Marktwert einer Karte pro Stück: eigener Wert > Cardmarket-Trend (Variante beachtet). */
  function unitValue(item) {
    if (item.manualValue != null && item.manualValue !== '') return Number(item.manualValue);
    return item.price?.value ?? null;
  }
  function totalValue(item) {
    const v = unitValue(item);
    return v == null ? 0 : v * (item.qty || 1);
  }

  /** Wählt den passenden Cardmarket-Preis aus den TCGdex-Preisdaten. */
  function pickPrice(pricing, variant) {
    const cm = pricing?.cardmarket;
    if (!cm) return null;
    // Bei Cardmarket meinen die "-holo"-Felder die Reverse-Holo-Version; Holo-Karten haben den normalen Preis.
    const holoish = variant === 'reverse';
    const get = (k) => (typeof cm[k] === 'number' && cm[k] > 0 ? cm[k] : null);
    const value = holoish
      ? get('trend-holo') ?? get('avg-holo') ?? get('trend') ?? get('avg')
      : get('trend') ?? get('avg') ?? get('trend-holo');
    if (value == null) return null;
    return {
      value,
      low: holoish ? get('low-holo') ?? get('low') : get('low'),
      avg30: holoish ? get('avg30-holo') ?? get('avg30') : get('avg30'),
      source: 'Cardmarket',
      updatedAt: new Date().toISOString(),
    };
  }

  // ---------- API ----------
  async function apiGet(path) {
    const res = await fetch(API + path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('API-Fehler ' + res.status);
    return res.json();
  }
  async function searchCards(name, lang) {
    const q = new URLSearchParams({ name, 'pagination:itemsPerPage': '100' });
    return (await apiGet(`/${lang}/cards?${q}`)) || [];
  }
  const cardCache = new Map();
  async function getCard(id, lang) {
    const key = lang + ':' + id;
    if (!cardCache.has(key)) cardCache.set(key, apiGet(`/${lang}/cards/${encodeURIComponent(id)}`).catch((e) => { cardCache.delete(key); throw e; }));
    return cardCache.get(key);
  }

  // ---------- Navigation ----------
  let currentView = 'collection';
  function showView(view) {
    currentView = view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    render();
    if (view === 'search') $('#search-q').focus();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  function render() {
    if (currentView === 'collection') renderCollection();
    else if (currentView === 'wishlist') renderWishlist();
    else if (currentView === 'stats') renderStats();
    else if (currentView === 'settings') renderSettings();
    else if (currentView === 'search') { refreshSearchOwnedTags(); fillOwnerSelect($('#bulk-owner'), { value: $('#bulk-owner').value }); }
  }

  // ---------- Karten-Kachel ----------
  function cardTile(item, { showOwner = true } = {}) {
    const el = document.createElement('article');
    el.className = 'card';
    const owner = ownerById(item.owner);
    const val = unitValue(item);
    el.innerHTML = `
      <div class="badges">
        <span>${item.favorite ? '<span class="badge fav">★</span>' : ''}</span>
        <span>${item.qty > 1 ? `<span class="badge">×${item.qty}</span>` : ''}</span>
      </div>
      <div class="img">${item.image ? `<img loading="lazy" alt="${esc(item.name)}" src="${esc(imageUrl(item.image))}">` : `<div class="noimg">${esc(item.name)}</div>`}</div>
      <div class="body">
        <div class="name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="sub" title="${esc(item.setName)}">${esc(item.setName || '–')}${item.number ? ' · ' + esc(item.number) : ''}</div>
        <div class="sub">${esc(CONDITIONS[item.condition] || '')}${item.variant && item.variant !== 'normal' ? ' · ' + esc(VARIANTS[item.variant]) : ''}${item.grade ? ' · ' + esc(item.grade) : ''}</div>
        <div class="foot">
          <span class="price">${fmtEur(val)}</span>
          <span class="mini-stars">${starsText(item.rating)}</span>
        </div>
        ${showOwner && owner ? `<div class="sub"><span class="owner-dot" style="background:${esc(owner.color)}"></span>${esc(owner.name)}</div>` : ''}
      </div>`;
    const img = $('img', el);
    if (img) attachImgFallback(img);
    el.addEventListener('click', () => openItemDialog(item));
    return el;
  }

  // ---------- Sammlung ----------
  function fillOwnerSelect(sel, { withAll = false, value } = {}) {
    sel.innerHTML = (withAll ? '<option value="">Alle Sammler</option>' : '') +
      state.owners.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    if (value !== undefined && [...sel.options].some((o) => o.value === value)) sel.value = value;
  }

  function sortItems(items, mode) {
    const by = {
      added: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
      value: (a, b) => (unitValue(b) ?? -1) - (unitValue(a) ?? -1),
      name: (a, b) => a.name.localeCompare(b.name, 'de'),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'de'),
      set: (a, b) => (a.setName || '').localeCompare(b.setName || '', 'de') ||
        String(a.number).localeCompare(String(b.number), 'de', { numeric: true }),
    }[mode] || (() => 0);
    return [...items].sort(by);
  }

  function summaryChips(items) {
    const cards = items.reduce((s, i) => s + (i.qty || 1), 0);
    const value = items.reduce((s, i) => s + totalValue(i), 0);
    const paid = items.reduce((s, i) => s + (Number(i.purchasePrice) || 0) * (i.qty || 1), 0);
    const chips = [
      ['Karten', cards.toLocaleString('de-DE')],
      ['Verschiedene', items.length.toLocaleString('de-DE')],
      ['Gesamtwert', fmtEur(value)],
    ];
    if (paid > 0) chips.push(['Bezahlt', fmtEur(paid)]);
    return chips.map(([k, v]) => `<div class="chip"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }

  function renderCollection() {
    const ownerSel = $('#col-owner');
    const prevOwner = ownerSel.value;
    fillOwnerSelect(ownerSel, { withAll: true, value: prevOwner });

    const owned = state.items.filter((i) => !i.wishlist);
    const setSel = $('#col-set');
    const prevSet = setSel.value;
    const sets = [...new Set(owned.map((i) => i.setName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    setSel.innerHTML = '<option value="">Alle Sets</option>' + sets.map((s) => `<option>${esc(s)}</option>`).join('');
    if (sets.includes(prevSet)) setSel.value = prevSet;

    const q = $('#col-filter').value.trim().toLowerCase();
    let items = owned.filter((i) =>
      (!ownerSel.value || i.owner === ownerSel.value) &&
      (!setSel.value || i.setName === setSel.value) &&
      (!$('#col-fav').checked || i.favorite) &&
      (!q || [i.name, i.setName, i.number, i.rarity, i.note].some((f) => String(f || '').toLowerCase().includes(q))));
    items = sortItems(items, $('#col-sort').value);

    $('#collection-summary').innerHTML = summaryChips(items);
    const grid = $('#collection-grid');
    grid.replaceChildren(...items.map((i) => cardTile(i, { showOwner: state.owners.length > 1 })));
    const empty = $('#collection-empty');
    empty.hidden = items.length > 0;
    if (!items.length && owned.length) empty.textContent = 'Keine Karten passen zu diesem Filter.';
    else if (!owned.length) empty.innerHTML = 'Noch keine Karten hier. Geh auf <strong>Karten suchen</strong> und füge deine erste Karte hinzu!';
  }
  ['#col-filter', '#col-owner', '#col-set', '#col-sort', '#col-fav'].forEach((s) =>
    $(s).addEventListener(s === '#col-filter' ? 'input' : 'change', renderCollection));

  // ---------- Wunschliste ----------
  function renderWishlist() {
    const items = sortItems(state.items.filter((i) => i.wishlist), 'value');
    const value = items.reduce((s, i) => s + totalValue(i), 0);
    $('#wishlist-summary').innerHTML =
      `<div class="chip"><div class="k">Wünsche</div><div class="v">${items.length}</div></div>` +
      `<div class="chip"><div class="k">Kosten ca.</div><div class="v">${fmtEur(value)}</div></div>`;
    $('#wishlist-grid').replaceChildren(...items.map((i) => cardTile(i)));
    $('#wishlist-empty').hidden = items.length > 0;
  }

  // ---------- Suche ----------
  let lastResults = [];
  let lastLang = 'de';
  $('#search-lang').value = state.settings.searchLang || 'de';

  $('#search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#search-q').value.trim();
    const num = $('#search-num').value.trim().replace(/\/.*$/, '').replace(/^0+(?=\d)/, '').toLowerCase();
    const lang = $('#search-lang').value;
    state.settings.searchLang = lang; save();
    if (!name) return;
    const status = $('#search-status');
    status.textContent = 'Suche läuft …';
    $('#search-grid').replaceChildren();
    try {
      let results = await searchCards(name, lang);
      if (num) results = results.filter((c) => String(c.localId).replace(/^0+(?=\d)/, '').toLowerCase() === num);
      lastResults = results; lastLang = lang;
      status.textContent = results.length
        ? `${results.length} Karte${results.length === 1 ? '' : 'n'} gefunden – klicke auf eine Karte, um sie hinzuzufügen.`
        : 'Keine Karten gefunden. Prüfe die Schreibweise oder wechsle die Sprache.';
      renderSearchResults();
    } catch (err) {
      console.error(err);
      status.textContent = 'Die Kartendatenbank ist gerade nicht erreichbar. Bist du online? Du kannst die Karte auch manuell eintragen.';
    }
  });

  function renderSearchResults() {
    const owned = ownedCountByCardId();
    const tiles = lastResults.map((c) => {
      const el = document.createElement('article');
      el.className = 'card';
      el.dataset.cardId = c.id;
      el.innerHTML = `
        <div class="img">${c.image ? `<img loading="lazy" alt="${esc(c.name)}" src="${esc(imageUrl(c.image))}">` : `<div class="noimg">${esc(c.name)}<br>(kein Bild)</div>`}</div>
        <div class="body">
          <div class="name">${esc(c.name)}</div>
          <div class="sub">${esc(c.id)}</div>
          <div class="owned-tag">${owned[c.id] ? `✓ ${owned[c.id]}× in Sammlung` : ''}</div>
        </div>`;
      const img = $('img', el);
      if (img) attachImgFallback(img);
      el.addEventListener('click', () => openNewCardDialog(c.id, lastLang));
      return el;
    });
    $('#search-grid').replaceChildren(...tiles);
  }
  function ownedCountByCardId() {
    const m = {};
    state.items.filter((i) => !i.wishlist && i.cardId).forEach((i) => { m[i.cardId] = (m[i.cardId] || 0) + (i.qty || 1); });
    return m;
  }
  function refreshSearchOwnedTags() {
    const owned = ownedCountByCardId();
    $$('#search-grid .card').forEach((el) => {
      const n = owned[el.dataset.cardId];
      $('.owned-tag', el).textContent = n ? `✓ ${n}× in Sammlung` : '';
    });
  }

  $('#manual-add').addEventListener('click', () => openItemDialog(null, { manual: true }));

  // ---------- Listen-Import (z. B. von Claude aus Fotos erkannt) ----------
  const VARIANT_WORDS = { normal: 'normal', reverse: 'reverse', 'reverse-holo': 'reverse', rh: 'reverse', holo: 'holo', '1st': 'firstEdition', '1.edition': 'firstEdition', firstedition: 'firstEdition', erstedition: 'firstEdition' };

  /** Liest Zeilen wie "swsh3-20 2 holo NM" oder JSON. Liefert [{cardId, qty, variant?, condition?, lang?}]. */
  function parseImportList(text) {
    const t = text.trim();
    if (!t) return [];
    if (t.startsWith('{') || t.startsWith('[')) {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : j.cards;
      if (!Array.isArray(arr)) throw new Error('JSON enthält keine Kartenliste');
      return arr.map((c) => ({ cardId: String(c.cardId || c.id || '').trim(), qty: Math.max(1, parseInt(c.qty, 10) || 1),
        variant: VARIANT_WORDS[String(c.variant || '').toLowerCase()] || null, condition: CONDITIONS[String(c.condition || '').toUpperCase()] ? String(c.condition).toUpperCase() : null,
        lang: c.lang === 'en' ? 'en' : null })).filter((c) => c.cardId);
    }
    return t.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[\s,;]+/);
      const entry = { cardId: parts[0], qty: 1, variant: null, condition: null, lang: null };
      parts.slice(1).forEach((p) => {
        const w = p.toLowerCase().replace(/^x/, '');
        if (/^\d+$/.test(w)) entry.qty = Math.max(1, parseInt(w, 10));
        else if (/^\d+x$/.test(w)) entry.qty = Math.max(1, parseInt(w, 10));
        else if (VARIANT_WORDS[w]) entry.variant = VARIANT_WORDS[w];
        else if (CONDITIONS[p.toUpperCase()]) entry.condition = p.toUpperCase();
        else if (w === 'en' || w === 'de') entry.lang = w;
      });
      return entry;
    });
  }

  $('#bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#bulk-status');
    const btn = $('#bulk-form button[type=submit]');
    let entries;
    try { entries = parseImportList($('#bulk-text').value); }
    catch (err) { status.textContent = 'Die Liste konnte nicht gelesen werden: ' + err.message; return; }
    if (!entries.length) { status.textContent = 'Bitte zuerst eine Liste einfügen.'; return; }
    const owner = $('#bulk-owner').value;
    const fallbackLang = $('#search-lang').value;
    const wishlist = $('#bulk-wishlist').checked;
    btn.disabled = true;
    const failed = [];
    let cards = 0;
    for (let n = 0; n < entries.length; n++) {
      const en = entries[n];
      status.textContent = `Lade ${n + 1} / ${entries.length} …`;
      try {
        const lang = en.lang || fallbackLang;
        let c = await getCard(en.cardId, lang);
        let usedLang = lang;
        if (!c && lang !== 'en') { c = await getCard(en.cardId, 'en'); usedLang = 'en'; }
        if (!c) { failed.push(en.cardId); continue; }
        c = await withImage(c);
        const d = cardToDraft(c, usedLang);
        const variant = en.variant || d.variant;
        addOrMerge({
          id: uid(), ...d, variant, owner, qty: en.qty, condition: en.condition || 'NM', cardLanguage: lang,
          grade: '', purchasePrice: null, manualValue: null, note: '', favorite: false, wishlist, rating: 0,
          price: pickPrice(c.pricing, variant), addedAt: new Date().toISOString(),
        });
        cards += en.qty;
      } catch (err) { console.error(err); failed.push(en.cardId); }
    }
    save();
    btn.disabled = false;
    status.textContent = `${cards} Karte(n) hinzugefügt.` + (failed.length ? ` Nicht gefunden: ${failed.join(', ')}` : '');
    if (!failed.length) $('#bulk-text').value = '';
    toast(`${cards} Karte(n) importiert`);
    refreshSearchOwnedTags();
  });

  // ---------- Dialog ----------
  const dlg = $('#card-dialog');
  const form = $('#card-form');
  let editing = null;   // bestehendes Item oder null
  let draft = null;     // Kartendaten für neues Item
  let draftPricing = null;
  let rating = 0;

  function renderStars() {
    const box = $('#dlg-stars');
    box.innerHTML = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" role="radio" aria-checked="${n === rating}" aria-label="${n} Sterne" class="${n <= rating ? 'on' : ''}" data-n="${n}">★</button>`).join('');
  }
  $('#dlg-stars').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const n = Number(b.dataset.n);
    rating = rating === n ? 0 : n;
    renderStars();
  });

  function defaultVariantFor(variants = {}) {
    if (variants.normal === false && variants.holo) return 'holo';
    if (variants.normal === false && variants.reverse) return 'reverse';
    return 'normal';
  }
  function cardToDraft(c, lang) {
    const variants = c.variants || {};
    return {
      cardId: c.id,
      apiLang: lang,
      name: c.name,
      setId: c.set?.id || '',
      setName: c.set?.name || '',
      number: c.localId + (c.set?.cardCount?.official ? '/' + c.set.cardCount.official : ''),
      rarity: c.rarity || '',
      image: c.image || '',
      types: c.types || [],
      variants,
      variant: defaultVariantFor(variants),
      cardLanguage: lang,
    };
  }

  /** Fügt ein Item hinzu oder erhöht die Anzahl einer identischen Karte. Gibt das betroffene Item zurück. */
  function addOrMerge(item) {
    const twin = item.cardId && state.items.find((i) => i.cardId === item.cardId && i.owner === item.owner &&
      i.condition === item.condition && i.variant === item.variant && !!i.wishlist === !!item.wishlist && (i.grade || '') === (item.grade || ''));
    if (twin) { twin.qty += item.qty; return { item: twin, merged: true }; }
    state.items.push(item);
    return { item, merged: false };
  }

  /** Wenn eine Karte in der gewählten Sprache kein Bild hat, das englische nehmen. */
  async function withImage(c) {
    if (!c || c.image) return c;
    try { const en = await getCard(c.id, 'en'); if (en?.image) return { ...c, image: en.image }; } catch { /* egal */ }
    return c;
  }

  async function openNewCardDialog(cardId, lang) {
    $('#search-status').textContent = 'Lade Kartendetails …';
    try {
      const c = await withImage(await getCard(cardId, lang));
      if (!c) throw new Error('Karte nicht gefunden');
      $('#search-status').textContent = '';
      draftPricing = c.pricing || null;
      draft = cardToDraft(c, lang);
      openItemDialog(null);
    } catch (err) {
      console.error(err);
      $('#search-status').textContent = 'Kartendetails konnten nicht geladen werden.';
    }
  }

  function openItemDialog(item, { manual = false } = {}) {
    editing = item;
    const data = item || draft || {};
    if (manual) { draft = null; draftPricing = null; }
    const isManual = manual || (item && !item.cardId);
    form.classList.toggle('manual', !!isManual);
    form.reset();

    fillOwnerSelect($('#dlg-owner'), { value: data.owner || ($('#col-owner').value || state.owners[0].id) });

    const img = $('#dlg-img');
    img.dataset.fallback = '';
    img.src = data.image ? imageUrl(data.image, 'high') : '';
    img.alt = data.name || '';
    img.onerror = () => {
      if (img.dataset.fallback !== '1' && /\/(de|fr|it|es|pt)\//.test(img.src)) {
        img.dataset.fallback = '1';
        img.src = img.src.replace(/\/(de|fr|it|es|pt)\//, '/en/');
      }
    };

    $('#dlg-title').textContent = isManual && !item ? 'Karte manuell eintragen' : data.name;
    $('#dlg-meta').textContent = isManual && !item ? 'Für Karten, die die Datenbank nicht kennt.' :
      [data.setName, data.number, data.rarity].filter(Boolean).join(' · ');

    // Varianten, die es für diese Karte gibt
    const vs = data.variants;
    $$('#dlg-variant option').forEach((o) => { o.hidden = !!vs && Object.keys(vs).length > 0 && vs[o.value] === false; });

    const f = form.elements;
    if (isManual) {
      f.name.value = data.name || ''; f.setName.value = data.setName || '';
      f.number.value = data.number || ''; f.rarity.value = data.rarity || '';
    }
    f.qty.value = data.qty || 1;
    f.condition.value = data.condition || 'NM';
    f.variant.value = data.variant || 'normal';
    f.cardLanguage.value = data.cardLanguage || 'de';
    f.grade.value = data.grade || '';
    f.purchasePrice.value = data.purchasePrice ?? '';
    f.manualValue.value = data.manualValue ?? '';
    f.note.value = data.note || '';
    f.favorite.checked = !!data.favorite;
    f.wishlist.checked = !!data.wishlist;
    rating = data.rating || 0;
    renderStars();
    updatePriceLine();

    $('#dlg-delete').hidden = !item;
    $('#dlg-save').textContent = item ? 'Speichern' : 'Zur Sammlung hinzufügen';
    dlg.showModal();
  }

  function updatePriceLine() {
    const variant = form.elements.variant.value;
    const line = $('#dlg-price');
    let p = null;
    if (draftPricing) p = pickPrice(draftPricing, variant);
    else if (editing) p = editing.price;
    if (p && p.value != null) {
      const extra = [p.low != null ? `ab ${fmtEur(p.low)}` : '', p.avg30 != null ? `Ø 30 Tage ${fmtEur(p.avg30)}` : ''].filter(Boolean).join(' · ');
      const when = p.updatedAt ? ` (Stand ${new Date(p.updatedAt).toLocaleDateString('de-DE')})` : '';
      line.innerHTML = `Marktpreis: <strong>${fmtEur(p.value)}</strong>${extra ? ' · ' + extra : ''}<span class="hint">${when}</span>`;
    } else {
      line.textContent = form.classList.contains('manual') ? '' : 'Kein Marktpreis verfügbar – du kannst einen eigenen Wert eintragen.';
    }
  }
  form.elements.variant.addEventListener('change', async () => {
    // Bei bestehender Karte Preis für neue Variante nachladen
    if (editing && editing.cardId) {
      try {
        const c = await getCard(editing.cardId, editing.apiLang || 'de');
        draftPricing = c?.pricing || null;
      } catch { /* offline – alter Preis bleibt */ }
    }
    updatePriceLine();
  });

  $('#dlg-cancel').addEventListener('click', () => dlg.close());
  $('#dlg-delete').addEventListener('click', () => {
    if (!editing) return;
    if (!confirm(`„${editing.name}“ wirklich löschen?`)) return;
    state.items = state.items.filter((i) => i.id !== editing.id);
    save(); dlg.close(); render(); toast('Karte gelöscht');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const num = (v) => (v === '' || v == null ? null : Math.max(0, Number(v)));
    const values = {
      owner: f.owner.value,
      qty: Math.max(1, parseInt(f.qty.value, 10) || 1),
      condition: f.condition.value,
      variant: f.variant.value,
      cardLanguage: f.cardLanguage.value,
      grade: f.grade.value.trim(),
      purchasePrice: num(f.purchasePrice.value),
      manualValue: num(f.manualValue.value),
      note: f.note.value.trim(),
      favorite: f.favorite.checked,
      wishlist: f.wishlist.checked,
      rating,
    };
    if (form.classList.contains('manual')) {
      const name = f.name.value.trim();
      if (!name) { toast('Bitte einen Namen eingeben'); f.name.focus(); return; }
      Object.assign(values, { name, setName: f.setName.value.trim(), number: f.number.value.trim(), rarity: f.rarity.value.trim() });
    }

    if (editing) {
      const variantChanged = editing.variant !== values.variant;
      Object.assign(editing, values);
      if (variantChanged && draftPricing) editing.price = pickPrice(draftPricing, values.variant) || editing.price;
      toast('Gespeichert');
    } else {
      const base = draft && !form.classList.contains('manual') ? draft : { cardId: null, image: '' };
      const item = {
        id: uid(),
        cardId: base.cardId, apiLang: base.apiLang, name: base.name, setId: base.setId, setName: base.setName,
        number: base.number, rarity: base.rarity, image: base.image, types: base.types, variants: base.variants,
        ...values,
        price: draftPricing ? pickPrice(draftPricing, values.variant) : null,
        addedAt: new Date().toISOString(),
      };
      // Gleiche Karte (gleicher Besitzer/Zustand/Variante) zusammenfassen statt doppelt anlegen
      const r = addOrMerge(item);
      if (r.merged) toast(`Anzahl erhöht: ${r.item.name} ×${r.item.qty}`);
      else toast(item.wishlist ? 'Auf die Wunschliste gesetzt' : `${item.name} hinzugefügt`);
    }
    save();
    dlg.close();
    render();
  });
  dlg.addEventListener('close', () => { editing = null; draft = null; draftPricing = null; });

  // ---------- Statistik ----------
  function barList(entries, fmt = (v) => v) {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    return `<div class="bars">${entries.map(([label, v, color]) => `
      <div class="bar-row"><span class="lbl" title="${esc(label)}">${esc(label)}</span>
        <span class="bar"><span style="width:${(v / max) * 100}%;${color ? 'background:' + esc(color) : ''}"></span></span>
        <span class="num">${fmt(v)}</span></div>`).join('')}</div>`;
  }
  function groupSum(items, keyFn, valFn) {
    const m = new Map();
    items.forEach((i) => { const k = keyFn(i) || 'Unbekannt'; m.set(k, (m.get(k) || 0) + valFn(i)); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderStats() {
    const owned = state.items.filter((i) => !i.wishlist);
    const box = $('#stats-content');
    if (!owned.length) { box.innerHTML = '<p class="empty">Sobald Karten in der Sammlung sind, gibt es hier Statistiken.</p>'; return; }

    const paid = owned.reduce((s, i) => s + (Number(i.purchasePrice) || 0) * (i.qty || 1), 0);
    const paidItemsValue = owned.filter((i) => i.purchasePrice != null).reduce((s, i) => s + totalValue(i), 0);
    const diff = paidItemsValue - paid;

    const byOwner = state.owners.map((o) => {
      const its = owned.filter((i) => i.owner === o.id);
      return { o, cards: its.reduce((s, i) => s + i.qty, 0), value: its.reduce((s, i) => s + totalValue(i), 0) };
    });
    const top = sortItems(owned, 'value').filter((i) => unitValue(i) != null).slice(0, 10);
    const bySet = groupSum(owned, (i) => i.setName, (i) => i.qty).slice(0, 10);
    const byRarity = groupSum(owned, (i) => i.rarity, (i) => i.qty).slice(0, 10);
    const byType = groupSum(owned.flatMap((i) => (i.types?.length ? i.types : [null]).map((t) => ({ ...i, _t: t }))), (i) => i._t, (i) => i.qty).slice(0, 10);
    const rated = owned.filter((i) => i.rating);
    const noPrice = owned.filter((i) => unitValue(i) == null).length;

    box.innerHTML = `
      <div class="summary">${summaryChips(owned)}
        ${paid > 0 ? `<div class="chip"><div class="k">Gewinn/Verlust</div><div class="v ${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : ''}${fmtEur(diff)}</div></div>` : ''}
        ${rated.length ? `<div class="chip"><div class="k">Ø Bewertung</div><div class="v">${(rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(1)} ★</div></div>` : ''}
      </div>
      ${noPrice ? `<p class="hint">${noPrice} Karte(n) ohne Preis – sie zählen im Gesamtwert nicht mit.</p>` : ''}
      <div class="stats-grid">
        <div class="panel"><h3>Wertvollste Karten</h3>
          <ol class="top-list">${top.map((i) => `
            <li data-id="${esc(i.id)}">${i.image ? `<img alt="" src="${esc(imageUrl(i.image))}">` : ''}
              <div class="grow"><div><strong>${esc(i.name)}</strong>${i.qty > 1 ? ` ×${i.qty}` : ''}</div><div class="hint" style="margin:0">${esc(i.setName || '')}</div></div>
              <strong>${fmtEur(unitValue(i))}</strong></li>`).join('')}</ol>
        </div>
        ${state.owners.length > 1 ? `<div class="panel"><h3>Wert pro Sammler</h3>${barList(byOwner.map((x) => [x.o.name + ` (${x.cards})`, x.value, x.o.color]), fmtEur)}</div>` : ''}
        <div class="panel"><h3>Karten pro Set</h3>${barList(bySet)}</div>
        <div class="panel"><h3>Seltenheiten</h3>${barList(byRarity)}</div>
        <div class="panel"><h3>Typen</h3>${barList(byType)}</div>
      </div>`;
    $$('.top-list li', box).forEach((li) => li.addEventListener('click', () => openItemDialog(state.items.find((i) => i.id === li.dataset.id))));
    $$('.top-list img', box).forEach(attachImgFallback);
  }

  // ---------- Einstellungen ----------
  function renderSettings() {
    const list = $('#owner-list');
    list.innerHTML = '';
    state.owners.forEach((o) => {
      const count = state.items.filter((i) => i.owner === o.id).length;
      const li = document.createElement('li');
      li.innerHTML = `
        <input type="color" value="${esc(o.color)}" aria-label="Farbe">
        <input type="text" value="${esc(o.name)}" maxlength="30" aria-label="Name">
        <span class="hint" style="margin:0">${count} Einträge</span>
        <button type="button" class="danger" ${state.owners.length === 1 ? 'disabled' : ''}>Entfernen</button>`;
      const [color, name] = $$('input', li);
      color.addEventListener('change', () => { o.color = color.value; save(); });
      name.addEventListener('change', () => { o.name = name.value.trim() || o.name; name.value = o.name; save(); });
      $('button', li).addEventListener('click', () => {
        const other = state.owners.find((x) => x.id !== o.id);
        if (count && !confirm(`${o.name} hat ${count} Einträge. Diese werden ${other.name} zugeordnet. Fortfahren?`)) return;
        state.items.forEach((i) => { if (i.owner === o.id) i.owner = other.id; });
        state.owners = state.owners.filter((x) => x.id !== o.id);
        save(); renderSettings();
      });
      list.appendChild(li);
    });
  }
  $('#owner-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#owner-name').value.trim();
    if (!name) return;
    state.owners.push({ id: uid(), name, color: OWNER_COLORS[state.owners.length % OWNER_COLORS.length] });
    $('#owner-name').value = '';
    save(); renderSettings(); toast(`${name} hinzugefügt`);
  });

  $('#refresh-prices').addEventListener('click', async () => {
    const btn = $('#refresh-prices');
    const status = $('#refresh-status');
    const items = state.items.filter((i) => i.cardId);
    if (!items.length) { status.textContent = 'Keine Karten mit Datenbank-Verknüpfung.'; return; }
    btn.disabled = true;
    cardCache.clear();
    let done = 0, updated = 0, failed = 0;
    const queue = [...items];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try {
          const c = await getCard(it.cardId, it.apiLang || 'de');
          const p = pickPrice(c?.pricing, it.variant);
          if (p) { it.price = p; updated++; }
        } catch { failed++; }
        status.textContent = `${++done} / ${items.length} …`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    save();
    btn.disabled = false;
    status.textContent = `Fertig: ${updated} Preise aktualisiert${failed ? `, ${failed} fehlgeschlagen` : ''}.`;
  });

  // ---------- Export / Import ----------
  function download(filename, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  $('#export-btn').addEventListener('click', () =>
    download(`pokemon-sammlung-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#export-csv').addEventListener('click', () => {
    const cols = ['Name', 'Set', 'Nummer', 'Seltenheit', 'Besitzer', 'Anzahl', 'Zustand', 'Variante', 'Sprache', 'Gradiert', 'Bewertung', 'Marktwert €', 'Eigener Wert €', 'Kaufpreis €', 'Wunschliste', 'Favorit', 'Notiz'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
    const rows = state.items.map((i) => [i.name, i.setName, i.number, i.rarity, ownerById(i.owner)?.name, i.qty,
      CONDITIONS[i.condition], VARIANTS[i.variant], i.cardLanguage, i.grade, i.rating || '', n(i.price?.value),
      n(i.manualValue), n(i.purchasePrice), i.wishlist ? 'ja' : '', i.favorite ? 'ja' : '', i.note].map(q).join(';'));
    download(`pokemon-sammlung-${today()}.csv`, '﻿' + [cols.map(q).join(';'), ...rows].join('\r\n'), 'text/csv');
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!s || !Array.isArray(s.items) || !Array.isArray(s.owners) || !s.owners.length) throw new Error('Ungültiges Format');
      if (!confirm(`Sicherung mit ${s.items.length} Einträgen laden? Die aktuelle Sammlung in diesem Browser wird ersetzt.`)) return;
      s.settings = s.settings || { searchLang: 'de' };
      state = s; save(); render(); toast('Sicherung geladen');
    } catch (err) {
      toast('Datei konnte nicht gelesen werden: ' + err.message);
    }
  });

  // Änderungen aus anderem Tab übernehmen
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); render(); } });

  render();
})();
