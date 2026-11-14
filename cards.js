// Card renderer for FC Card Maker.
// Card backgrounds are licensed frame images listed in /frames/frames.json.
// Everything on top (photo, rating, name, stats...) is laid out here.

const CARD_W = 600; // render width; height follows the frame's aspect ratio

const STAT_KEYS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
const STAT_LABELS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const GK_LABELS = ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'];

const FONT = '"Oswald", "Arial Narrow", sans-serif';
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// Default positions as fractions of the card's width (x) and height (y).
// Each frame in frames.json can override any of these under "layout".
const DEFAULT_LAYOUT = {
  photo: { x: 0.30, y: 0.12, w: 0.62, h: 0.50 }, // box the player photo fills
  col: 0.25,         // x of the left column (rating, position, flag, badge)
  top: 0.15,         // y where the left column starts
  name: 0.665,       // y of the name baseline
  statLabel: 0.735,  // y of stat labels
  statValue: 0.795,  // y of stat values
  statLeft: 0.10, statRight: 0.90,
  team: 0.87,        // y of the team name
  scale: 1,          // multiply all text sizes
};

function hexA(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fitFont(ctx, text, weight, size, maxW) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 12) {
    s -= 1; ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

function drawPhoto(ctx, img, box, data, color, placeholder) {
  const off = document.createElement('canvas');
  off.width = Math.round(box.w * 2); off.height = Math.round(box.h * 2);
  const o = off.getContext('2d');
  o.scale(2, 2);
  if (img) {
    const zoom = data.photoZoom || 1;
    // cut-out players fit fully inside the box (head at the top); normal photos fill it
    // cut-outs: fill the box width so head and shoulders sit big at the top; anything below fades out
    const fit = img.cutout ? Math.max(Math.min(box.w / img.width, box.h / img.height), (box.w * 0.85) / img.width) : Math.max(box.w / img.width, box.h / img.height);
    const s = fit * zoom;
    const w = img.width * s, h = img.height * s;
    const baseY = img.cutout ? box.h * 0.02 : (box.h - h) / 2;
    o.drawImage(img,
      (box.w - w) / 2 + (data.photoX || 0) * box.w * 0.5,
      baseY + (data.photoY || 0) * box.h * 0.5, w, h);
  } else return;
  // soften the bottom edge so the photo blends into the card above the name
  o.globalCompositeOperation = 'destination-in';
  const gv = o.createLinearGradient(0, 0, 0, box.h);
  gv.addColorStop(0, '#000'); gv.addColorStop(0.82, '#000'); gv.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = gv; o.fillRect(0, 0, box.w, box.h);
  ctx.drawImage(off, box.x, box.y, box.w, box.h);
}

function drawCrest(ctx, team, badge, cx, cy, size, color) {
  if (badge) {
    const s = Math.min(size / badge.width, size / badge.height);
    ctx.drawImage(badge, cx - (badge.width * s) / 2, cy - (badge.height * s) / 2, badge.width * s, badge.height * s);
    return;
  }
  const initials = team.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.8, cy - r); ctx.lineTo(cx + r * 0.8, cy - r); ctx.lineTo(cx + r * 0.8, cy + r * 0.15);
  ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.75, cx, cy + r * 1.05);
  ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.75, cx - r * 0.8, cy + r * 0.15);
  ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = size * 0.05; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  fitFont(ctx, initials, 700, size * 0.32, size * 0.62);
  ctx.fillText(initials, cx, cy + size * 0.02);
  ctx.restore();
}

/**
 * frame: { img, text, layout } — img is a loaded HTMLImageElement
 * data:  { name, rating, showRating, position, flag, team, stats, show, photoZoom, photoX, photoY }
 * images: { photo, badge }
 */
function renderCard(canvas, frame, data, images = {}, scale = 1, opts = {}) {
  const img = frame.img;
  const W = CARD_W, H = Math.round(CARD_W * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const L = { ...DEFAULT_LAYOUT, ...(frame.layout || {}) };
  L.photo = { ...DEFAULT_LAYOUT.photo, ...((frame.layout || {}).photo || {}) };
  const sy = L.shiftY || 0;
  L.top += sy; L.name += sy; L.statLabel += sy; L.statValue += sy; L.team += sy;
  const color = frame.text || '#ffffff';
  const k = (W / 600) * L.scale;

  ctx.drawImage(img, 0, 0, W, H);

  const box = { x: L.photo.x * W, y: L.photo.y * H, w: L.photo.w * W, h: L.photo.h * H };
  if (images.photo) {
    // draw the photo on its own layer, then keep it only where the card itself is
    // (so it never spills past the card's outline), and inset slightly from the border
    const layer = document.createElement('canvas');
    layer.width = canvas.width; layer.height = canvas.height;
    const lc = layer.getContext('2d');
    lc.setTransform(scale, 0, 0, scale, 0, 0);
    drawPhoto(lc, images.photo, box, data, color);
    lc.globalCompositeOperation = 'destination-in';
    const inset = W * 0.035;
    lc.drawImage(img, inset, inset * (H / W), W - inset * 2, H - inset * 2 * (H / W));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (frame.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6 * k; ctx.shadowOffsetY = 2 * k; }

  const colX = L.col * W;
  let y = L.top * H;
  if (data.showRating) {
    ctx.font = `700 ${96 * k}px ${FONT}`;
    ctx.fillText(String(data.rating), colX, y + 88 * k);
    y += 98 * k;
  }
  if (data.position) {
    ctx.font = `500 ${38 * k}px ${FONT}`;
    ctx.fillText(data.position, colX, y + 38 * k);
    y += 52 * k;
  }
  if (data.flag) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.font = `${46 * k}px ${EMOJI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(data.flag, colX, y + 30 * k);
    ctx.restore();
    y += 64 * k;
  }
  if (data.team || images.badge) {
    drawCrest(ctx, data.team || '', images.badge, colX, y + 32 * k, 60 * k, color);
  }

  const name = (data.name || '').trim().toUpperCase();
  if (name) {
    fitFont(ctx, name, 700, 52 * k, W * 0.78);
    ctx.fillText(name, W / 2, L.name * H);
  }

  const labels = data.position === 'GK' ? GK_LABELS : STAT_LABELS;
  const vis = STAT_KEYS.map((key, i) => ({ key, label: labels[i] })).filter(s => data.show[s.key]);
  if (vis.length) {
    const left = L.statLeft * W, width = (L.statRight - L.statLeft) * W;
    vis.forEach((s, i) => {
      const x = left + (i + 0.5) * (width / vis.length);
      ctx.font = `400 ${22 * k}px ${FONT}`;
      ctx.fillText(s.label, x, L.statLabel * H);
      ctx.font = `700 ${44 * k}px ${FONT}`;
      ctx.fillText(String(data.stats[s.key]), x, L.statValue * H);
    });
  }

  if (data.team) {
    const t = data.team.toUpperCase();
    ctx.globalAlpha = 0.85;
    fitFont(ctx, t, 500, 20 * k, W * 0.55);
    ctx.fillText(t, W / 2, L.team * H);
  }
  ctx.restore();
  return canvas;
}

// ---------- built-in shield cards ----------
// Shield silhouette: crest notch on top, curled corners, straight sides, pointed base.
function shieldPath(c, k = 1) {
  c.save();
  c.translate(300, 430); c.scale(k, k); c.translate(-300, -430);
  c.beginPath();
  c.moveTo(78, 62);
  c.lineTo(250, 62);
  c.quadraticCurveTo(266, 62, 276, 50);
  c.lineTo(300, 26);
  c.lineTo(324, 50);
  c.quadraticCurveTo(334, 62, 350, 62);
  c.lineTo(522, 62);
  c.bezierCurveTo(548, 62, 562, 48, 570, 30);
  c.bezierCurveTo(590, 58, 588, 92, 578, 116);
  c.lineTo(572, 642);
  c.quadraticCurveTo(570, 700, 516, 728);
  c.lineTo(334, 810);
  c.quadraticCurveTo(300, 826, 266, 810);
  c.lineTo(84, 728);
  c.quadraticCurveTo(30, 700, 28, 642);
  c.lineTo(22, 116);
  c.bezierCurveTo(12, 92, 10, 58, 30, 30);
  c.bezierCurveTo(38, 48, 52, 62, 78, 62);
  c.closePath();
  c.restore();
}

const SHIELDS = [
  { id: 'gold', name: 'Gold', rim: ['#fff4c2', '#d4a63a', '#8a6414'], fill: ['#f7df8c', '#d9b04a', '#b88a22'], text: '#2e2307', light: true },
  { id: 'gold-rare', name: 'Gold Rare', rim: ['#fffbe6', '#e8bb48', '#8a6414'], fill: ['#fff0b0', '#e6bd52', '#a87a18'], text: '#2e2307', light: true, sheen: 0.45 },
  { id: 'silver', name: 'Silver', rim: ['#ffffff', '#b8bec4', '#6b7178'], fill: ['#eef1f4', '#c4cad0', '#9aa1a8'], text: '#1e2328', light: true },
  { id: 'bronze', name: 'Bronze', rim: ['#ffd9b5', '#b9784a', '#6b3d1e'], fill: ['#e6a878', '#bb7d4f', '#8a5430'], text: '#2b160a', light: true },
  { id: 'black-gold', name: 'Black & Gold', rim: ['#fff0b0', '#d9b25a', '#7a5a1a'], fill: ['#2b2a28', '#121212', '#050505'], text: '#f2d98f' },
  { id: 'red-gold', name: 'Red & Gold', rim: ['#fff0b0', '#d8b060', '#7a5a1a'], fill: ['#b3192a', '#7a0d18', '#3e0409'], text: '#ffe9b0' },
  { id: 'white-gold', name: 'White & Gold', rim: ['#fff4c2', '#c9a24a', '#7a5a1a'], fill: ['#ffffff', '#f0f0f0', '#d6d6d6'], text: '#3a2c0c', light: true },
  { id: 'purple', name: 'Purple', rim: ['#f1dcff', '#b57ae6', '#4a1f78'], fill: ['#6b2aa8', '#3d1270', '#1a0638'], text: '#ffffff' },
  { id: 'blue', name: 'Blue', rim: ['#e3f3ff', '#6fb4f0', '#1d4f8a'], fill: ['#2266c4', '#123f86', '#071d44'], text: '#ffffff' },
  { id: 'teal', name: 'Teal', rim: ['#e0fff9', '#5fe0cc', '#0d5c52'], fill: ['#17a090', '#0b6a5f', '#04302b'], text: '#e8fffb' },
  { id: 'green', name: 'Green & Gold', rim: ['#fff0b0', '#e3c25f', '#6b5414'], fill: ['#159458', '#0b5c36', '#032b19'], text: '#fbe9a8' },
  { id: 'pink', name: 'Pink', rim: ['#fff0f7', '#ff8cc6', '#8a1f55'], fill: ['#e0458f', '#9c1d5c', '#4a0a2a'], text: '#ffffff' },
  { id: 'orange', name: 'Orange', rim: ['#fff1d6', '#ffae4a', '#8a4a0a'], fill: ['#f07a1a', '#b84c06', '#5a2002'], text: '#fff4e0' },
  { id: 'aqua-gold', name: 'Navy & Gold', rim: ['#fff0b0', '#e0b84e', '#6b5414'], fill: ['#1c2c5a', '#101a3a', '#060b1c'], text: '#f6dc8e' },
];

function makeShield(s) {
  const c = document.createElement('canvas');
  const S = 2; // render at 2x for crisp exports
  c.width = 600 * S; c.height = 840 * S;
  const x = c.getContext('2d');
  x.scale(S, S);
  const lin = (stops, x0, y0, x1, y1) => {
    const g = x.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col));
    return g;
  };
  // outer rim
  shieldPath(x, 1);
  x.fillStyle = lin(s.rim, 0, 0, 600, 840); x.fill();
  // inner face
  shieldPath(x, 0.94);
  x.fillStyle = lin(s.fill, 120, 0, 480, 840); x.fill();
  // soft light from the top, darker toward the base
  x.save();
  shieldPath(x, 0.94); x.clip();
  const top = x.createRadialGradient(300, 120, 20, 300, 160, 520);
  top.addColorStop(0, `rgba(255,255,255,${s.light ? 0.35 : 0.16})`); top.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = top; x.fillRect(0, 0, 600, 840);
  const base = x.createLinearGradient(0, 520, 0, 840);
  base.addColorStop(0, 'rgba(0,0,0,0)'); base.addColorStop(1, `rgba(0,0,0,${s.light ? 0.12 : 0.3})`);
  x.fillStyle = base; x.fillRect(0, 0, 600, 840);
  if (s.sheen) {
    const sh = x.createLinearGradient(140, 0, 460, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, `rgba(255,255,255,${s.sheen})`); sh.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sh;
    x.beginPath(); x.moveTo(170, 840); x.lineTo(380, 0); x.lineTo(470, 0); x.lineTo(260, 840); x.fill();
  }
  x.restore();
  // fine inner line + divider lines
  shieldPath(x, 0.905);
  x.strokeStyle = s.rim[0]; x.globalAlpha = 0.55; x.lineWidth = 2; x.stroke(); x.globalAlpha = 1;
  // edge highlight on the rim
  shieldPath(x, 1);
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1.5; x.stroke();
  return c;
}

function builtInFrames() {
  return SHIELDS.map(s => ({
    id: 'shield-' + s.id, name: s.name, group: 'Cards', builtIn: true,
    img: makeShield(s), text: s.text, shadow: !s.light,
    layout: { photo: { x: 0.31, y: 0.1, w: 0.6, h: 0.5 }, col: 0.25, top: 0.14, name: 0.665, statLabel: 0.735, statValue: 0.795, team: 0.875, statLeft: 0.12, statRight: 0.88 },
  }));
}

window.FCCards = { STAT_KEYS, STAT_LABELS, GK_LABELS, renderCard, CARD_W, DEFAULT_LAYOUT, builtInFrames };
