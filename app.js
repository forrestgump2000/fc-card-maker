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
    photoZoom: 1, photoX: 0, photoY: 0,
  };
  let state = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem('fc-card-maker') || 'null');
    if (saved) state = { ...state, ...saved, stats: { ...state.stats, ...saved.stats }, show: { ...state.show, ...saved.show } };
  } catch (e) { /* storage unavailable */ }
  const images = { photo: null, badge: null };
  let frames = [];
  const { DEFAULT_LAYOUT } = window.FCCards;

  // ---------- on-device storage for imported cards (IndexedDB) ----------
  const DB = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('fc-card-maker', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('cards', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('cards', mode);
        const out = fn(t.objectStore('cards'));
        t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', s => s.getAll()); },
    put(rec) { return this.tx('readwrite', s => s.put(rec)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
  };
  const toRecord = (f) => ({ id: f.id, name: f.name, blob: f.blob, layout: f.layout, text: f.text, created: f.created });
  let saveTimer = 0;
  const saveFrame = (f) => {
    if (!f || !f.custom) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DB.put(toRecord(f)).catch(() => {}), 300);
  };

  // Shrink big camera-roll images and guess a readable text color.
  async function importCard(file, index) {
    const src = await loadImg(URL.createObjectURL(file));
    const max = 1400, s = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(src.naturalWidth * s); c.height = Math.round(src.naturalHeight * s);
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src.src);
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
  function draw() {
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
    const groups = ['My Cards', ...new Set(frames.filter(f => !f.custom).map(f => f.group || 'Cards'))];
    for (const g of groups) {
      const h = document.createElement('h2'); h.className = 'group-title'; h.textContent = g;
      const grid = document.createElement('div'); grid.className = 'design-grid';
      if (g === 'My Cards') {
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'design-tile add-tile';
        add.innerHTML = '<span class="plus">+</span><span class="design-name">Add card</span>';
        add.onclick = () => $('card-import').click();
        grid.append(add);
      }
      for (const f of frames.filter(x => (x.custom ? 'My Cards' : (x.group || 'Cards')) === g)) {
        const btn = document.createElement('button');
        btn.className = 'design-tile'; btn.type = 'button';
        const c = document.createElement('canvas');
        renderCard(c, f, sample, {}, 0.6, { placeholder: true });
        const label = document.createElement('span'); label.className = 'design-name'; label.textContent = f.name;
        btn.append(c, label);
        btn.addEventListener('click', () => openEditor(f.id));
        grid.append(btn);
      }
      root.append(h, grid);
      if (g === 'My Cards' && !frames.some(f => f.custom)) {
        const p = document.createElement('p'); p.className = 'hint';
        p.textContent = 'Tap "Add card" and pick card images from your photos. They stay saved on this device.';
        root.append(p);
      }
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

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function openEditor(id) {
    state.frameId = id;
    $('design-name').textContent = currentFrame().name;
    syncLayout();
    show('editor');
    draw();
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
    $('card-delete').onclick = async () => {
      const f = currentFrame(); if (!f || !f.custom) return;
      if (!confirm(`Delete "${f.name}" from this device?`)) return;
      frames = frames.filter(x => x !== f);
      try { await DB.del(f.id); } catch (e) {}
      state.frameId = null;
      buildMenu(); show('menu');
    };
    $('name').oninput = (e) => { state.name = e.target.value; draw(); };
    $('rating').oninput = (e) => { state.rating = clamp(e.target.value); $('rating-num').value = state.rating; draw(); };
    $('rating-num').onchange = (e) => { state.rating = clamp(e.target.value); syncControls(); draw(); };
    $('show-rating').onchange = (e) => { state.showRating = e.target.checked; syncControls(); draw(); };
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

    const imagePicker = (inputId, removeId, key, onSet) => {
      $(inputId).onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          images[key] = await loadImg(await readFile(file));
          $(removeId).hidden = false; onSet && onSet(true); draw();
        } catch (err) { alert('Sorry, that image could not be opened.'); }
        e.target.value = '';
      };
      $(removeId).onclick = () => { images[key] = null; $(removeId).hidden = true; onSet && onSet(false); draw(); };
    };
    imagePicker('photo-input', 'photo-remove', 'photo', (on) => {
      $('photo-adjust').hidden = !on;
      if (on) { state.photoZoom = 1; state.photoX = 0; state.photoY = 0; syncControls(); }
    });
    imagePicker('badge-input', 'badge-remove', 'badge');

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
    $('save').onclick = save; $('save-top').onclick = save;
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
    frames = loaded.filter(Boolean);
    try {
      const saved = (await DB.all()) || [];
      saved.sort((a, b) => a.created - b.created);
      for (const r of saved) {
        try { frames.push({ ...r, group: 'My Cards', custom: true, layout: r.layout || {}, img: await loadImg(URL.createObjectURL(r.blob)) }); } catch (e) {}
      }
    } catch (e) { /* storage unavailable: imported cards last for this visit only */ }
    buildMenu();
  }
  boot();
})();
