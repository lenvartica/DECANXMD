'use strict';
/**
 * Game cards: dark-green neon "app" look drawn as SVG and rendered to PNG with sharp.
 * Text is drawn with a built-in 5x7 pixel font (vector rectangles), so the cards look identical on any
 * server, even one with no fonts installed.
 */

/* ------------------------------ pixel font ------------------------------ */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'], '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'], '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'], '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'], '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'], '*': ['.....', '.....', '.###.', '.###.', '.###.', '.....', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'], '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##']
};

/** pixel text as one <path>. anchor: start | middle | end */
function text(str, x, y, s, fill, anchor = 'start') {
  const chars = [...String(str).toUpperCase()].map(c => (GLYPHS[c] ? c : (c === '•' ? '*' : ' ')));
  const w = chars.length * 6 * s - s;
  let ox = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  ox = Math.round(ox);
  let d = '';
  for (const c of chars) {
    GLYPHS[c].forEach((row, ry) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === '#') d += `M${ox + rx * s} ${y + ry * s}h${s}v${s}h${-s}z`; });
    ox += 6 * s;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

/* -------------------------------- theme --------------------------------- */
const T = {
  bgTop: '#14554a', bgBot: '#0a2b26', border: '#2f9a7c', title: '#3df5a0', sub: '#a4ead0', muted: '#6fc4a6',
  panel: '#08201c', panelBorder: '#22796a', grid: '#10372f', btn: '#16493f', btnBorder: '#2f8f77', icon: '#c9ffe9',
  greens: ['#34e08f', '#2ecc71', '#10b981', '#6ee7b7', '#22c55e', '#4ade80', '#16a34a'], apple: '#ff5a5f', box: '#d19a4a'
};
const W = 420;

function icon(kind, cx, cy) {
  const f = T.icon;
  switch (kind) {
    case 'left': return `<polygon points="${cx + 7},${cy - 9} ${cx - 8},${cy} ${cx + 7},${cy + 9}" fill="${f}"/>`;
    case 'right': return `<polygon points="${cx - 7},${cy - 9} ${cx + 8},${cy} ${cx - 7},${cy + 9}" fill="${f}"/>`;
    case 'up': return `<polygon points="${cx - 9},${cy + 6} ${cx + 9},${cy + 6} ${cx},${cy - 9}" fill="${f}"/>`;
    case 'down': return `<polygon points="${cx - 9},${cy - 6} ${cx + 9},${cy - 6} ${cx},${cy + 9}" fill="${f}"/>`;
    case 'rotate': return `<path d="M${cx + 9} ${cy} A9 9 0 1 1 ${cx} ${cy - 9}" fill="none" stroke="${f}" stroke-width="3.2" stroke-linecap="round"/><polygon points="${cx - 2},${cy - 15} ${cx + 6},${cy - 9} ${cx - 2},${cy - 3}" fill="${f}"/>`;
    case 'undo': return `<path d="M${cx - 9} ${cy} A9 9 0 1 0 ${cx} ${cy - 9}" fill="none" stroke="${f}" stroke-width="3.2" stroke-linecap="round"/><polygon points="${cx + 2},${cy - 15} ${cx - 6},${cy - 9} ${cx + 2},${cy - 3}" fill="${f}"/>`;
    case 'drop': return `<polygon points="${cx - 9},${cy - 10} ${cx + 9},${cy - 10} ${cx},${cy - 1}" fill="${f}"/><polygon points="${cx - 9},${cy + 1} ${cx + 9},${cy + 1} ${cx},${cy + 10}" fill="${f}"/>`;
    default: return '';
  }
}

function buttons(items, y) {
  const n = items.length, bw = n > 4 ? 50 : 62, gap = n > 4 ? 10 : 12, total = n * bw + (n - 1) * gap;
  let x = Math.round((W - total) / 2), out = '';
  for (const it of items) {
    out += `<rect x="${x}" y="${y}" width="${bw}" height="58" rx="14" fill="${T.btn}" stroke="${T.btnBorder}" stroke-width="1.5"/>`;
    out += icon(it.icon, x + bw / 2, y + 24);
    out += text(it.key, x + bw / 2, y + 43, 2, T.muted, 'middle');
    x += bw + gap;
  }
  return out;
}

/** wraps a game body in the common card. body is placed inside the panel whose size is given. */
function shell({ title, subtitle, panelW, panelH, body, keys, hints, overlay, restartLabel = 'R  RESTART' }) {
  const px = Math.round((W - panelW) / 2), py = 92;
  const by = py + panelH + 22;
  const hintY = by + 58 + 20;
  const restartY = hintY + hints.length * 22 + 8;
  const H = restartY + 40 + 26;
  const ov = overlay ? `
    <rect x="${px}" y="${py}" width="${panelW}" height="${panelH}" rx="14" fill="#04120f" opacity="0.6"/>
    ${text(overlay.title, W / 2, py + panelH / 2 - 26, 4, T.title, 'middle')}
    ${overlay.sub ? text(overlay.sub, W / 2, py + panelH / 2 + 18, 2, T.sub, 'middle') : ''}
    ${overlay.hint ? text(overlay.hint, W / 2, py + panelH / 2 + 46, 2, T.muted, 'middle') : ''}` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bgTop}"/><stop offset="1" stop-color="${T.bgBot}"/></linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="30" fill="url(#bg)" stroke="${T.border}" stroke-width="3"/>
  ${text(title, W / 2, 28, 4, T.title, 'middle')}
  ${text(subtitle, W / 2, 64, 2, T.sub, 'middle')}
  <rect x="${px}" y="${py}" width="${panelW}" height="${panelH}" rx="14" fill="${T.panel}" stroke="${T.panelBorder}" stroke-width="2"/>
  <g transform="translate(${px},${py})">${body}</g>
  ${ov}
  ${buttons(keys, by)}
  ${hints.map((h, i) => text(h, W / 2, hintY + i * 22, 2, T.muted, 'middle')).join('')}
  <rect x="${W / 2 - 68}" y="${restartY}" width="136" height="40" rx="20" fill="#0f3a32" stroke="${T.btnBorder}" stroke-width="1.5"/>
  ${text(restartLabel, W / 2, restartY + 13, 2, T.sub, 'middle')}
</svg>`;
  return svg;
}

function cell(x, y, c, fill, ghost = false) {
  if (ghost) return `<rect x="${x + 2}" y="${y + 2}" width="${c - 4}" height="${c - 4}" rx="4" fill="none" stroke="${fill}" stroke-opacity="0.55" stroke-width="2"/>`;
  return `<rect x="${x + 1}" y="${y + 1}" width="${c - 2}" height="${c - 2}" rx="4" fill="${fill}"/><rect x="${x + 1}" y="${y + 1}" width="${c - 2}" height="${(c - 2) * 0.55}" rx="4" fill="url(#glow)"/>`;
}
function gridLines(cols, rows, c, pad) {
  let d = '';
  for (let i = 0; i <= cols; i++) d += `M${pad + i * c} ${pad}v${rows * c}`;
  for (let j = 0; j <= rows; j++) d += `M${pad} ${pad + j * c}h${cols * c}`;
  return `<path d="${d}" stroke="${T.grid}" stroke-width="1" fill="none"/>`;
}

/* -------------------------------- tetris -------------------------------- */
/** g: tetris game state; api = helpers from arcade (cellsOf, fits, SHAPES, TW, TH) */
function tetrisSvg(g, api, overlay) {
  const { cellsOf, fits, SHAPES, TW, TH } = api;
  const c = 26, pad = 10, pw = TW * c + pad * 2, ph = TH * c + pad * 2;
  const colour = t => T.greens[Object.keys(SHAPES).indexOf(t) % T.greens.length] || T.greens[0];
  let body = gridLines(TW, TH, c, pad);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const v = g.board[y][x]; if (v) body += cell(pad + x * c, pad + y * c, c, SHAPES[v] ? colour(v) : T.greens[2]); }
  if (!g.over && g.cur) {
    let gy = g.cur.y;
    while (fits(g, g.cur.type, g.cur.rot, g.cur.x, gy + 1)) gy++;
    if (gy !== g.cur.y) for (const [x, y] of cellsOf(g.cur.type, g.cur.rot)) body += cell(pad + (g.cur.x + x) * c, pad + (gy + y) * c, c, colour(g.cur.type), true);
    for (const [x, y] of cellsOf(g.cur.type, g.cur.rot)) if (g.cur.y + y >= 0) body += cell(pad + (g.cur.x + x) * c, pad + (g.cur.y + y) * c, c, colour(g.cur.type));
  }
  // "next" preview in the top-right corner of the panel
  const next = cellsOf(g.next, 0), s = 9;
  body += `<rect x="${pw - 60}" y="6" width="54" height="34" rx="6" fill="#0c2a25" opacity="0.9"/>`;
  next.forEach(([x, y]) => { body += `<rect x="${pw - 56 + x * s + 4}" y="${10 + y * s}" width="${s - 1}" height="${s - 1}" rx="2" fill="${colour(g.next)}"/>`; });
  return shell({
    title: 'TETRIS', subtitle: `SCORE ${g.score} * LINES ${g.lines}`, panelW: pw, panelH: ph, body, overlay,
    keys: [{ icon: 'left', key: 'A' }, { icon: 'rotate', key: 'W' }, { icon: 'right', key: 'D' }, { icon: 'down', key: 'S' }],
    hints: ['SEND A D W S OR 4 6 8 2', 'X OR 5 = DROP']
  });
}

/* --------------------------------- snake -------------------------------- */
function snakeSvg(g, api, overlay, best) {
  const { SN } = api, c = 34, pad = 8, pw = SN.W * c + pad * 2, ph = SN.H * c + pad * 2;
  let body = gridLines(SN.W, SN.H, c, pad);
  if (g.food) {
    const fx = pad + g.food[0] * c + c / 2, fy = pad + g.food[1] * c + c / 2;
    body += `<circle cx="${fx}" cy="${fy + 1}" r="${c * 0.34}" fill="${T.apple}"/><circle cx="${fx - 4}" cy="${fy - 4}" r="3" fill="#fff" opacity="0.45"/><path d="M${fx} ${fy - c * 0.32}q4 -8 9 -8" stroke="#4ade80" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  const n = g.snake.length;
  g.snake.forEach(([x, y], i) => {
    const px = pad + x * c, py = pad + y * c;
    if (i === 0) {
      body += `<rect x="${px + 1}" y="${py + 1}" width="${c - 2}" height="${c - 2}" rx="11" fill="${g.over ? '#ef4444' : '#7cffc4'}"/>`;
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[g.dir] || [1, 0];
      const ex = d[0] ? [0, 0] : [-6, 6], ey = d[1] ? [0, 0] : [-6, 6];
      for (let k = 0; k < 2; k++) {
        const cx = px + c / 2 + d[0] * 6 + (d[0] ? 0 : ex[k]), cy = py + c / 2 + d[1] * 6 + (d[1] ? 0 : ey[k]);
        body += g.over ? `<path d="M${cx - 3} ${cy - 3}l6 6m0 -6l-6 6" stroke="#04120f" stroke-width="2"/>` : `<circle cx="${cx}" cy="${cy}" r="3.4" fill="#04120f"/>`;
      }
    } else {
      const shade = T.greens[(i % 2)], ins = i === n - 1 ? 5 : 2;
      body += `<rect x="${px + ins}" y="${py + ins}" width="${c - ins * 2}" height="${c - ins * 2}" rx="9" fill="${shade}"/>`;
    }
  });
  return shell({
    title: 'SNAKE', subtitle: `SCORE ${g.score}${best ? ` * BEST ${best}` : ''}`, panelW: pw, panelH: ph, body, overlay,
    keys: [{ icon: 'left', key: 'A' }, { icon: 'up', key: 'W' }, { icon: 'down', key: 'S' }, { icon: 'right', key: 'D' }],
    hints: ['SEND A W S D OR 4 8 2 6', 'CHAIN MOVES: 6662']
  });
}

/* -------------------------------- sokoban ------------------------------- */
function sokobanSvg(g, total, overlay) {
  const c = Math.min(46, Math.floor(330 / Math.max(g.w, g.h))), pad = 14, pw = Math.max(g.w * c + pad * 2, 250), ph = Math.max(g.h * c + pad * 2, 150);
  const ox = Math.round((pw - g.w * c) / 2), oy = Math.round((ph - g.h * c) / 2);
  let body = '';
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const k = `${x},${y}`, px = ox + x * c, py = oy + y * c;
    if (g.walls.has(k)) {
      body += `<rect x="${px + 1}" y="${py + 1}" width="${c - 2}" height="${c - 2}" rx="5" fill="#2d6a5a"/><path d="M${px + 2} ${py + c / 2}h${c - 4}M${px + c / 2} ${py + 2}v${c / 2 - 2}M${px + c / 4} ${py + c / 2}v${c / 2 - 2}M${px + c * 0.75} ${py + c / 2}v${c / 2 - 2}" stroke="#1c4a3f" stroke-width="2" fill="none"/>`;
      continue;
    }
    const inside = (() => { // floor only for cells reachable from inside (cheap check: not outside the wall bounding box rows)
      let l = false, r = false;
      for (let i = x - 1; i >= 0; i--) if (g.walls.has(`${i},${y}`)) { l = true; break; }
      for (let i = x + 1; i < g.w; i++) if (g.walls.has(`${i},${y}`)) { r = true; break; }
      return l && r;
    })();
    if (inside) body += `<rect x="${px + 1}" y="${py + 1}" width="${c - 2}" height="${c - 2}" rx="4" fill="#0d2d28" stroke="${T.grid}" stroke-width="1"/>`;
    if (g.goals.has(k) && !g.boxes.has(k)) body += `<circle cx="${px + c / 2}" cy="${py + c / 2}" r="${c * 0.22}" fill="none" stroke="${T.title}" stroke-width="3"/><circle cx="${px + c / 2}" cy="${py + c / 2}" r="${c * 0.07}" fill="${T.title}"/>`;
    if (g.boxes.has(k)) {
      const on = g.goals.has(k);
      body += `<rect x="${px + 4}" y="${py + 4}" width="${c - 8}" height="${c - 8}" rx="6" fill="${on ? '#34e08f' : T.box}" stroke="${on ? '#0a7a4c' : '#8a5a1a'}" stroke-width="3"/>`;
      body += on ? `<path d="M${px + c * 0.3} ${py + c * 0.52}l${c * 0.14} ${c * 0.16}l${c * 0.26} -${c * 0.3}" stroke="#06382a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${px + 9} ${py + 9}L${px + c - 9} ${py + c - 9}M${px + c - 9} ${py + 9}L${px + 9} ${py + c - 9}" stroke="#8a5a1a" stroke-width="2.5"/>`;
    }
    if (g.p[0] === x && g.p[1] === y) {
      body += `<circle cx="${px + c / 2}" cy="${py + c / 2}" r="${c * 0.36}" fill="#e6fff4" stroke="#34e08f" stroke-width="3"/><circle cx="${px + c / 2 - 5}" cy="${py + c / 2 - 2}" r="2.6" fill="#04120f"/><circle cx="${px + c / 2 + 5}" cy="${py + c / 2 - 2}" r="2.6" fill="#04120f"/><path d="M${px + c / 2 - 5} ${py + c / 2 + 5}q5 4 10 0" stroke="#04120f" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    }
  }
  return shell({
    title: 'SOKOBAN', subtitle: `LEVEL ${g.level + 1}/${total} * MOVES ${g.moves}`, panelW: pw, panelH: ph, body, overlay,
    keys: [{ icon: 'left', key: 'A' }, { icon: 'up', key: 'W' }, { icon: 'down', key: 'S' }, { icon: 'right', key: 'D' }, { icon: 'undo', key: 'Z' }],
    hints: ['PUSH EVERY BOX ONTO A TARGET', 'SEND A W S D OR 4 8 2 6']
  });
}

/* -------------------------------- render -------------------------------- */
async function toPng(svg, sharp) {
  return sharp(Buffer.from(svg), { density: 130 }).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { text, tetrisSvg, snakeSvg, sokobanSvg, toPng, W };
