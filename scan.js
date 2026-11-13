/* Foto-Scan: Karten auf Fotos mit Claude erkennen, mit TCGdex abgleichen und gesammelt eintragen.
 * Der Claude-API-Schlüssel wird nur im localStorage dieses Geräts gespeichert und direkt an
 * api.anthropic.com geschickt – nie an einen anderen Server.
 */
(() => {
  'use strict';
  const A = window.PokeApp;
  if (!A) return;
  const { esc, fmtEur, imageUrl, attachImgFallback, getCard, searchCards, withImage, cardToDraft, pickPrice, addOrMerge, uid, VARIANTS } = A;

  const KEY_STORAGE = 'pokemon-sammlung-claude-key';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.2.0/+esm';
  const MODEL = 'claude-opus-5-5';
  const MAX_EDGE = 2400; // längste Bildkante in Pixeln – genug, um Kartennummern zu lesen

  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- API-Schlüssel ----------
  function getKey() { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } }
  function setKey(k) { try { k ? localStorage.setItem(KEY_STORAGE, k) : localStorage.removeItem(KEY_STORAGE); } catch { /* egal */ } }

  let clientPromise = null;
  async function getClient() {
    const key = getKey();
    if (!key) throw Object.assign(new Error('Kein API-Schlüssel'), { code: 'no_key' });
    if (!clientPromise || clientPromise.key !== key) {
      const p = import(SDK_URL).then((mod) => {
        const Anthropic = mod.default || mod.Anthropic;
        // Der Schlüssel bleibt auf diesem Gerät; ohne diese Option verweigert das SDK den Einsatz im Browser.
        return { Anthropic, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) };
      });
      p.key = key;
      clientPromise = p;
    }
    return clientPromise;
  }

  // ---------- Bild vorbereiten ----------
  async function fileToJpegBase64(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const thumb = (() => {
      const t = document.createElement('canvas');
      const ts = 160 / Math.max(w, h);
      t.width = Math.round(w * ts); t.height = Math.round(h * ts);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      return t.toDataURL('image/jpeg', 0.7);
    })();
    return { base64: dataUrl.split(',')[1], thumb };
  }

  // ---------- Erkennung mit Claude ----------
  const CARD_SCHEMA = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Card name exactly as printed, in the card\'s own language' },
            card_language: { type: 'string', enum: ['de', 'en', 'jp', 'other'] },
            number: { type: 'string', description: 'Collector number as printed, e.g. "020/189" or "TG05/TG30"; empty string if unreadable' },
            set_code: { type: 'string', description: 'Printed set abbreviation next to the number (e.g. "PAF", "MEW"); empty string if none' },
            variant: { type: 'string', enum: ['normal', 'holo', 'reverse', 'unknown'] },
            count: { type: 'integer', description: 'How many copies of this exact card are visible in the photo' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            position: { type: 'string', description: 'Where in the photo, in German, e.g. "oben links"' },
          },
          required: ['name', 'card_language', 'number', 'set_code', 'variant', 'count', 'confidence', 'position'],
          additionalProperties: false,
        },
      },
      notes: { type: 'string', description: 'Short German note about problems (blur, glare, cut-off cards); empty if none' },
    },
    required: ['cards', 'notes'],
    additionalProperties: false,
  };

  const PROMPT = `This photo shows one or more Pokémon Trading Card Game cards, often several laid out next to each other.
Identify every card front you can see and return them in the JSON format.

- name: copy the card name exactly as printed, including suffixes such as "ex", "V", "VMAX", "VSTAR", "GX" and owner prefixes ("Team Rockets ..."). Keep the card's language (German cards keep German names, e.g. "Glurak", not "Charizard"). Trainer and energy cards count too.
- number: the collector number printed at the bottom edge, e.g. "020/189". Copy it exactly, including leading zeros and letter prefixes. If you cannot read it with certainty, return an empty string rather than a guess.
- set_code: the small set abbreviation printed near the number, if there is one.
- variant: "holo" if the artwork itself is holographic/foil, "reverse" if the card body or frame is foil but the artwork is not, "normal" otherwise, "unknown" if glare or the angle makes it impossible to tell.
- count: identical cards (same name, same number, same variant) form one entry with the number of copies visible. Different variants of the same card are separate entries.
- confidence: "low" for cards that are blurry, partly covered or cut off at the photo edge.
- Ignore card backs, sleeves, binder pages without visible card fronts, and anything that is not a Pokémon card.`;

  async function recognizePhoto(base64) {
    const { Anthropic, client } = await getClient();
    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Der API-Schlüssel wurde abgelehnt. Bitte unten prüfen.'), { code: 'auth' });
      if (err instanceof Anthropic.PermissionDeniedError) throw new Error('Der API-Schlüssel darf dieses Modell nicht nutzen.');
      if (err instanceof Anthropic.RateLimitError) throw new Error('Zu viele Anfragen auf einmal – bitte kurz warten und erneut versuchen.');
      if (err instanceof Anthropic.BadRequestError) throw new Error('Das Foto konnte nicht verarbeitet werden (' + (err.message || 'ungültige Anfrage') + ').');
      if (err instanceof Anthropic.APIConnectionError) throw new Error('Keine Verbindung zu Claude. Bist du online?');
      if (err instanceof Anthropic.APIError) throw new Error('Claude meldet einen Fehler (' + (err.status || '') + '). Bitte später erneut versuchen.');
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new Error('Claude hat dieses Foto nicht bearbeitet.');
    if (response.stop_reason === 'max_tokens') throw new Error('Zu viele Karten auf einem Foto – bitte in mehrere Fotos aufteilen.');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const data = JSON.parse(text);
    return { cards: Array.isArray(data.cards) ? data.cards : [], notes: data.notes || '' };
  }

  // ---------- Abgleich mit TCGdex ----------
  const normId = (s) => String(s || '').trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
  const normName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const isPocket = (c) => /\/tcgp\//.test(c.image || '') || /^(A\d|B\d|P-A)/.test(c.id);

  function splitNumber(num) {
    const m = String(num || '').trim().match(/^([A-Za-z]*\d+[A-Za-z]?)\s*\/\s*([A-Za-z]*\d+)/);
    if (m) return { local: m[1], total: m[2] };
    const single = String(num || '').trim().match(/^[A-Za-z]*\d+[A-Za-z]?$/);
    return single ? { local: single[0], total: '' } : { local: '', total: '' };
  }

  /** Liefert sortierte Kandidaten [{card, lang, score}] für eine erkannte Karte. */
  async function matchCard(rec) {
    const { local, total } = splitNumber(rec.number);
    const langs = rec.card_language === 'en' ? ['en', 'de'] : ['de', 'en'];
    for (const lang of langs) {
      // Name ohne Zusätze wie "ex"/"V" für die Suche, damit Schreibvarianten trotzdem passen
      const base = rec.name.replace(/\s+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|δ)$/u, '').trim() || rec.name;
      let brief;
      try { brief = await searchCards(base, lang); } catch { continue; }
      brief = brief.filter((c) => !isPocket(c));
      if (local) brief = brief.filter((c) => normId(c.localId) === normId(local));
      if (!brief.length) continue;
      const wanted = normName(rec.name);
      brief.sort((a, b) => (normName(b.name) === wanted) - (normName(a.name) === wanted));
      const details = (await Promise.all(brief.slice(0, 8).map((c) => getCard(c.id, lang).catch(() => null)))).filter(Boolean);
      const scored = details.map((card) => {
        let score = 0;
        if (normName(card.name) === wanted) score += 4;
        else if (normName(card.name).includes(wanted) || wanted.includes(normName(card.name))) score += 1;
        if (local && normId(card.localId) === normId(local)) score += 3;
        const official = card.set?.cardCount?.official;
        if (total && official && String(parseInt(total.replace(/\D/g, ''), 10)) === String(official)) score += 3;
        if (rec.set_code && card.set?.id && card.set.id.toLowerCase().includes(rec.set_code.toLowerCase())) score += 1;
        return { card, lang, score };
      }).sort((a, b) => b.score - a.score);
      if (scored.length) return scored;
    }
    return [];
  }

  // ---------- Zustand des Scans ----------
  const photos = [];   // {id, name, thumb, status: 'wait'|'run'|'done'|'error', message, found}
  const rows = [];     // {key, rec, candidates, chosen, qty, include, sources:Set, variant}
  let running = false;

  function rowKey(cardId, variant) { return cardId + '|' + variant; }

  function addRecognized(rec, candidates, photoId) {
    const best = candidates[0];
    const variant = rec.variant !== 'unknown' ? rec.variant : (best ? cardToDraft(best.card, best.lang).variant : 'normal');
    const count = Math.max(1, parseInt(rec.count, 10) || 1);
    if (best) {
      const key = rowKey(best.card.id, variant);
      const existing = rows.find((r) => r.key === key);
      if (existing) {
        existing.qty += count;
        existing.sources.add(photoId);
        if (rec.confidence === 'low') existing.low = true;
        return;
      }
      rows.push({ key, rec, candidates, chosen: 0, qty: count, include: true, sources: new Set([photoId]), variant, low: rec.confidence === 'low' });
    } else {
      rows.push({ key: 'x' + uid(), rec, candidates: [], chosen: -1, qty: count, include: false, sources: new Set([photoId]), variant, low: true });
    }
  }

  async function processQueue() {
    if (running) return;
    running = true;
    try {
      for (const ph of photos) {
        if (ph.status !== 'wait') continue;
        ph.status = 'run'; ph.message = 'Claude erkennt die Karten …'; renderScan();
        try {
          const { cards, notes } = await recognizePhoto(ph.base64);
          ph.message = `${cards.length} Karte(n) erkannt, gleiche mit Datenbank ab …`; renderScan();
          for (const rec of cards) {
            const candidates = await matchCard(rec);
            if (candidates[0]) candidates[0].card = await withImage(candidates[0].card);
            addRecognized(rec, candidates, ph.id);
            renderScan();
          }
          const n = cards.reduce((s, c) => s + (parseInt(c.count, 10) || 1), 0);
          ph.status = 'done';
          ph.message = n ? `${n} Karte(n) gefunden` : 'Keine Karte erkannt';
          if (notes) ph.message += ' · ' + notes;
          delete ph.base64; // Speicher freigeben
        } catch (err) {
          console.error(err);
          ph.status = 'error';
          ph.message = err.message || 'Fehler';
          if (err.code === 'auth' || err.code === 'no_key') {
            photos.filter((p) => p.status === 'wait').forEach((p) => { p.status = 'error'; p.message = 'Wartet auf gültigen API-Schlüssel'; });
          }
        }
        renderScan();
      }
    } finally {
      running = false;
      renderScan();
    }
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    if (!getKey()) { A.toast('Bitte zuerst den Claude-API-Schlüssel eintragen'); $('#scan-key').focus(); return; }
    for (const f of files) {
      const ph = { id: uid(), name: f.name, thumb: '', status: 'wait', message: 'Bereite Foto vor …' };
      photos.push(ph);
      renderScan();
      try {
        const { base64, thumb } = await fileToJpegBase64(f);
        ph.base64 = base64; ph.thumb = thumb; ph.message = 'In der Warteschlange';
      } catch (err) {
        console.error(err);
        ph.status = 'error'; ph.message = 'Dieses Bildformat kann der Browser nicht öffnen.';
      }
      renderScan();
    }
    processQueue();
  }

  // ---------- Darstellung ----------
  function renderPhotos() {
    $('#scan-photos').innerHTML = photos.map((p) => `
      <li class="scan-photo ${p.status}">
        ${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="ph-empty"></span>'}
        <div><div class="ph-status">${{ wait: 'Wartet', run: 'Läuft', done: 'Fertig', error: 'Fehler' }[p.status]}</div>
        <div class="hint" style="margin:0">${esc(p.message)}</div></div>
      </li>`).join('');
  }

  function rowCard(r) { return r.chosen >= 0 ? r.candidates[r.chosen] : null; }

  function renderRows() {
    const owned = A.ownedCountByCardId();
    const list = $('#scan-results');
    const matched = rows.filter((r) => rowCard(r));
    const unmatched = rows.filter((r) => !rowCard(r));
    const total = matched.filter((r) => r.include).reduce((s, r) => s + r.qty, 0);
    const value = matched.filter((r) => r.include).reduce((s, r) => {
      const c = rowCard(r); const p = pickPrice(c.card.pricing, r.variant); return s + (p ? p.value * r.qty : 0);
    }, 0);
    $('#scan-summary').innerHTML = rows.length ? `
      <div class="chip"><div class="k">Erkannt</div><div class="v">${total}</div></div>
      <div class="chip"><div class="k">Verschiedene</div><div class="v">${matched.filter((r) => r.include).length}</div></div>
      <div class="chip"><div class="k">Wert ca.</div><div class="v">${fmtEur(value)}</div></div>` : '';

    list.replaceChildren(...matched.map((r) => {
      const c = rowCard(r);
      const card = c.card;
      const p = pickPrice(card.pricing, r.variant);
      const have = owned[card.id] || 0;
      const li = document.createElement('li');
      li.className = 'scan-row' + (r.include ? '' : ' off');
      const variants = card.variants || {};
      li.innerHTML = `
        <label class="inc"><input type="checkbox" ${r.include ? 'checked' : ''} aria-label="Übernehmen"></label>
        <div class="thumb">${card.image ? `<img alt="" src="${esc(imageUrl(card.image))}">` : ''}</div>
        <div class="info">
          <div class="name">${esc(card.name)} ${r.low ? '<span class="pill warn">bitte prüfen</span>' : ''}</div>
          <div class="sub">${esc(card.set?.name || '')} · ${esc(card.localId)}${card.set?.cardCount?.official ? '/' + card.set.cardCount.official : ''}</div>
          <div class="sub">Auf dem Foto: „${esc(r.rec.name)}“ ${esc(r.rec.number || 'ohne Nummer')}${r.sources.size > 1 ? ` · auf ${r.sources.size} Fotos` : ''}</div>
          ${have ? `<div class="have">Schon ${have}× in der Sammlung – wird dazugezählt</div>` : ''}
          <div class="controls">
            <select class="variant" aria-label="Variante">${Object.entries(VARIANTS).filter(([k]) => !Object.keys(variants).length || variants[k] !== false || k === r.variant)
              .map(([k, v]) => `<option value="${k}" ${k === r.variant ? 'selected' : ''}>${v}</option>`).join('')}</select>
            ${r.candidates.length > 1 ? `<select class="alt" aria-label="Andere Karte wählen">${r.candidates.map((x, i) =>
              `<option value="${i}" ${i === r.chosen ? 'selected' : ''}>${esc(x.card.name)} – ${esc(x.card.set?.name || '')} ${esc(x.card.localId)}</option>`).join('')}</select>` : ''}
          </div>
        </div>
        <div class="qty">
          <button type="button" class="minus" aria-label="Weniger">−</button>
          <input type="number" min="1" value="${r.qty}" aria-label="Anzahl">
          <button type="button" class="plus" aria-label="Mehr">+</button>
          <div class="price">${p ? fmtEur(p.value) : '–'}</div>
        </div>`;
      const img = $('img', li); if (img) attachImgFallback(img);
      $('.inc input', li).addEventListener('change', (e) => { r.include = e.target.checked; renderRows(); });
      $('.qty input', li).addEventListener('change', (e) => { r.qty = Math.max(1, parseInt(e.target.value, 10) || 1); renderRows(); });
      $('.minus', li).addEventListener('click', () => { r.qty = Math.max(1, r.qty - 1); renderRows(); });
      $('.plus', li).addEventListener('click', () => { r.qty += 1; renderRows(); });
      $('.variant', li).addEventListener('change', (e) => { r.variant = e.target.value; renderRows(); });
      const alt = $('.alt', li);
      if (alt) alt.addEventListener('change', async (e) => {
        r.chosen = Number(e.target.value);
        r.candidates[r.chosen].card = await withImage(r.candidates[r.chosen].card);
        renderRows();
      });
      return li;
    }));

    const un = $('#scan-unmatched');
    un.hidden = !unmatched.length;
    $('#scan-unmatched-list').innerHTML = unmatched.map((r) => `
      <li><strong>${esc(r.rec.name)}</strong> ${esc(r.rec.number || '')} ×${r.qty} <span class="hint" style="margin:0">(${esc(r.rec.position || '')})</span>
        <button type="button" class="link" data-q="${esc(r.rec.name)}" data-n="${esc(splitNumber(r.rec.number).local)}">selbst suchen</button></li>`).join('');

    $('#scan-add').disabled = !matched.some((r) => r.include);
    $('#scan-add').textContent = total ? `${total} Karte${total === 1 ? '' : 'n'} zur Sammlung hinzufügen` : 'Zur Sammlung hinzufügen';
    $('#scan-clear').hidden = !rows.length && !photos.length;
  }

  function renderScan() {
    const hasKey = !!getKey();
    $('#scan-setup').hidden = hasKey;
    $('#scan-main').hidden = !hasKey;
    $('#scan-key-status').textContent = hasKey ? 'Ein Schlüssel ist auf diesem Gerät gespeichert (nur hier, nicht online).' : 'Noch kein Schlüssel gespeichert.';
    A.fillOwnerSelect($('#scan-owner'), { value: $('#scan-owner').value });
    renderPhotos();
    renderRows();
  }

  // ---------- Ereignisse ----------
  $('#scan-camera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#scan-files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#scan-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

  function saveKeyFrom(input) {
    const k = input.value.trim();
    if (!k) return;
    if (!/^sk-ant-/.test(k)) { A.toast('Das sieht nicht wie ein Claude-API-Schlüssel aus (beginnt mit sk-ant-)'); return; }
    setKey(k); input.value = ''; clientPromise = null;
    photos.filter((p) => p.status === 'error' && p.base64).forEach((p) => { p.status = 'wait'; p.message = 'In der Warteschlange'; });
    A.toast('API-Schlüssel gespeichert');
    renderScan();
    processQueue();
  }
  $('#scan-key-form').addEventListener('submit', (e) => { e.preventDefault(); saveKeyFrom($('#scan-key')); });
  $('#settings-key-form').addEventListener('submit', (e) => { e.preventDefault(); saveKeyFrom($('#settings-key')); });
  $('#settings-key-remove').addEventListener('click', () => { setKey(''); clientPromise = null; A.toast('API-Schlüssel entfernt'); renderScan(); });

  $('#scan-unmatched-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]');
    if (!b) return;
    A.showView('search');
    $('#search-q').value = b.dataset.q;
    $('#search-num').value = b.dataset.n;
    $('#search-form').requestSubmit();
  });

  $('#scan-clear').addEventListener('click', () => {
    if (running) { A.toast('Bitte warten, bis alle Fotos fertig sind'); return; }
    photos.length = 0; rows.length = 0; renderScan();
  });

  $('#scan-add').addEventListener('click', () => {
    const owner = $('#scan-owner').value;
    const condition = $('#scan-condition').value;
    let cards = 0, merged = 0;
    rows.filter((r) => r.include && rowCard(r)).forEach((r) => {
      const { card, lang } = rowCard(r);
      const d = cardToDraft(card, lang);
      const res = addOrMerge({
        id: uid(), ...d, variant: r.variant, owner, qty: r.qty, condition, cardLanguage: r.rec.card_language === 'en' ? 'en' : lang,
        grade: '', purchasePrice: null, manualValue: null, note: '', favorite: false, wishlist: false, rating: 0,
        price: pickPrice(card.pricing, r.variant), addedAt: new Date().toISOString(),
      });
      cards += r.qty; if (res.merged) merged++;
    });
    A.save();
    // Übernommene Zeilen entfernen, nicht erkannte stehen lassen
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].include && rowCard(rows[i])) rows.splice(i, 1);
    if (!running) for (let i = photos.length - 1; i >= 0; i--) if (photos[i].status === 'done') photos.splice(i, 1);
    A.toast(`${cards} Karte(n) eingetragen${merged ? `, davon ${merged} schon vorhandene aufgestockt` : ''}`);
    renderScan();
  });

  document.querySelectorAll('[data-view=scan], [data-view=settings]').forEach((el) => el.addEventListener('click', renderScan));
  renderScan();
})();
