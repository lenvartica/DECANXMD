'use strict';
/**
 * Arcade: Snake, Sokoban and Tetris played with chat messages.
 *
 *   .snake      .sokoban [level]      .tetris      (add "end" to stop, e.g. .snake end)
 *
 * While a game is running, the player (the person who started it) just sends controls:
 *   w / 8 = up   s / 2 = down   a / 4 = left   d / 6 = right      (digits can be chained: 6662)
 *   Sokoban: z = undo, r = restart level          Tetris: w / 8 = rotate, x / 5 = hard drop
 * Messages that are not controls are ignored by the game, so normal chatting still works.
 * One arcade game runs per chat. Games end by themselves after 10 minutes without a move.
 */
const U = require('../lib/util');
const { UserError, bold } = U;

let rng = Math.random;
const pick = a => a[Math.floor(rng() * a.length)];
const IDLE = 10 * 60000;

/* ------------------------------ controls -------------------------------- */
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYMAP = { w: 'up', s: 'down', a: 'left', d: 'right', 8: 'up', 2: 'down', 4: 'left', 6: 'right' };

/** "w", "6662" -> ['up'] , ['right','right','right','down']; anything else -> null */
function parseMoves(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^[wasd]$/.test(t)) return [KEYMAP[t]];
  if (/^[2468]{1,12}$/.test(t)) return [...t].map(c => KEYMAP[c]);
  return null;
}

/* -------------------------------- snake --------------------------------- */
const SN = { W: 9, H: 9 };

function snakeNew() {
  const g = { type: 'snake', snake: [[4, 4], [3, 4], [2, 4]], dir: 'right', score: 0, food: null, over: false };
  snakeFood(g);
  return g;
}
function snakeFood(g) {
  const free = [];
  for (let y = 0; y < SN.H; y++) for (let x = 0; x < SN.W; x++) if (!g.snake.some(([a, b]) => a === x && b === y)) free.push([x, y]);
  g.food = free.length ? pick(free) : null;
}
/** returns 'ok' | 'ate' | 'dead' | 'won' | 'blocked' */
function snakeStep(g, dir) {
  const cur = DIRS[g.dir], nd = DIRS[dir];
  if (g.snake.length > 1 && cur[0] + nd[0] === 0 && cur[1] + nd[1] === 0) return 'blocked'; // cannot reverse into itself
  g.dir = dir;
  const [hx, hy] = g.snake[0];
  const nx = hx + nd[0], ny = hy + nd[1];
  if (nx < 0 || ny < 0 || nx >= SN.W || ny >= SN.H) { g.over = true; return 'dead'; }
  const eating = g.food && g.food[0] === nx && g.food[1] === ny;
  const body = eating ? g.snake : g.snake.slice(0, -1); // the tail moves away unless we grow
  if (body.some(([x, y]) => x === nx && y === ny)) { g.over = true; return 'dead'; }
  g.snake.unshift([nx, ny]);
  if (!eating) { g.snake.pop(); return 'ok'; }
  g.score++;
  snakeFood(g);
  if (!g.food) { g.over = true; return 'won'; }
  return 'ate';
}
function snakeRender(g) {
  const rows = [];
  for (let y = 0; y < SN.H; y++) {
    let r = '';
    for (let x = 0; x < SN.W; x++) {
      if (g.snake[0][0] === x && g.snake[0][1] === y) r += g.over ? '💀' : '🟢';
      else if (g.snake.some(([a, b]) => a === x && b === y)) r += '🟩';
      else if (g.food && g.food[0] === x && g.food[1] === y) r += '🍎';
      else r += '⬛';
    }
    rows.push(r);
  }
  return rows.join('\n');
}

/* ------------------------------- sokoban -------------------------------- */
// # wall  space floor  $ box  . target  * box on target  @ player  + player on target
const LEVELS = [
  ['#####', '#@$.#', '#####'],
  ['#######', '#     #', '# $.  #', '#  @  #', '#     #', '#######'],
  ['#######', '#.  . #', '#  $$ #', '#  @  #', '#######'],
  ['  ####', '###  #', '#  $ #', '# .$.#', '#  @ #', '######'],
  ['#######', '#.    #', '# $$  #', '# .@. #', '#  $  #', '#     #', '#######'],
  ['########', '#      #', '# .**$@#', '#      #', '#####  #', '    ####'],
  ['####', '# .#', '#  ###', '#*@  #', '#  $ #', '#  ###', '####']
];

function sokoLoad(n) {
  const rows = LEVELS[n].map(r => r.split(''));
  const w = Math.max(...rows.map(r => r.length));
  const walls = new Set(), goals = new Set(), boxes = new Set();
  let p = null;
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) {
    const c = r[x] || ' ', k = `${x},${y}`;
    if (c === '#') walls.add(k);
    if ('.*+'.includes(c)) goals.add(k);
    if ('$*'.includes(c)) boxes.add(k);
    if ('@+'.includes(c)) p = [x, y];
  } });
  return { type: 'sokoban', level: n, w, h: rows.length, walls, goals, boxes, p, moves: 0, history: [], won: false };
}
function sokoMove(g, dir) {
  const [dx, dy] = DIRS[dir];
  const nx = g.p[0] + dx, ny = g.p[1] + dy, k = `${nx},${ny}`;
  if (g.walls.has(k)) return false;
  const snap = { p: [...g.p], boxes: new Set(g.boxes) };
  if (g.boxes.has(k)) {
    const bk = `${nx + dx},${ny + dy}`;
    if (g.walls.has(bk) || g.boxes.has(bk)) return false;
    g.boxes.delete(k); g.boxes.add(bk);
  }
  g.history.push(snap);
  if (g.history.length > 500) g.history.shift();
  g.p = [nx, ny];
  g.moves++;
  g.won = [...g.goals].every(x => g.boxes.has(x));
  return true;
}
function sokoUndo(g) {
  const s = g.history.pop();
  if (!s) return false;
  g.p = s.p; g.boxes = s.boxes; g.moves = Math.max(0, g.moves - 1); g.won = false;
  return true;
}
function sokoRender(g) {
  const out = [];
  for (let y = 0; y < g.h; y++) {
    let r = '';
    for (let x = 0; x < g.w; x++) {
      const k = `${x},${y}`;
      if (g.walls.has(k)) r += '🧱';
      else if (g.p[0] === x && g.p[1] === y) r += '🧍';
      else if (g.boxes.has(k)) r += g.goals.has(k) ? '✅' : '📦';
      else if (g.goals.has(k)) r += '🎯';
      else r += '⬛';
    }
    out.push(r);
  }
  return out.join('\n');
}

/* -------------------------------- tetris -------------------------------- */
const TW = 10, TH = 16;
const SHAPES = {
  I: { c: '🟦', g: ['....', 'XXXX', '....', '....'] },
  O: { c: '🟨', g: ['XX', 'XX'] },
  T: { c: '🟪', g: ['.X.', 'XXX', '...'] },
  S: { c: '🟩', g: ['.XX', 'XX.', '...'] },
  Z: { c: '🟥', g: ['XX.', '.XX', '...'] },
  L: { c: '🟧', g: ['..X', 'XXX', '...'] },
  J: { c: '🟫', g: ['X..', 'XXX', '...'] }
};
const rotGrid = g => g[0].split('').map((_, i) => g.map(r => r[i]).reverse().join('')); // clockwise
function cellsOf(type, rot) {
  let g = SHAPES[type].g;
  for (let i = 0; i < rot % 4; i++) g = rotGrid(g);
  const out = [];
  g.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'X') out.push([x, y]); }));
  return out;
}
function tBag(g) {
  if (g.bag.length < 2) {
    const b = Object.keys(SHAPES);
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    g.bag.push(...b);
  }
  return g.bag.shift();
}
const tFits = (g, type, rot, px, py) => cellsOf(type, rot).every(([x, y]) => {
  const bx = px + x, by = py + y;
  return bx >= 0 && bx < TW && by < TH && (by < 0 || !g.board[by][bx]);
});
function tSpawn(g) {
  g.cur = { type: g.next || tBag(g), rot: 0, x: Math.floor((TW - 3) / 2), y: 0 };
  g.next = tBag(g);
  if (!tFits(g, g.cur.type, 0, g.cur.x, g.cur.y)) g.over = true;
}
function tetrisNew() {
  const g = { type: 'tetris', board: Array.from({ length: TH }, () => Array(TW).fill(null)), bag: [], next: null, cur: null, score: 0, lines: 0, pieces: 0, over: false };
  tSpawn(g);
  return g;
}
function tLock(g) {
  for (const [x, y] of cellsOf(g.cur.type, g.cur.rot)) { const by = g.cur.y + y; if (by >= 0) g.board[by][g.cur.x + x] = g.cur.type; }
  g.pieces++;
  g.score += 10;
  let cleared = 0;
  for (let y = TH - 1; y >= 0; y--) {
    if (g.board[y].every(Boolean)) { g.board.splice(y, 1); g.board.unshift(Array(TW).fill(null)); cleared++; y++; }
  }
  if (cleared) { g.lines += cleared; g.score += [0, 100, 300, 500, 800][cleared]; }
  tSpawn(g);
  return cleared;
}
function tDown(g) { // one row down, locking if it cannot fall
  if (tFits(g, g.cur.type, g.cur.rot, g.cur.x, g.cur.y + 1)) { g.cur.y++; return 0; }
  return tLock(g);
}
function tHard(g) {
  let n = 0;
  while (tFits(g, g.cur.type, g.cur.rot, g.cur.x, g.cur.y + 1)) { g.cur.y++; n++; }
  g.score += n;
  return tLock(g);
}
function tRotate(g) {
  const r = (g.cur.rot + 1) % 4;
  for (const k of [0, -1, 1, -2, 2]) if (tFits(g, g.cur.type, r, g.cur.x + k, g.cur.y)) { g.cur.rot = r; g.cur.x += k; return true; }
  return false;
}
/** apply one key: left right rotate down hard */
function tApply(g, key) {
  if (key === 'left' && tFits(g, g.cur.type, g.cur.rot, g.cur.x - 1, g.cur.y)) g.cur.x--;
  else if (key === 'right' && tFits(g, g.cur.type, g.cur.rot, g.cur.x + 1, g.cur.y)) g.cur.x++;
  else if (key === 'up') tRotate(g);
  else if (key === 'down') return tDown(g);
  else if (key === 'hard') return tHard(g);
  return 0;
}
function tetrisRender(g) {
  const view = g.board.map(r => [...r]);
  if (!g.over && g.cur) for (const [x, y] of cellsOf(g.cur.type, g.cur.rot)) { const by = g.cur.y + y, bx = g.cur.x + x; if (by >= 0 && by < TH && bx >= 0 && bx < TW) view[by][bx] = SHAPES[g.cur.type].c; }
  return view.map(r => '⬜' + r.map(c => SHAPES[c]?.c || c || '⬛').join('') + '⬜').join('\n') + '\n' + '⬜'.repeat(TW + 2);
}
const tetrisKeys = text => {
  const t = String(text || '').trim().toLowerCase();
  if (/^[wasd]$/.test(t)) return [KEYMAP[t]];
  if (t === 'x' || t === '0') return ['hard'];
  if (/^[24568]{1,12}$/.test(t)) return [...t].map(c => (c === '5' ? 'hard' : KEYMAP[c]));
  return null;
};

/* ------------------------------ image cards ----------------------------- */
const cards = require('../lib/cards');
const tetrisApi = () => ({ cellsOf, fits: tFits, SHAPES, TW, TH });

async function renderCard(g, overlay, best) {
  const svg = g.type === 'tetris' ? cards.tetrisSvg(g, tetrisApi(), overlay)
    : g.type === 'snake' ? cards.snakeSvg(g, { SN }, overlay, best)
      : cards.sokobanSvg(g, LEVELS.length, overlay);
  return cards.toPng(svg, U.sharp());
}
const textBoard = g => (g.type === 'tetris' ? tetrisRender(g) : g.type === 'snake' ? snakeRender(g) : sokoRender(g));

/* ------------------------------ commands / hook ------------------------- */
module.exports = ({ def, hooks, tickers }) => {
  const P = ctx => ctx.var('PREFIX');
  const arcade = ctx => (ctx.rt.arcade ||= new Map());
  const touch = g => { g.deadline = Date.now() + IDLE; };

  function best(ctx, game, score, name) {
    let record = false;
    ctx.update('arcadeBest', {}, o => { if (!o[game] || score > o[game].score) { o[game] = { score, name }; record = score > 0; } });
    return record;
  }
  const bestScore = (ctx, game) => ctx.get('arcadeBest', {})[game]?.score || 0;
  const bestLine = (ctx, game) => { const b = ctx.get('arcadeBest', {})[game]; return b ? ` • Best ${b.score} (${b.name})` : ''; };

  /** sends the game as a picture card; falls back to the emoji board if images cannot be rendered */
  async function sendCard(ctx, g, caption, overlay) {
    try {
      const png = await renderCard(g, overlay, g.type === 'snake' ? bestScore(ctx, 'snake') : 0);
      return await ctx.image(png, caption);
    } catch (e) {
      ctx.logger?.warn?.({ error: e?.message }, 'Game card render failed, using text board');
      return ctx.send({ text: ctx.frame(`${textBoard(g)}\n\n${caption}`, g.type) }, { quoted: ctx.msg });
    }
  }

  function start(ctx, make) {
    const cur = arcade(ctx).get(ctx.chat);
    if (cur) throw new UserError(`${cur.owner.name} is already playing ${cur.type} here. Wait, or end it with *${P(ctx)}${cur.type} end*.`);
    if (ctx.rt.games.has(ctx.chat)) throw new UserError('Another game is running in this chat. Finish it first.');
    const g = make();
    g.owner = { id: ctx.senderNum, name: ctx.name || '+' + ctx.senderNum };
    touch(g);
    arcade(ctx).set(ctx.chat, g);
    return g;
  }
  function stopIfAsked(ctx, game) {
    if (!/^(end|stop|quit)$/i.test(ctx.argv[0] || '')) return false;
    const g = arcade(ctx).get(ctx.chat);
    if (!g || g.type !== game) throw new UserError(`No ${game} game is running here.`);
    if (g.owner.id !== ctx.senderNum && !ctx.isOwner) throw new UserError(`Only ${g.owner.name} (or the bot owner) can end this game.`);
    arcade(ctx).delete(ctx.chat);
    ctx.reply('🏁 Game ended.');
    return true;
  }
  const cap = {
    snake: (ctx, g) => `🐍 Snake • Score ${g.score}${bestLine(ctx, 'snake')}\nSend w a s d (or 8 4 2 6). Chain: 6662 • r = restart`,
    sokoban: (g, extra = '') => `🧱 Sokoban • Level ${g.level + 1}/${LEVELS.length} • Moves ${g.moves}${extra}\nw a s d • z undo • r restart`,
    tetris: (ctx, g, extra = '') => `🧩 Tetris • Score ${g.score} • Lines ${g.lines} • Next: ${g.next}${extra}${g.pieces ? '' : bestLine(ctx, 'tetris')}\nSend a d w s (or 4 6 8 2) • x = drop • r = restart`
  };

  def('snake', { cat: 'game', usage: 'snake • snake end', desc: 'Play Snake in chat as a picture card. Send w/a/s/d (or 8/4/2/6, chain them like 6662) to steer. Eat 🍎, avoid walls and yourself.' }, async ctx => {
    if (stopIfAsked(ctx, 'snake')) return;
    const g = start(ctx, snakeNew);
    await sendCard(ctx, g, cap.snake(ctx, g));
  });

  def('sokoban', { cat: 'game', usage: 'sokoban [level 1-' + LEVELS.length + '] • sokoban end', desc: 'Sokoban: push every box onto a target. Send w/a/s/d (or 8/4/2/6, chain them), z = undo, r = restart.' }, async ctx => {
    if (stopIfAsked(ctx, 'sokoban')) return;
    const n = Math.min(LEVELS.length, Math.max(1, parseInt(ctx.argv[0], 10) || 1)) - 1;
    const g = start(ctx, () => sokoLoad(n));
    await sendCard(ctx, g, cap.sokoban(g));
  });

  def('tetris', { cat: 'game', usage: 'tetris • tetris end', desc: 'Play Tetris in chat as a picture card. a/d (4/6) move, w (8) rotate, s (2) down, x (5) drop. The piece falls one row after each message.' }, async ctx => {
    if (stopIfAsked(ctx, 'tetris')) return;
    const g = start(ctx, tetrisNew);
    await sendCard(ctx, g, cap.tetris(ctx, g));
  });

  hooks.push({
    name: 'arcade', run: async ctx => {
      const g = ctx.rt.arcade?.get(ctx.chat);
      if (!g || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.')) return false;
      if (g.owner.id !== ctx.senderNum) return false;
      const text = ctx.text.trim();
      const lower = text.toLowerCase();

      /* restart (snake / tetris); sokoban handles r below */
      if (lower === 'r' && g.type !== 'sokoban') {
        const fresh = Object.assign(g.type === 'snake' ? snakeNew() : tetrisNew(), { owner: g.owner });
        touch(fresh);
        arcade(ctx).set(ctx.chat, fresh);
        await sendCard(ctx, fresh, `🔄 Restarted\n${g.type === 'snake' ? cap.snake(ctx, fresh) : cap.tetris(ctx, fresh)}`);
        return true;
      }

      /* ---- snake ---- */
      if (g.type === 'snake') {
        const moves = parseMoves(text);
        if (!moves) return false;
        touch(g);
        let status = 'ok';
        for (const m of moves) { status = snakeStep(g, m); if (status === 'dead' || status === 'won') break; }
        if (g.over) {
          arcade(ctx).delete(ctx.chat);
          const rec = best(ctx, 'snake', g.score, g.owner.name);
          await sendCard(ctx, g, `${status === 'won' ? '🏆 You filled the whole board!' : '💀 Game over!'} Score: ${g.score}${rec ? '\n🎉 New best score!' : ''}${bestLine(ctx, 'snake')}\nPlay again: ${P(ctx)}snake`, { title: status === 'won' ? 'YOU WIN' : 'GAME OVER', sub: `SCORE ${g.score}`, hint: rec ? 'NEW BEST!' : '' });
          return true;
        }
        await sendCard(ctx, g, cap.snake(ctx, g));
        return true;
      }

      /* ---- sokoban ---- */
      if (g.type === 'sokoban') {
        let note = '';
        if (lower === 'r') { Object.assign(g, sokoLoad(g.level), { owner: g.owner }); note = ' • 🔄 restarted'; }
        else if (lower === 'z') { if (!sokoUndo(g)) { await ctx.react('🚫'); return true; } note = ' • ↩️ undone'; }
        else {
          const moves = parseMoves(text);
          if (!moves) return false;
          let moved = false;
          for (const m of moves) { if (sokoMove(g, m)) moved = true; if (g.won) break; }
          if (!moved) { await ctx.react('🚫'); return true; }
        }
        touch(g);
        if (g.won) {
          const moves = g.moves, lvl = g.level;
          if (lvl + 1 < LEVELS.length) {
            const next = Object.assign(sokoLoad(lvl + 1), { owner: g.owner });
            touch(next);
            arcade(ctx).set(ctx.chat, next);
            await sendCard(ctx, g, `🎉 Level ${lvl + 1} solved in ${moves} moves! Next up: Level ${lvl + 2}/${LEVELS.length}`, { title: 'LEVEL CLEAR', sub: `${moves} MOVES` });
            await sendCard(ctx, next, cap.sokoban(next));
          } else {
            arcade(ctx).delete(ctx.chat);
            await sendCard(ctx, g, `🏆 All levels complete! Great work.`, { title: 'ALL CLEAR', sub: 'YOU FINISHED SOKOBAN' });
          }
          return true;
        }
        await sendCard(ctx, g, cap.sokoban(g, note));
        return true;
      }

      /* ---- tetris ---- */
      if (g.type === 'tetris') {
        const keys = tetrisKeys(text);
        if (!keys) return false;
        touch(g);
        let cleared = 0, dropped = false;
        for (const k of keys) {
          cleared += tApply(g, k);
          if (k === 'hard' || k === 'down') dropped = true;
          if (g.over) break;
        }
        if (!g.over && !dropped) cleared += tDown(g); // gravity: one row per message
        const line = cleared ? ` • ✨ ${cleared} line${cleared > 1 ? 's' : ''} cleared!` : '';
        if (g.over) {
          arcade(ctx).delete(ctx.chat);
          const rec = best(ctx, 'tetris', g.score, g.owner.name);
          await sendCard(ctx, g, `💀 Game over! Score: ${g.score} • Lines: ${g.lines}${rec ? '\n🎉 New best score!' : ''}${bestLine(ctx, 'tetris')}\nPlay again: ${P(ctx)}tetris`, { title: 'GAME OVER', sub: `SCORE ${g.score}`, hint: rec ? 'NEW BEST!' : `LINES ${g.lines}` });
          return true;
        }
        await sendCard(ctx, g, cap.tetris(ctx, g, line));
        return true;
      }
      return false;
    }
  });

  tickers.push({
    name: 'arcade-timeouts', run: async api => {
      const m = api.rt.arcade;
      if (!m?.size) return;
      for (const [chat, g] of [...m.entries()]) {
        if (Date.now() < g.deadline) continue;
        m.delete(chat);
        await api.sendTo(chat, { text: api.frame(`⌛ ${g.type[0].toUpperCase() + g.type.slice(1)} ended: no moves for 10 minutes.${g.score ? `\nScore: ${bold(String(g.score))}` : ''}`) }).catch(() => {});
      }
    }
  });
};

module.exports._test = {
  LEVELS, renderCard, parseMoves, snakeNew, snakeStep, snakeFood, sokoLoad, sokoMove, sokoUndo, tetrisNew, tApply, tDown, tHard, tLock, cellsOf, tetrisRender, snakeRender, sokoRender,
  setRng: f => { rng = f; }, dims: { SN, TW, TH }
};
