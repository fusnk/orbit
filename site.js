// Artwork for the mock is drawn here, so the page needs no images.
function art(w, h, seed, palette) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const s = Math.sin(5.2 * u + 3.1 * Math.sin(3.4 * v + 1.3 + seed) + 1.6 * Math.sin(6 * u * v + 0.5));
    const t = Math.sin(4.6 * v - 2.2 * Math.cos(4.2 * u + seed) + s * 1.7);
    const k = Math.max(0, Math.min(0.9999, (s * 0.5 + 0.5) * 0.65 + (t * 0.5 + 0.5) * 0.35)) * (palette.length - 1);
    const i0 = Math.floor(k), f = k - i0, a = palette[i0], b = palette[i0 + 1];
    const shade = 0.86 + 0.14 * Math.sin(s * 3.1 + t * 2.3);
    const hi = Math.pow(Math.max(0, Math.cos((s * 2.4 + t * 1.1) * 2.6)), 10) * 0.5;
    const o = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[o + ch] = Math.min(255, (a[ch] + (b[ch] - a[ch]) * f) * shade + hi * 255);
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.88);
}

const PEARL = [[196, 178, 255], [168, 228, 255], [255, 188, 214], [246, 214, 160], [186, 244, 218], [196, 178, 255]];
document.getElementById('art').style.backgroundImage = `url(${art(640, 400, 0.4, PEARL)})`;

const ROW = [
  ['Night Drive', [[20, 24, 60], [80, 40, 140], [240, 90, 120], [20, 24, 60]], 0.62],
  ['Golden Hour', [[120, 50, 20], [240, 160, 70], [255, 220, 150], [120, 50, 20]], 0.85],
  ['Paper Moons', [[30, 40, 50], [90, 130, 150], [220, 230, 230], [30, 40, 50]], 0.48],
  ['Salt & Static', [[10, 60, 60], [40, 160, 140], [200, 240, 210], [10, 60, 60]], 0.2],
  ['The Long Room', [[60, 10, 20], [170, 40, 60], [250, 170, 150], [60, 10, 20]], 0.7],
  ['Low Tide', [[16, 30, 54], [60, 110, 170], [200, 220, 240], [16, 30, 54]], 0.35],
];
const row = document.getElementById('row'), thumbs = document.getElementById('thumbs');
ROW.forEach(([name, pal, p], i) => {
  const pic = art(192, 108, 1.3 + i * 1.7, pal);
  const t = document.createElement('div'); t.className = 'tile';
  t.style.backgroundImage = `url(${pic})`;
  const s = document.createElement('span'); s.textContent = name;
  const bar = document.createElement('div'); bar.className = 'bar';
  const u = document.createElement('u'); u.style.width = p * 100 + '%'; bar.appendChild(u);
  t.append(s, bar); row.appendChild(t);
  if (i < 4) { const th = document.createElement('i'); th.style.backgroundImage = `url(${pic})`; thumbs.appendChild(th); }
});
const first = document.createElement('i'); first.style.backgroundImage = document.getElementById('art').style.backgroundImage; thumbs.prepend(first);
document.getElementById('peekL').style.backgroundImage = `url(${art(160, 320, 2.2, ROW[4][1])})`;
document.getElementById('peekR').style.backgroundImage = `url(${art(160, 320, 4.1, ROW[1][1])})`;

// The menu, drawn once; each Look moves and reshapes it.
const ICONS = {
  Home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', Movies: 'M4 5h16v14H4zM8 5v14M16 5v14', 'TV Shows': 'M3 8h18v12H3zM8 3l4 4 4-4',
  Discover: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z', 'Live TV': 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10',
  'My Library': 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
};
const nav = document.getElementById('nav');
Object.entries(ICONS).forEach(([label, d], i) => {
  const s = document.createElement('span'); if (i === 0) s.className = 'on';
  s.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg><em>${label}</em>`;
  nav.appendChild(s);
});

// Each Look as the app defines it (src/theme/looks.ts): its theme colours, where the menu sits, the banner, corners and type.
const CORNERS = { classic: ['1.2cqi', '0.8cqi', '2cqi'], sharp: ['0.35cqi', '0.25cqi', '0.35cqi'], round: ['2cqi', '1.4cqi', '2cqi'] };
const LOOKS = {
  'Orbit': { bg: '#0b0a09', panel: '#161412', text: '#f4f2ef', mut: '#b5aea7', acc: '#e5484d', corners: 'classic', nav: 'top', hero: 'card', ind: 'thumbs',
    note: 'The default: a menu pill in the middle of the bar, a framed banner with the next picks beside it.' },
  'Crimson': { bg: '#000000', panel: '#141414', text: '#ffffff', mut: '#b3b3b3', acc: '#e3101e', corners: 'sharp', nav: 'start', hero: 'cine', ind: 'dots', overlap: true,
    font: "'Segoe UI', Helvetica, Arial, sans-serif", head: "'Segoe UI', Helvetica, Arial, sans-serif",
    note: 'True black and red. A full-bleed banner the first row rises into, sharp corners, the menu right after the logo.' },
  'Marquee': { on: '#1b1208', bg: '#150a0e', panel: '#221218', text: '#f7ede6', mut: '#cdb6b0', acc: '#e8b54a', corners: 'sharp', nav: 'rail', hero: 'spot', ind: 'dots', caps: true,
    head: "'Bahnschrift SemiCondensed', 'Bahnschrift', 'Roboto Condensed', 'Arial Narrow', sans-serif",
    note: 'A picture palace: wine velvet and gold, condensed billboard titles, the Spotlight banner and a slim icon rail.' },
  'Premiere': { bg: '#0a0f1f', panel: '#121a30', text: '#eef2ff', mut: '#a9b3cf', acc: '#5b8cff', corners: 'round', nav: 'top', hero: 'carousel', ind: 'dots',
    font: "'Plus Jakarta Sans', var(--body)", head: "'Plus Jakarta Sans', var(--body)",
    note: 'A polished streaming service: the Carousel banner with the next titles peeking in either side, soft round cards.' },
  'Glass': { on: '#1b1208', bg: '#0b1019', panel: '#151c2a', text: '#eef2f8', mut: '#d3dae6', acc: '#7cc4ff', corners: 'round', nav: 'dock', hero: 'card', ind: 'thumbs',
    font: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", head: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", hw: 600,
    note: 'Light and airy: a frosted menu floating at the top, round corners, Plex type.' },
  'Aurora': { bg: '#0c0b11', panel: '#1f1b3f', text: '#e6e6e7', mut: '#9d9da0', acc: '#7b5bf5', corners: 'round', nav: 'dockb', hero: 'split', ind: 'dots',
    font: "'Space Grotesk', var(--body)", head: "'Space Grotesk', var(--display)", hw: 700,
    note: 'Nothing at the top: the art framed beside the text, the menu floating at the bottom, Space Grotesk.' },
  'Couch': { bg: '#1a100b', panel: '#27180f', text: '#f8ece3', mut: '#d0b6a5', acc: '#ff6a2b', corners: 'classic', nav: 'sidebar', hero: 'card', ind: 'thumbs', scale: 1.15,
    font: "'Montserrat', 'Segoe UI', sans-serif", head: "'Montserrat', 'Segoe UI', sans-serif",
    note: 'Read from the sofa: warm Ember browns, a wide labelled sidebar and everything a size up.' },
  'Afterglow': { on: '#1b1208', bg: '#0b0a09', panel: '#171411', text: '#f4f0e8', mut: '#c1b8ac', acc: '#ff9157', corners: 'classic', nav: 'cine', hero: 'cine', ind: 'dots', play: 'acc',
    head: "'Fraunces', Georgia, 'Times New Roman', serif", hw: 600, btn: '0.5cqi',
    note: 'Calm by design: no glow, so the copper stays on Play and the current page. Serif titles, like a magazine.' },
  'Orbit Arc': { bg: '#0b0a09', panel: '#161412', text: '#f4f2ef', mut: '#b5aea7', acc: '#e5484d', corners: 'classic', nav: 'arc', hero: 'card', ind: 'count',
    note: 'Orbit\'s own colours with the Arc controls: a text menu by the logo, your name up top, a ring timer on the banner.' },
};
const app = document.getElementById('app');
const looks = document.querySelector('.looks');
const lookNote = document.getElementById('lookNote');
function apply(name) {
  const L = LOOKS[name], [r, tr, cr] = CORNERS[L.corners];
  const vars = { bg: L.bg, panel: L.panel, text: L.text, mut: L.mut, acc: L.acc, r, tr, cr, br: L.btn || '3cqi', s: L.scale || 1, hw: L.hw || 800,
    on: L.on || '#fff', f: L.font || 'var(--body)', h: L.head || 'var(--display)' };
  Object.entries(vars).forEach(([k, v]) => app.style.setProperty(`--a-${k}`, v));
  Object.assign(app.dataset, { nav: L.nav, hero: L.hero, ind: L.ind, play: L.play || '' });
  app.toggleAttribute('data-overlap', !!L.overlap); app.toggleAttribute('data-caps', !!L.caps);
  app.setAttribute('aria-label', `Orbit's Home screen in the ${name} Look`);
  app.classList.remove('swap'); void app.offsetWidth; app.classList.add('swap');
  lookNote.innerHTML = `<b>${name}.</b> ${L.note}`;
  looks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === name)));
}
Object.keys(LOOKS).forEach((name) => {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.look = name;
  const dot = document.createElement('i'); dot.style.background = LOOKS[name].acc;
  b.append(dot, name); b.addEventListener('click', () => apply(name)); looks.appendChild(b);
});
apply('Orbit');
app.classList.remove('swap');

// The paste box only shows the review step; nothing is fetched.
document.getElementById('paste').addEventListener('submit', (e) => {
  e.preventDefault();
  const ok = /^(https:\/\/|stremio:\/\/)/.test(document.getElementById('manifest').value.trim());
  document.getElementById('review').hidden = !ok;
  document.getElementById('note').textContent = ok
    ? 'An example addon. Orbit ships with none: no streams, no catalogs, no content.'
    : 'Orbit only installs addons over https (or a stremio:// link).';
});
