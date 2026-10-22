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
];
const row = document.getElementById('row');
ROW.forEach(([name, pal, p], i) => {
  const t = document.createElement('div'); t.className = 'tile';
  t.style.backgroundImage = `url(${art(120, 180, 1.3 + i * 1.7, pal)})`;
  const s = document.createElement('span'); s.textContent = name;
  const bar = document.createElement('div'); bar.className = 'bar';
  const u = document.createElement('u'); u.style.width = p * 100 + '%'; bar.appendChild(u);
  t.append(s, bar); row.appendChild(t);
});

// Colours and menu placement taken from each Look's own theme.
const LOOKS = {
  'Orbit': { bg: '#0b0a09', panel: '#161412', text: '#f4f2ef', mut: '#b5aea7', acc: '#e5484d', radius: '12px', nav: '' },
  'Crimson': { bg: '#000000', panel: '#141414', text: '#ffffff', mut: '#b3b3b3', acc: '#e3101e', radius: '4px', nav: '' },
  'Marquee': { bg: '#150a0e', panel: '#221218', text: '#f7ede6', mut: '#cdb6b0', acc: '#e8b54a', radius: '4px', nav: 'side' },
  'Premiere': { bg: '#0a0f1f', panel: '#121a30', text: '#eef2ff', mut: '#a9b3cf', acc: '#5b8cff', radius: '18px', nav: '' },
  'Glass': { bg: '#0b1019', panel: '#151c2a', text: '#eef2f8', mut: '#d3dae6', acc: '#7cc4ff', radius: '18px', nav: '' },
  'Aurora': { bg: '#0c0b11', panel: '#1f1b3f', text: '#e6e6e7', mut: '#9d9da0', acc: '#7b5bf5', radius: '18px', nav: 'dock' },
  'Couch': { bg: '#1a100b', panel: '#27180f', text: '#f8ece3', mut: '#d0b6a5', acc: '#ff6a2b', radius: '14px', nav: 'side' },
  'Afterglow': { bg: '#0b0a09', panel: '#171411', text: '#f4f0e8', mut: '#c1b8ac', acc: '#ff9157', radius: '10px', nav: 'side' },
  'Orbit Arc': { bg: '#0b0a09', panel: '#161412', text: '#f4f2ef', mut: '#b5aea7', acc: '#e5484d', radius: '12px', nav: 'side' },
};
const app = document.getElementById('app');
const looks = document.querySelector('.looks');
function apply(name) {
  const L = LOOKS[name];
  app.style.setProperty('--a-bg', L.bg); app.style.setProperty('--a-panel', L.panel); app.style.setProperty('--a-text', L.text);
  app.style.setProperty('--a-mut', L.mut); app.style.setProperty('--a-acc', L.acc); app.style.setProperty('--a-radius', L.radius);
  app.classList.toggle('side', L.nav === 'side'); app.classList.toggle('dock', L.nav === 'dock');
  looks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === name)));
}
Object.keys(LOOKS).forEach((name) => {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.look = name;
  const dot = document.createElement('i'); dot.style.background = LOOKS[name].acc;
  b.append(dot, name); b.addEventListener('click', () => apply(name)); looks.appendChild(b);
});
apply('Orbit');

// The paste box only shows the review step; nothing is fetched.
document.getElementById('paste').addEventListener('submit', (e) => {
  e.preventDefault();
  const ok = /^(https:\/\/|stremio:\/\/)/.test(document.getElementById('manifest').value.trim());
  document.getElementById('review').hidden = !ok;
  document.getElementById('note').textContent = ok
    ? 'An example addon. Orbit ships with none: no streams, no catalogs, no content.'
    : 'Orbit only installs addons over https (or a stremio:// link).';
});
