(() => {
  const { STAT_KEYS, STAT_LABELS, GK_LABELS, renderCard } = window.FCCards;
  const $ = (id) => document.getElementById(id);

  const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

  const COUNTRY_CODES = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI XK KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW CW FO GI GP MQ NC GF').split(' ');

  const regionFlag = (cc) => String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
  const subFlag = (tag) => String.fromCodePoint(0x1f3f4, ...[...tag].map(c => 0xe0000 + c.charCodeAt(0)), 0xe007f);

  let regionNames;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { regionNames = null; }
  const COUNTRIES = COUNTRY_CODES
    .map(cc => ({ name: (regionNames && regionNames.of(cc)) || cc, flag: regionFlag(cc) }))
    .concat([
      { name: 'England', flag: subFlag('gbeng') },
      { name: 'Scotland', flag: subFlag('gbsct') },
      { name: 'Wales', flag: subFlag('gbwls') },
      { name: 'Northern Ireland', flag: regionFlag('GB') },
    ])
    .sort((a, b) => a.name.localeCompare(b.name));

  const TEAMS = ['Arsenal', 'Aston Villa', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Newcastle United', 'Tottenham Hotspur',
    'Real Madrid', 'Barcelona', 'Atlético Madrid', 'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'Paris Saint-Germain', 'Marseille',
    'Juventus', 'Inter', 'AC Milan', 'Napoli', 'Roma', 'Benfica', 'Porto', 'Sporting CP', 'Ajax', 'PSV', 'Feyenoord', 'Celtic', 'Rangers',
    'Al Nassr', 'Al Hilal', 'Inter Miami', 'LA Galaxy', 'Boca Juniors', 'River Plate', 'Flamengo', 'Santos'];

  // ---------- state ----------
  const defaults = {
    frameId: null, name: '', rating: 88, showRating: true, position: 'ST', country: '', team: '',
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, 80])),
    show: Object.fromEntries(STAT_KEYS.map(k => [k, true])),
    photoZoom: 1, photoX: 0, photoY: 0, autoRating: true,
  };
  let state = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem('fc-card-maker') || 'null');
    if (saved) state = { ...state, ...saved, stats: { ...state.stats, ...saved.stats }, show: { ...state.show, ...saved.show } };
  } catch (e) { /* storage unavailable */ }
  const images = { photo: null, badge: null };
  const photos = { original: null, cutout: null };
  let frames = [];
  const { DEFAULT_LAYOUT } = window.FCCards;

  // ---------- on-device storage for imported cards (IndexedDB) ----------
  // 'cards' = imported card designs, 'players' = finished player cards saved with the top Save button
  const makeStore = (name) => ({
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('fc-card-maker', 2);
        r.onupgradeneeded = () => {
          for (const s of ['cards', 'players']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(name, mode);
        const out = fn(t.objectStore(name));
        t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', s => s.getAll()); },
    put(rec) { return this.tx('readwrite', s => s.put(rec)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
  });
  const DB = makeStore('cards');
  const PlayersDB = makeStore('players');
  let players = []; // { id, frameId, data, photo, badge, photoCutout, created, photoImg, badgeImg }
  let savedId = null; // which saved player card is open in the editor (null = new)
  const toRecord = (f) => ({ id: f.id, name: f.name, blob: f.blob, layout: f.layout, text: f.text, created: f.created });
  let saveTimer = 0;
  const saveFrame = (f) => {
    if (!f || !f.custom) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DB.put(toRecord(f)).catch(() => {}), 300);
  };

  // ---------- automatic background removal for player photos ----------
  // MODNet portrait matting, running in the browser (free, no account needed).
  const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js';
  let modnetPromise = null;
  function getModnet() {
    if (!modnetPromise) {
      modnetPromise = (async () => {
        const t = await import(TJS);
        const [model, processor] = await Promise.all([
          t.AutoModel.from_pretrained('Xenova/modnet', { dtype: 'fp32' }),
          t.AutoProcessor.from_pretrained('Xenova/modnet'),
        ]);
        return { t, model, processor };
      })();
      modnetPromise.catch(() => { modnetPromise = null; });
    }
    return modnetPromise;
  }

  function photoCanvas(img, max) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  async function viaModnet(img) {
    const { t, model, processor } = await getModnet();
    const c = photoCanvas(img, 1024);
    const raw = t.RawImage.fromCanvas(c);
    const { pixel_values } = await processor(raw);
    const { output } = await model({ input: pixel_values });
    const mask = await t.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(c.width, c.height);
    const x = c.getContext('2d', { willReadFrequently: true });
    const px = x.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < mask.data.length; i++) px.data[i * 4 + 3] = mask.data[i];
    x.putImageData(px, 0, 0);
    return c;
  }

  // Returns a new image of just the person, cropped tight, with a transparent background.
  async function removeBackground(img) {
    let c;
    c = await viaModnet(img);
    const x = c.getContext('2d', { willReadFrequently: true });

    // crop to the person
    const px = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 2) for (let xx = 0; xx < c.width; xx += 2) {
      if (px[(y * c.width + xx) * 4 + 3] > 60) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error('no person found');
    const pad = Math.round(Math.max(c.width, c.height) * 0.02);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    const result = await loadImg(URL.createObjectURL(blob));
    result.cutout = true;
    return result;
  }

  // Cut a card out of a screenshot: clear the plain background touching the edges, then trim.
  function cutOutCard(c) {
    const x = c.getContext('2d', { willReadFrequently: true });
    const W = c.width, H = c.height;
    const id = x.getImageData(0, 0, W, H), d = id.data;
    const at = (i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]];
    const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(at);
    const opaqueCorners = corners.filter(p => p[3] > 200);
    if (opaqueCorners.length >= 3) {
      const seen = new Uint8Array(W * H);
      const stack = [];
      for (let xx = 0; xx < W; xx++) { stack.push(xx, (H - 1) * W + xx); }
      for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
      const tol = 42;
      const near = (i) => {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        return opaqueCorners.some(p => Math.abs(r - p[0]) + Math.abs(g - p[1]) + Math.abs(b - p[2]) < tol * 3 && Math.max(Math.abs(r - p[0]), Math.abs(g - p[1]), Math.abs(b - p[2])) < tol);
      };
      while (stack.length) {
        const i = stack.pop();
        if (seen[i]) continue; seen[i] = 1;
        if (d[i * 4 + 3] < 20 || near(i)) {
          d[i * 4 + 3] = 0;
          const xx = i % W, y = (i / W) | 0;
          if (xx > 0) stack.push(i - 1); if (xx < W - 1) stack.push(i + 1);
          if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
        }
      }
      x.putImageData(id, 0, 0);
    }
    // trim transparent edges
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      if (d[(y * W + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0 || (x1 - x0) < W * 0.2 || (y1 - y0) < H * 0.2) return c; // didn't find a card, keep as is
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // Shrink big camera-roll images, cut the card out, and guess a readable text color.
  async function importCard(file, index) {
    const src = await loadImg(URL.createObjectURL(file));
    const max = 1400, s = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
    let c = document.createElement('canvas');
    c.width = Math.round(src.naturalWidth * s); c.height = Math.round(src.naturalHeight * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src.src);
    c = cutOutCard(c);
    const x = c.getContext('2d', { willReadFrequently: true });
    let lum = 0, n = 0;
    try {
      const px = x.getImageData(Math.round(c.width * 0.15), Math.round(c.height * 0.6), Math.round(c.width * 0.7), Math.round(c.height * 0.25)).data;
      for (let i = 0; i < px.length; i += 16) { if (px[i + 3] > 100) { lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; n++; } }
    } catch (e) {}
    const text = n && lum / n > 150 ? '#1b1b1b' : '#ffffff';
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const count = frames.filter(f => f.custom).length + 1;
    const f = {
      id: 'c' + Date.now().toString(36) + index, name: `Card ${count}`, group: 'My Cards', custom: true,
      blob, text, layout: {}, created: Date.now(),
    };
    f.img = await loadImg(URL.createObjectURL(blob));
    frames.push(f);
    try { await DB.put(toRecord(f)); } catch (e) {}
    return f;
  }

  const persist = () => { try { localStorage.setItem('fc-card-maker', JSON.stringify(state)); } catch (e) {} };
  const clamp = (v) => Math.min(99, Math.max(45, Math.round(Number(v) || 45)));
  const currentFrame = () => frames.find(f => f.id === state.frameId) || frames[0];
  const cardData = () => ({
    ...state,
    flag: (COUNTRIES.find(c => c.name === state.country) || {}).flag || '',
  });

  // ---------- rendering ----------
  let raf = 0;
  // Overall rating built from the six stats, weighted by position (like real player ratings).
  const WEIGHTS = {
    ST: [.20, .35, .10, .20, 0, .15], CF: [.15, .30, .15, .30, 0, .10],
    LW: [.25, .20, .20, .30, 0, .05], RW: [.25, .20, .20, .30, 0, .05],
    LM: [.25, .15, .25, .25, .05, .05], RM: [.25, .15, .25, .25, .05, .05],
    CAM: [.10, .20, .30, .30, 0, .10], CM: [.05, .10, .35, .25, .15, .10],
    CDM: [.05, 0, .25, .10, .35, .25], CB: [.10, 0, .05, .05, .50, .30],
    LB: [.25, 0, .20, .10, .30, .15], RB: [.25, 0, .20, .10, .30, .15],
    LWB: [.25, 0, .20, .15, .25, .15], RWB: [.25, 0, .20, .15, .25, .15],
    GK: [.22, .22, .08, .25, .03, .20],
  };
  function calcOverall() {
    const w = WEIGHTS[state.position] || [1, 1, 1, 1, 1, 1];
    let sum = 0, tot = 0;
    STAT_KEYS.forEach((k, i) => { if (state.show[k]) { sum += state.stats[k] * w[i]; tot += w[i]; } });
    if (!tot) { // only zero-weight stats showing: plain average of what's shown
      const vis = STAT_KEYS.filter(k => state.show[k]);
      if (!vis.length) return state.rating;
      return clamp(vis.reduce((a, k) => a + state.stats[k], 0) / vis.length);
    }
    return clamp(sum / tot);
  }

  function draw() {
    if (state.autoRating) {
      state.rating = calcOverall();
      $('rating').value = state.rating; $('rating-num').value = state.rating;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const f = currentFrame();
      if (f) renderCard($('preview'), f, cardData(), images, 2, { placeholder: true });
    });
    persist();
  }

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

  // ---------- menu ----------
  function buildMenu() {
    const root = $('design-groups');
    root.innerHTML = '';
    const sample = {
      ...defaults, name: 'Your Name', rating: 88, position: 'ST', flag: '', team: '',
      stats: { pac: 91, sho: 88, pas: 82, dri: 90, def: 45, phy: 78 },
    };
    const groups = [...new Set(frames.filter(f => !f.custom).map(f => f.group || 'Cards')), 'My Cards'];
    for (const g of groups) {
      const h = document.createElement('h2'); h.className = 'group-title'; h.textContent = g;
      const grid = document.createElement('div'); grid.className = 'design-grid';
      if (g === 'My Cards') {
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'design-tile add-tile';
        add.innerHTML = '<span class="plus">+</span><span class="design-name">Add card</span>';
        add.onclick = () => $('card-import').click();
        grid.append(add);
        for (const p of players) {
          const f = frames.find(x => x.id === p.frameId) || frames[0];
          if (!f) continue;
          const btn = document.createElement('button');
          btn.className = 'design-tile'; btn.type = 'button';
          const c = document.createElement('canvas');
          renderCard(c, f, playerData(p.data), { photo: p.photoImg, badge: p.badgeImg }, 0.6);
          const label = document.createElement('span'); label.className = 'design-name';
          label.textContent = p.data.name || 'No name';
          btn.append(c, label);
          btn.addEventListener('click', () => openPlayer(p));
          const wrap = document.createElement('div'); wrap.className = 'tile-wrap';
          const del = document.createElement('button');
          del.type = 'button'; del.className = 'tile-delete'; del.textContent = '×';
          del.setAttribute('aria-label', `Delete ${label.textContent}`);
          del.addEventListener('click', (e) => { e.stopPropagation(); deletePlayer(p); });
          wrap.append(btn, del);
          grid.append(wrap);
        }
      }
      for (const f of frames.filter(x => !hiddenCards.includes(x.id) && (x.custom ? 'My Cards' : (x.group || 'Cards')) === g)) {
        const btn = document.createElement('button');
        btn.className = 'design-tile'; btn.type = 'button';
        const c = document.createElement('canvas');
        renderCard(c, f, sample, {}, 0.6, { placeholder: true });
        const label = document.createElement('span'); label.className = 'design-name'; label.textContent = f.name;
        btn.append(c, label);
        btn.addEventListener('click', () => openEditor(f.id));
        const wrap = document.createElement('div'); wrap.className = 'tile-wrap';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'tile-delete'; del.textContent = '×';
        del.setAttribute('aria-label', `Delete ${f.name}`);
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteCard(f); });
        wrap.append(btn, del);
        grid.append(wrap);
      }
      root.append(h, grid);
      if (g === 'My Cards' && !frames.some(f => f.custom) && !players.length) {
        const p = document.createElement('p'); p.className = 'hint';
        p.textContent = 'Cards you save with the Save button show up here. Tap "Add card" to use card images from your photos.';
        root.append(p);
      }
    }
    if (hiddenCards.length) {
      const restore = document.createElement('button');
      restore.type = 'button'; restore.className = 'ghost wide';
      restore.textContent = `Bring back deleted built-in cards (${hiddenCards.length})`;
      restore.onclick = () => { hiddenCards = []; saveHidden(hiddenCards); buildMenu(); };
      root.append(restore);
    }
    const credits = frames.filter(f => f.credit);
    if (credits.length) {
      const box = document.createElement('div'); box.className = 'credits';
      box.innerHTML = '<h3>Card frame credits</h3>';
      const ul = document.createElement('ul');
      for (const f of credits) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = f.creditUrl || '#'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = f.credit;
        li.append(`${f.name}: `, a);
        ul.append(li);
      }
      box.append(ul);
      root.append(box);
    }
  }

  // Deleting: imported cards are removed from this device; built-in cards are hidden (and can be brought back).
  const loadHidden = () => { try { return JSON.parse(localStorage.getItem('fc-hidden') || '[]'); } catch (e) { return []; } };
  const saveHidden = (list) => { try { localStorage.setItem('fc-hidden', JSON.stringify(list)); } catch (e) {} };
  let hiddenCards = [];
  async function deleteCard(f) {
    if (!confirm(`Delete "${f.name}"?`)) return;
    if (f.custom) {
      frames = frames.filter(x => x !== f);
      try { await DB.del(f.id); } catch (e) {}
    } else {
      hiddenCards = [...new Set([...hiddenCards, f.id])]; saveHidden(hiddenCards);
    }
    if (state.frameId === f.id) state.frameId = null;
    buildMenu(); show('menu');
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function openEditor(id) {
    state.frameId = id;
    savedId = null;
    $('design-name').textContent = currentFrame().name;
    syncLayout();
    show('editor');
    draw();
  }

  const flagFor = (country) => (COUNTRIES.find(c => c.name === country) || {}).flag || '';
  const playerData = (d) => ({ ...d, flag: flagFor(d.country) });
  const imgBlob = async (img) => img ? (await fetch(img.src)).blob() : null;

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // Top-right Save: keep the finished card in My Cards (saving again updates it).
  async function savePlayer() {
    const f = currentFrame(); if (!f) return;
    const id = savedId || 'p' + Date.now().toString(36);
    const existing = players.find(p => p.id === id);
    const data = structuredClone(state); delete data.frameId;
    const rec = {
      id, frameId: f.id, data,
      photo: await imgBlob(images.photo), photoCutout: !!(images.photo && images.photo.cutout),
      badge: await imgBlob(images.badge),
      created: existing ? existing.created : Date.now(),
    };
    try { await PlayersDB.put(rec); } catch (e) { /* storage unavailable: kept for this visit */ }
    const live = { ...rec, photoImg: images.photo, badgeImg: images.badge };
    if (existing) players[players.indexOf(existing)] = live; else players.unshift(live);
    savedId = id;
    buildMenu();
    toast(existing ? 'Updated in My Cards' : 'Saved to My Cards');
  }

  function openPlayer(p) {
    state = { ...structuredClone(defaults), ...structuredClone(p.data), frameId: p.frameId };
    if (!frames.some(f => f.id === state.frameId)) state.frameId = frames[0] && frames[0].id;
    savedId = p.id;
    images.photo = p.photoImg || null; images.badge = p.badgeImg || null;
    photos.original = images.photo; photos.cutout = null;
    $('photo-remove').hidden = !images.photo; $('photo-adjust').hidden = !images.photo;
    $('photo-cutout-row').hidden = true; $('photo-status').hidden = true;
    $('badge-remove').hidden = !images.badge;
    syncControls();
    $('design-name').textContent = currentFrame().name;
    syncLayout();
    show('editor');
    draw();
  }

  async function deletePlayer(p) {
    if (!confirm(`Delete "${p.data.name || 'this card'}"?`)) return;
    players = players.filter(x => x !== p);
    try { await PlayersDB.del(p.id); } catch (e) {}
    if (savedId === p.id) savedId = null;
    buildMenu();
  }

  function syncLayout() {
    const f = currentFrame(); if (!f) return;
    const L = { ...DEFAULT_LAYOUT, ...f.layout };
    const P = { ...DEFAULT_LAYOUT.photo, ...(f.layout.photo || {}) };
    $('card-name').value = f.name;
    $('lay-color').value = f.text || '#ffffff';
    $('lay-scale').value = L.scale;
    $('lay-shift').value = L.shiftY || 0;
    $('lay-col').value = L.col;
    $('lay-photo-y').value = P.y;
    $('lay-photo-size').value = P.h;
    $('layout-box').hidden = !f.custom;
  }

  // ---------- controls ----------
  function buildControls() {
    $('position').innerHTML = '<option value="">None</option>' + POSITIONS.map(p => `<option>${p}</option>`).join('');
    $('country').innerHTML = '<option value="">None</option>' + COUNTRIES.map(c => `<option value="${c.name}">${c.flag} ${c.name}</option>`).join('');
    $('teams').innerHTML = TEAMS.map(t => `<option value="${t}">`).join('');

    const stats = $('stats');
    STAT_KEYS.forEach((k, i) => {
      const row = document.createElement('div');
      row.className = 'stat-row'; row.dataset.key = k;
      row.innerHTML = `
        <label class="toggle"><input type="checkbox" class="st-show" /> <span class="st-label">${STAT_LABELS[i]}</span></label>
        <input type="range" min="45" max="99" class="st-range" aria-label="${STAT_LABELS[i]}" />
        <input type="number" min="45" max="99" inputmode="numeric" class="st-num" aria-label="${STAT_LABELS[i]} value" />`;
      stats.append(row);
    });
  }

  function syncControls() {
    $('name').value = state.name;
    $('rating').value = state.rating; $('rating-num').value = state.rating;
    $('show-rating').checked = state.showRating;
    $('auto-rating').checked = state.autoRating;
    $('rating').disabled = $('rating-num').disabled = state.autoRating;
    $('rating').closest('.stat-row').classList.toggle('off', !state.showRating);
    $('position').value = state.position;
    $('country').value = state.country;
    $('team').value = state.team;
    $('photo-zoom').value = state.photoZoom; $('photo-x').value = state.photoX; $('photo-y').value = state.photoY;
    const labels = state.position === 'GK' ? GK_LABELS : STAT_LABELS;
    document.querySelectorAll('#stats .stat-row').forEach((row, i) => {
      const k = row.dataset.key;
      row.querySelector('.st-show').checked = state.show[k];
      row.querySelector('.st-range').value = state.stats[k];
      row.querySelector('.st-num').value = state.stats[k];
      row.querySelector('.st-label').textContent = labels[i];
      row.classList.toggle('off', !state.show[k]);
    });
  }

  function wire() {
    $('back').onclick = () => { buildMenu(); show('menu'); };

    // import cards
    $('card-import').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      if (!files.length) return;
      let last = null;
      for (const [i, file] of files.entries()) {
        try { last = await importCard(file, i); } catch (err) { alert(`Sorry, "${file.name}" could not be opened.`); }
      }
      buildMenu();
      if (last && files.length === 1) openEditor(last.id);
    };

    // per-card layout
    const editLayout = (fn) => { const f = currentFrame(); if (!f || !f.custom) return; fn(f); saveFrame(f); draw(); };
    $('card-name').oninput = (e) => editLayout(f => { f.name = e.target.value || 'Card'; $('design-name').textContent = f.name; });
    $('lay-color').oninput = (e) => editLayout(f => { f.text = e.target.value; });
    $('lay-scale').oninput = (e) => editLayout(f => { f.layout.scale = Number(e.target.value); });
    $('lay-shift').oninput = (e) => editLayout(f => { f.layout.shiftY = Number(e.target.value); });
    $('lay-col').oninput = (e) => editLayout(f => { f.layout.col = Number(e.target.value); });
    const setPhoto = (f) => {
      const h = Number($('lay-photo-size').value);
      const w = Math.min(0.95, h * 1.24);
      f.layout.photo = { x: Math.min(0.98 - w, Math.max(0.02, 0.62 - w / 2)), y: Number($('lay-photo-y').value), w, h };
    };
    $('lay-photo-y').oninput = () => editLayout(setPhoto);
    $('lay-photo-size').oninput = () => editLayout(setPhoto);
    $('lay-reset').onclick = () => editLayout(f => { f.layout = {}; syncLayout(); });
    $('card-delete').onclick = () => { const f = currentFrame(); if (f) deleteCard(f); };
    $('name').oninput = (e) => { state.name = e.target.value; draw(); };
    $('rating').oninput = (e) => { state.rating = clamp(e.target.value); $('rating-num').value = state.rating; draw(); };
    $('rating-num').onchange = (e) => { state.rating = clamp(e.target.value); syncControls(); draw(); };
    $('show-rating').onchange = (e) => { state.showRating = e.target.checked; syncControls(); draw(); };
    $('auto-rating').onchange = (e) => { state.autoRating = e.target.checked; syncControls(); draw(); };
    $('position').onchange = (e) => { state.position = e.target.value; syncControls(); draw(); };
    $('country').onchange = (e) => { state.country = e.target.value; draw(); };
    $('team').oninput = (e) => { state.team = e.target.value; draw(); };
    for (const [id, key] of [['photo-zoom', 'photoZoom'], ['photo-x', 'photoX'], ['photo-y', 'photoY']]) {
      $(id).oninput = (e) => { state[key] = Number(e.target.value); draw(); };
    }

    $('stats').addEventListener('input', (e) => {
      const row = e.target.closest('.stat-row'); if (!row) return;
      const k = row.dataset.key;
      if (e.target.classList.contains('st-range')) {
        state.stats[k] = clamp(e.target.value);
        row.querySelector('.st-num').value = state.stats[k];
      } else if (e.target.classList.contains('st-show')) {
        state.show[k] = e.target.checked; row.classList.toggle('off', !state.show[k]);
      } else return;
      draw();
    });
    $('stats').addEventListener('change', (e) => {
      if (!e.target.classList.contains('st-num')) return;
      const k = e.target.closest('.stat-row').dataset.key;
      state.stats[k] = clamp(e.target.value); syncControls(); draw();
    });
    $('randomize').onclick = () => {
      STAT_KEYS.forEach(k => { state.stats[k] = 45 + Math.floor(Math.random() * 55); });
      syncControls(); draw();
    };

    // player photo: background removed automatically
    const usePhoto = () => {
      images.photo = $('photo-cutout').checked && photos.cutout ? photos.cutout : photos.original;
      draw();
    };
    $('photo-input').onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      try {
        photos.original = await loadImg(await readFile(file));
      } catch (err) { alert('Sorry, that photo could not be opened.'); return; }
      photos.cutout = null;
      state.photoZoom = 1; state.photoX = 0; state.photoY = 0; syncControls();
      $('photo-remove').hidden = false; $('photo-adjust').hidden = false; $('photo-cutout-row').hidden = false;
      usePhoto();
      const status = $('photo-status');
      status.textContent = 'Removing background…'; status.hidden = false;
      try {
        const original = photos.original;
        const cut = await removeBackground(original);
        if (photos.original === original) { photos.cutout = cut; status.hidden = true; usePhoto(); }
      } catch (err) {
        console.error(err);
        status.textContent = 'Could not remove the background on this device.';
      }
    };
    $('photo-cutout').onchange = usePhoto;
    $('photo-remove').onclick = () => {
      photos.original = photos.cutout = null; images.photo = null;
      $('photo-remove').hidden = true; $('photo-adjust').hidden = true; $('photo-cutout-row').hidden = true; $('photo-status').hidden = true;
      draw();
    };
    // team badge: clear the plain background around the logo and trim it tight
    $('badge-input').onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      try {
        const src = await loadImg(await readFile(file));
        const max = 600, s = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
        let c = document.createElement('canvas');
        c.width = Math.round(src.naturalWidth * s); c.height = Math.round(src.naturalHeight * s);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        c = cutOutCard(c);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        images.badge = await loadImg(URL.createObjectURL(blob));
        $('badge-remove').hidden = false; draw();
      } catch (err) { alert('Sorry, that image could not be opened.'); }
    };
    $('badge-remove').onclick = () => { images.badge = null; $('badge-remove').hidden = true; draw(); };

    const save = async () => {
      const f = currentFrame(); if (!f) return;
      const c = document.createElement('canvas');
      renderCard(c, f, cardData(), images, 3, { placeholder: false });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const fname = `${(state.name || 'fc-card').trim().replace(/[^\w-]+/g, '-').toLowerCase() || 'fc-card'}.png`;
      const file = new File([blob], fname, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file], title: 'My FC Card' }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('save').onclick = save; $('save-top').onclick = savePlayer;
  }

  // ---------- boot ----------
  async function boot() {
    buildControls(); syncControls(); wire();
    try {
      await Promise.all([document.fonts.load(`700 40px Oswald`), document.fonts.load(`500 40px Oswald`), document.fonts.load(`400 40px Oswald`)]);
    } catch (e) {}
    let list = [];
    try { list = await (await fetch('/frames/frames.json', { cache: 'no-cache' })).json(); } catch (e) {}
    const loaded = await Promise.all(list.map(async (f) => {
      try { return { ...f, img: await loadImg('/frames/' + f.file) }; } catch (e) { return null; }
    }));
    hiddenCards = loadHidden();
    frames = [...window.FCCards.builtInFrames(), ...loaded.filter(Boolean)];
    try {
      const saved = (await DB.all()) || [];
      saved.sort((a, b) => a.created - b.created);
      for (const r of saved) {
        try { frames.push({ ...r, group: 'My Cards', custom: true, layout: r.layout || {}, img: await loadImg(URL.createObjectURL(r.blob)) }); } catch (e) {}
      }
    } catch (e) { /* storage unavailable: imported cards last for this visit only */ }
    try {
      const saved = (await PlayersDB.all()) || [];
      saved.sort((a, b) => b.created - a.created);
      for (const r of saved) {
        const p = { ...r };
        try {
          if (r.photo) { p.photoImg = await loadImg(URL.createObjectURL(r.photo)); p.photoImg.cutout = r.photoCutout; }
          if (r.badge) p.badgeImg = await loadImg(URL.createObjectURL(r.badge));
        } catch (e) {}
        players.push(p);
      }
    } catch (e) { /* storage unavailable */ }
    buildMenu();
  }
  boot();
})();
