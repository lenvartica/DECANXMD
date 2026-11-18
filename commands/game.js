'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = b => { for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x]; return null; };
const render = b => [0, 3, 6].map(r => [0, 1, 2].map(c => { const v = b[r + c]; return v === 'X' ? '❌' : v === 'O' ? '⭕' : NUM[r + c]; }).join(' ')).join('\n');
function minimax(b, turn, me) {
  const w = winner(b);
  if (w) return { score: w === me ? 10 : -10 };
  const free = b.map((v, i) => (v ? null : i)).filter(i => i !== null);
  if (!free.length) return { score: 0 };
  let best = null;
  for (const i of free) {
    b[i] = turn;
    const s = minimax(b, turn === 'X' ? 'O' : 'X', me).score;
    b[i] = null;
    if (best === null || (turn === me ? s > best.score : s < best.score)) best = { score: s, move: i };
  }
  return best;
}

const dictCache = new Map();
async function isWord(w) {
  w = w.toLowerCase();
  if (dictCache.has(w)) return dictCache.get(w);
  try {
    const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w), { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) { dictCache.set(w, false); return false; }
    if (res.ok) { dictCache.set(w, true); return true; }
  } catch {}
  return /^[a-z]{3,}$/.test(w) && /[aeiouy]/.test(w); // dictionary unreachable: accept plausible words
}

const board = g => Object.values(g.scores).sort((a, b) => b.n - a.n).map((s, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${s.name || s.id}: ${bold(String(s.n))}`).join('\n') || 'Nobody scored.';
const FRAGMENTS = ['str', 'tra', 'pre', 'con', 'com', 'sta', 'pro', 'ter', 'dis', 'sho', 'cha', 'bri', 'gra', 'spe', 'har', 'wor', 'mon', 'for'];

module.exports = ({ def, hooks, tickers }) => {
  /* --------------------------- tic tac toe ---------------------------- */
  def(['tictactoe', 'ttt'], { cat: 'game', usage: 'tictactoe @opponent | tictactoe (in private: play the bot) | tictactoe end', desc: 'Play Tic-Tac-Toe. Send a number 1-9 to place your mark.' }, async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    if (/^(end|stop)$/i.test(ctx.argv[0] || '')) {
      if (!g || g.type !== 'ttt') throw new UserError('No Tic-Tac-Toe game is running here.');
      ctx.rt.games.delete(ctx.chat);
      return ctx.reply('🏁 Game ended.');
    }
    if (g) throw new UserError(`A ${g.type === 'ttt' ? 'Tic-Tac-Toe' : 'word'} game is already running here. Finish it first (${ctx.var('PREFIX')}${g.type === 'ttt' ? 'tictactoe' : g.type} end).`);
    let opp = null;
    const t = ctx.isGroup ? ctx.targets()[0] : null;
    if (t) { opp = { id: ctx.jidUser(t), jid: t, name: '@' + ctx.jidUser(t) }; if (ctx.botIds().includes(opp.id) || opp.id === ctx.senderNum) throw new UserError('Pick someone else to play against.'); }
    else if (!ctx.isGroup || /bot/i.test(ctx.args)) opp = { id: 'bot', name: 'Bot' };
    else throw new UserError(`Mention your opponent: *${ctx.var('PREFIX')}tictactoe @friend* — or add *bot* to play me.`);
    const game = { type: 'ttt', board: Array(9).fill(null), X: { id: ctx.senderNum, name: ctx.name || '+' + ctx.senderNum }, O: opp, turn: 'X', deadline: Date.now() + 5 * 60000 };
    ctx.rt.games.set(ctx.chat, game);
    await ctx.send({ text: ctx.frame(`❌ ${bold(game.X.name)}  vs  ⭕ ${bold(opp.name)}\n\n${render(game.board)}\n\n${game.X.name} starts. Send a number *1-9*.`, { title: 'Tic-Tac-Toe' }), mentions: opp.jid ? [opp.jid] : [] }, { quoted: ctx.msg });
  });

  /* ------------------------ word chain game --------------------------- */
  def('wcg', { cat: 'game', group: true, usage: 'wcg • wcg end • wcg score', desc: 'Word Chain Game: each word must start with the last letter of the previous word. 60 seconds per word.' }, async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    const a = (ctx.argv[0] || '').toLowerCase();
    if (a === 'end' || a === 'stop') {
      if (!g || g.type !== 'wcg') throw new UserError('No word chain game is running.');
      ctx.rt.games.delete(ctx.chat);
      return ctx.reply(`🏁 ${bold('Game over!')}\n\n${board(g)}`, { title: 'Word Chain' });
    }
    if (a === 'score') {
      if (!g || g.type !== 'wcg') throw new UserError('No word chain game is running.');
      return ctx.reply(board(g), { title: 'Scores' });
    }
    if (g) throw new UserError('A game is already running here.');
    ctx.rt.games.set(ctx.chat, { type: 'wcg', words: new Set(), last: null, lastPlayer: null, scores: {}, deadline: Date.now() + 90000 });
    await ctx.reply(`🔤 ${bold('Word Chain starts!')}\n\n• Send a real English word (3+ letters), e.g. *apple*\n• The next word must start with the last letter of the previous word\n• No repeats, and you can't play twice in a row\n• ⏱ 60 seconds per word\n\nSend the first word now!\nEnd with *${ctx.var('PREFIX')}wcg end*`, { title: 'Word Chain' });
  });

  /* ----------------------- word random game --------------------------- */
  def('wrg', { cat: 'game', group: true, usage: 'wrg • wrg end', desc: 'Word Random Game: make words that start with the given letters before time runs out (90 seconds).' }, async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    const a = (ctx.argv[0] || '').toLowerCase();
    if (a === 'end' || a === 'stop') {
      if (!g || g.type !== 'wrg') throw new UserError('No word game is running.');
      ctx.rt.games.delete(ctx.chat);
      return ctx.reply(`🏁 ${bold('Round over!')}\n\n${board(g)}`, { title: 'Word Random' });
    }
    if (g) throw new UserError('A game is already running here.');
    const fragment = U.pick(FRAGMENTS);
    ctx.rt.games.set(ctx.chat, { type: 'wrg', fragment, words: new Set(), scores: {}, deadline: Date.now() + 90000 });
    await ctx.reply(`🎲 ${bold('Word Random!')}\n\nMake real English words that START with:\n\n   ✨ *${fragment.toUpperCase()}* ✨\n\n• Each valid word scores its length in points\n• No repeats\n• ⏱ 90 seconds — go!`, { title: 'Word Random' });
  });

  /* ------------------------------ input hook -------------------------- */
  hooks.push({
    name: 'games', run: async ctx => {
      const g = ctx.rt.games.get(ctx.chat);
      if (!g || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.')) return false;

      if (g.type === 'ttt') {
        if (!/^[1-9]$/.test(ctx.text)) return false;
        const cur = g[g.turn];
        if (cur.id !== ctx.senderNum) return false;
        const i = Number(ctx.text) - 1;
        if (g.board[i]) { await ctx.react('🚫'); return true; }
        g.board[i] = g.turn;
        const finish = async (msg) => { ctx.rt.games.delete(ctx.chat); await ctx.send({ text: ctx.frame(`${render(g.board)}\n\n${msg}`, { title: 'Tic-Tac-Toe' }), mentions: [g.X.jid, g.O.jid].filter(Boolean) }, { quoted: ctx.msg }); };
        let w = winner(g.board);
        if (w) { await finish(`🏆 ${bold(g[w].name)} wins!`); return true; }
        if (g.board.every(Boolean)) { await finish('🤝 It\'s a draw!'); return true; }
        g.turn = g.turn === 'X' ? 'O' : 'X';
        if (g[g.turn].id === 'bot') {
          const mv = minimax([...g.board], g.turn, g.turn).move;
          g.board[mv] = g.turn;
          w = winner(g.board);
          if (w) { await finish('🤖 The bot wins this time!'); return true; }
          if (g.board.every(Boolean)) { await finish('🤝 It\'s a draw!'); return true; }
          g.turn = g.turn === 'X' ? 'O' : 'X';
        }
        g.deadline = Date.now() + 5 * 60000;
        await ctx.send({ text: ctx.frame(`${render(g.board)}\n\n${g.turn === 'X' ? '❌' : '⭕'} ${bold(g[g.turn].name)}'s turn`, { title: 'Tic-Tac-Toe' }), mentions: [g[g.turn].jid].filter(Boolean) }, { quoted: ctx.msg });
        return true;
      }

      if (!/^[A-Za-z]{3,20}$/.test(ctx.text)) return false;
      const w = ctx.text.toLowerCase();
      if (g.type === 'wcg') {
        if (g.lastPlayer === ctx.senderNum && Object.keys(g.scores).length) { await ctx.react('🚫'); return true; }
        if (g.words.has(w) || (g.last && w[0] !== g.last)) { await ctx.react('❌'); return true; }
      } else if (g.type === 'wrg') {
        if (!w.startsWith(g.fragment) || w.length < g.fragment.length + 2 || g.words.has(w)) { await ctx.react('❌'); return true; }
      } else return false;
      if (!(await isWord(w))) { await ctx.react('❌'); return true; }
      g.words.add(w);
      const s = g.scores[ctx.senderNum] || (g.scores[ctx.senderNum] = { id: '+' + ctx.senderNum, name: ctx.name, n: 0 });
      s.n += g.type === 'wrg' ? w.length : 1;
      if (g.type === 'wcg') {
        g.last = w[w.length - 1]; g.lastPlayer = ctx.senderNum; g.deadline = Date.now() + 60000;
        await ctx.react('✅');
        await ctx.send({ text: `Next word starts with *${g.last.toUpperCase()}*` }, { quoted: ctx.msg });
      } else await ctx.react('✅');
      return true;
    }
  });

  /* ------------------------------ timeouts ---------------------------- */
  tickers.push({
    name: 'gameTimeouts', run: async api => {
      for (const [chat, g] of [...api.rt.games.entries()]) {
        if (Date.now() < g.deadline) continue;
        api.rt.games.delete(chat);
        const txt = g.type === 'ttt' ? '⌛ Tic-Tac-Toe ended (no moves for 5 minutes).'
          : g.type === 'wcg' ? `⌛ ${bold('Time is up!')}\n\n${board(g)}` : `⌛ ${bold('Round over!')}\n\n${board(g)}`;
        await api.sendTo(chat, { text: api.frame(txt) }).catch(() => {});
      }
    }
  });
};
