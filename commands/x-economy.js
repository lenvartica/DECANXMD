'use strict';
/**
 * Coins economy (shares the wallet used by .daily/.hunt), one-message games, word/math games played in chat,
 * zodiac & fortune helpers, and friendly reaction GIFs (hug, pat, wave ...).
 * Balances live in the same per-session store as the hunter profile, so everything adds up in one place.
 */
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, bold, getJson, http } = U;

const rnd = n => crypto.randomInt(n);
const pick = a => a[rnd(a.length)];
const between = (a, b) => a + rnd(b - a + 1);
const fmtN = n => Math.floor(n).toLocaleString('en-US');
const mins = ms => { const s = Math.ceil(ms / 1000); return s >= 3600 ? `${Math.ceil(s / 3600)} hour(s)` : s >= 60 ? `${Math.ceil(s / 60)} minute(s)` : `${s} second(s)`; };

const SHOP = {
  fishingrod: { price: 150, desc: 'Better catches from .fish' },
  pickaxe: { price: 200, desc: 'Better ore from .mine' },
  seeds: { price: 100, desc: 'Bigger harvests from .farm' },
  petfood: { price: 20, desc: 'Feeds your pet fully (.use petfood)' },
  luckycharm: { price: 300, desc: 'Boosts your next 3 gambles (.use luckycharm)' },
  medkit: { price: 60, desc: 'Cancels the coin loss of your next lost hunt/battle (.use medkit)' }
};
const WORDS = 'planet garden bridge rocket pencil jungle market island silver castle dragon forest guitar window orange pirate shadow thunder velvet whisper compass diamond harvest journey lantern mystery network oxygen puzzle quantum rainbow sunrise treasure volcano wizard zebra backpack campfire festival horizon keyboard library mountain notebook passport telescope umbrella village'.split(' ');
const FORTUNES = ['A pleasant surprise is waiting for you.', 'Your hard work will soon be noticed.', 'Today is a good day to start something new.', 'A friend will bring you good news.', 'Patience will pay off more than you expect.', 'Say yes to the next small adventure.', 'Money saved today becomes freedom tomorrow.', 'Someone is thinking of you right now.', 'A challenge you fear is smaller than it looks.', 'Fortune favours the one who tries.'];
const MOTIVATION = ['Small steps every day beat big plans someday.', 'You do not have to be perfect, just keep going.', 'Discipline is choosing what you want most over what you want now.', 'Your future self is watching what you do today.', 'Progress, not perfection.', 'Hard days build strong people.', 'Start where you are, use what you have, do what you can.', 'The best time to begin was yesterday; the next best is now.', 'Doubt kills more dreams than failure ever will.', 'Be so consistent that luck has no choice but to show up.'];
const SIGNS = [['capricorn', '♑', [12, 22]], ['aquarius', '♒', [1, 20]], ['pisces', '♓', [2, 19]], ['aries', '♈', [3, 21]], ['taurus', '♉', [4, 20]], ['gemini', '♊', [5, 21]], ['cancer', '♋', [6, 21]], ['leo', '♌', [7, 23]], ['virgo', '♍', [8, 23]], ['libra', '♎', [9, 23]], ['scorpio', '♏', [10, 23]], ['sagittarius', '♐', [11, 22]]];
const signOf = (m, d) => { let s = SIGNS[0]; for (const x of SIGNS) { if (m > x[2][0] || (m === x[2][0] && d >= x[2][1])) s = x; } return m === 1 && d < 20 ? SIGNS[0] : s; };
const REACT = {
  hug: ['hugs', 'hug'], pat: ['pats', 'pat'], slap: ['slaps', 'slap'], punch: ['punches', 'punch'], bite: ['bites', 'bite'], cuddle: ['cuddles', 'cuddle'], wave: ['waves at', 'wave'], smile: ['smiles at', 'smile'],
  cry: ['is crying with', 'cry'], dance: ['dances with', 'dance'], blush: ['blushes at', 'blush'], shrug: ['shrugs at', 'shrug'], facepalm: ['facepalms at', 'facepalm'], highfive: ['high-fives', 'highfive'], handshake: ['shakes hands with', 'handshake']
};
const EMOJI_ALPHA = { 0: '0️⃣', 1: '1️⃣', 2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣', 6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣', '!': '❗', '?': '❓' };
const emojify = t => [...t.toLowerCase()].map(c => (/[a-z]/.test(c) ? String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 97) + '\u200B' : EMOJI_ALPHA[c] || (c === ' ' ? '   ' : c))).join('');
const cards = () => { const d = []; for (const s of '♠♥♦♣') for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) d.push(r + s); for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1);[d[i], d[j]] = [d[j], d[i]]; } return d; };
const val = h => { let t = 0, a = 0; for (const c of h) { const r = c.slice(0, -1); if (r === 'A') { a++; t += 11; } else t += 'JQK'.includes(r) ? 10 : Number(r); } while (t > 21 && a--) t -= 10; return t; };

module.exports = ({ def: rawDef, alias: rawAlias, registry, hooks, tickers }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');

  /* ----------------------------------- player store ----------------------------------- */
  const keyOf = (ctx, num) => `decanxmd_player_${num || ctx.senderNum || ctx.chat}`;
  const fresh = (ctx, num) => ({ name: String(ctx.name || 'Player').replace(/[\r\n*_~]/g, '').slice(0, 32), level: 1, xp: 0, coins: 100, wins: 0, losses: 0, lastDaily: 0, lastHunt: 0, inventory: ['Starter Dagger'] });
  const load = (ctx, num) => {
    const p = ctx.get(keyOf(ctx, num), null) || fresh(ctx, num);
    p.bank = Number(p.bank) || 0; p.items = p.items || {}; p.cd = p.cd || {}; p.luck = Number(p.luck) || 0; p.shield = Number(p.shield) || 0;
    return p;
  };
  const save = (ctx, p, num) => {
    p.level = Math.max(1, Math.floor(1 + (p.xp || 0) / 250));
    if (!num && ctx.name) p.name = String(ctx.name).replace(/[\r\n*_~]/g, '').slice(0, 32) || p.name;
    ctx.set(keyOf(ctx, num), p);
    ctx.update('eco:index', {}, idx => { idx[num || ctx.senderNum] = { name: p.name, net: p.coins + p.bank, wins: p.wins || 0, losses: p.losses || 0, level: p.level }; });
    return p;
  };
  const cooldown = (p, field, ms) => { const wait = ms - (Date.now() - (p.cd[field] || 0)); if (wait > 0) throw new UserError(`⏳ Try again in ${mins(wait)}.`); p.cd[field] = Date.now(); };
  const amountArg = (s, max, label = 'amount') => { if (/^all$/i.test(s)) return max; const n = Math.floor(Number(String(s).replace(/,/g, ''))); if (!(n > 0)) throw new UserError(`Give a valid ${label}, e.g. *100* or *all*.`); return n; };
  const targetOf = ctx => { const t = ctx.targets?.(true)?.[0]; if (!t) throw new UserError('Mention someone, reply to their message, or give their number.'); return t; };
  const numOf = (ctx, jid) => ctx.jidUser(jid);
  const gamble = (p, win, stake) => { // lucky charm nudges the odds
    if (p.luck > 0 && !win && rnd(100) < 25) { p.luck--; return true; }
    if (p.luck > 0) p.luck--;
    return win;
  };

  /* ------------------------------------ wallet & bank ------------------------------------ */
  def(['balance', 'wallet', 'coins', 'bal'], { cat: 'game', desc: 'Your wallet, bank and net worth.' }, async ctx => {
    const p = save(ctx, load(ctx));
    await ctx.reply(`💰 *${p.name}*\n👛 Wallet: *${fmtN(p.coins)}*\n🏦 Bank: *${fmtN(p.bank)}*\n📊 Net: *${fmtN(p.coins + p.bank)}* coins\n🏅 Level ${p.level} • ✨ ${fmtN(p.xp)} XP`, { title: 'Balance' });
  });
  def('deposit', { cat: 'game', usage: 'deposit <amount|all>', desc: 'Move coins from your wallet to the safe bank.' }, async ctx => {
    const p = load(ctx); const n = amountArg(ctx.argv[0], p.coins);
    if (n > p.coins) throw new UserError(`You only have ${fmtN(p.coins)} coins in your wallet.`);
    p.coins -= n; p.bank += n; save(ctx, p);
    await ctx.reply(`🏦 Deposited *${fmtN(n)}*.\n👛 ${fmtN(p.coins)} • 🏦 ${fmtN(p.bank)}`, { title: 'Bank' });
  });
  def('withdraw', { cat: 'game', usage: 'withdraw <amount|all>', desc: 'Take coins out of the bank.' }, async ctx => {
    const p = load(ctx); const n = amountArg(ctx.argv[0], p.bank);
    if (n > p.bank) throw new UserError(`You only have ${fmtN(p.bank)} coins in the bank.`);
    p.bank -= n; p.coins += n; save(ctx, p);
    await ctx.reply(`🏦 Withdrew *${fmtN(n)}*.\n👛 ${fmtN(p.coins)} • 🏦 ${fmtN(p.bank)}`, { title: 'Bank' });
  });
  def(['transfer', 'pay', 'give'], { cat: 'game', usage: 'transfer <@user> <amount>', desc: 'Send coins to another player.' }, async ctx => {
    const jid = targetOf(ctx); const to = numOf(ctx, jid);
    if (to === ctx.senderNum) throw new UserError('You cannot pay yourself.');
    const p = load(ctx); const raw = ctx.argv.filter(a => !a.startsWith('@') && !/^\+?\d{9,}$/.test(a))[0];
    const n = amountArg(raw, p.coins);
    if (n > p.coins) throw new UserError(`You only have ${fmtN(p.coins)} coins in your wallet.`);
    const q = load(ctx, to);
    p.coins -= n; q.coins += n; save(ctx, p); save(ctx, q, to);
    await ctx.send({ text: `💸 *${p.name}* sent *${fmtN(n)}* coins to @${to}`, mentions: [jid] });
  });

  /* ------------------------------------- earning ------------------------------------- */
  def('work', { cat: 'game', desc: 'Do a job for coins (every 30 minutes).' }, async ctx => {
    const p = load(ctx); cooldown(p, 'work', 30 * 60000);
    const jobs = ['delivered parcels', 'fixed a laptop', 'tutored a student', 'washed cars', 'designed a poster', 'sold mandazi', 'walked dogs', 'coded a landing page'];
    const c = between(40, 140), xp = between(5, 15); p.coins += c; p.xp += xp; save(ctx, p);
    await ctx.reply(`💼 You ${pick(jobs)} and earned *${c}* coins and ${xp} XP.\n👛 Wallet: ${fmtN(p.coins)}`, { title: 'Work' });
  });
  for (const [name, ms, lo, hi, label] of [['weekly', 7 * 864e5, 500, 800, 'Weekly'], ['monthly', 30 * 864e5, 2000, 3000, 'Monthly']]) {
    def(name, { cat: 'game', desc: `Claim your ${name} coin bonus.` }, async ctx => {
      const p = load(ctx); cooldown(p, name, ms); const c = between(lo, hi); p.coins += c; p.xp += c / 20; save(ctx, p);
      await ctx.reply(`🎁 *${label} bonus:* +${fmtN(c)} coins!\n👛 Wallet: ${fmtN(p.coins)}`, { title: label });
    });
  }
  const gather = (name, tool, cd, outcomes, verb) => def(name, { cat: 'game', desc: `${verb} for coins. Better with a ${tool} (see ${'buy'}).` }, async ctx => {
    const p = load(ctx); cooldown(p, name, cd);
    const bonus = (p.items[tool] || 0) > 0 ? 1.6 : 1;
    const [text, lo, hi] = pick(outcomes); const c = Math.round(between(lo, hi) * bonus); p.coins += c; p.xp += Math.ceil(c / 8); save(ctx, p);
    await ctx.reply(`${text} *+${c}* coins${bonus > 1 ? ` _(${tool} bonus)_` : ''}\n👛 Wallet: ${fmtN(p.coins)}`, { title: verb });
  });
  gather('fish', 'fishingrod', 45000, [['🐟 You caught a tilapia!', 10, 30], ['🎣 A big Nile perch!', 30, 70], ['👢 Only an old boot…', 0, 5], ['🦈 A rare catch!', 80, 160]], 'Fishing');
  gather('mine', 'pickaxe', 60000, [['⛏️ You found some copper.', 15, 40], ['💎 A gemstone!', 60, 140], ['🪨 Just rocks.', 0, 8], ['🪙 A gold vein!', 90, 200]], 'Mining');
  gather('farm', 'seeds', 90000, [['🌽 A good maize harvest.', 20, 55], ['🍅 Juicy tomatoes!', 25, 60], ['🐛 Pests ate most of it.', 0, 10], ['🥭 A bumper mango crop!', 70, 150]], 'Farming');

  /* ------------------------------------- shop & items ------------------------------------- */
  def('buy', { cat: 'game', usage: 'buy <item> [amount]', desc: 'Browse the item shop or buy something.' }, async ctx => {
    const item = (ctx.argv[0] || '').toLowerCase();
    if (!item) return ctx.reply(`🛒 *ITEM SHOP*\n\n${Object.entries(SHOP).map(([k, v]) => `• *${k}* — ${v.price} coins\n   ${v.desc}`).join('\n')}\n\nBuy: *${P(ctx)}buy fishingrod*`, { title: 'Shop' });
    const it = SHOP[item]; if (!it) throw new UserError('Unknown item. Send *' + P(ctx) + 'buy* to see the list.');
    const qty = Math.min(99, Math.max(1, Math.floor(Number(ctx.argv[1])) || 1)); const p = load(ctx); const cost = it.price * qty;
    if (p.coins < cost) throw new UserError(`You need ${fmtN(cost)} coins (you have ${fmtN(p.coins)}).`);
    p.coins -= cost; p.items[item] = (p.items[item] || 0) + qty; save(ctx, p);
    await ctx.reply(`✅ Bought *${qty}× ${item}* for ${fmtN(cost)} coins.\n👛 Wallet: ${fmtN(p.coins)}`, { title: 'Shop' });
  });
  def('sell', { cat: 'game', usage: 'sell <item> [amount]', desc: 'Sell an item back for 60% of its price.' }, async ctx => {
    const item = (ctx.argv[0] || '').toLowerCase(); const it = SHOP[item]; const p = load(ctx);
    if (!it) throw new UserError(`Usage: *${P(ctx)}sell fishingrod*`);
    const qty = Math.min(p.items[item] || 0, ctx.argv[1] === 'all' ? 99 : Math.max(1, Math.floor(Number(ctx.argv[1])) || 1));
    if (!qty) throw new UserError(`You do not have any ${item}.`);
    const get = Math.floor(it.price * 0.6) * qty; p.items[item] -= qty; if (!p.items[item]) delete p.items[item]; p.coins += get; save(ctx, p);
    await ctx.reply(`💰 Sold *${qty}× ${item}* for ${fmtN(get)} coins.`, { title: 'Shop' });
  });
  def('use', { cat: 'game', usage: 'use <item>', desc: 'Use an item: petfood, luckycharm or medkit.' }, async ctx => {
    const item = (ctx.argv[0] || '').toLowerCase(); const p = load(ctx);
    if (!['petfood', 'luckycharm', 'medkit'].includes(item)) throw new UserError(`You can use: petfood, luckycharm, medkit.`);
    if (!(p.items[item] > 0)) throw new UserError(`You do not have any ${item}. See *${P(ctx)}buy*.`);
    let msg;
    if (item === 'petfood') { if (!p.pet) throw new UserError('You do not have a pet. Adopt one with *' + P(ctx) + 'pet*.'); p.pet.hunger = 100; msg = `🍖 ${p.pet.name} is full and happy!`; }
    if (item === 'luckycharm') { p.luck += 3; msg = '🍀 Lucky charm active for your next 3 gambles.'; }
    if (item === 'medkit') { p.shield += 1; msg = '🩹 Medkit ready: your next lost hunt/battle will cost no coins.'; }
    p.items[item]--; if (!p.items[item]) delete p.items[item]; save(ctx, p);
    await ctx.reply(msg, { title: 'Item used' });
  });
  def('trade', { cat: 'game', usage: 'trade <@user> <item> [amount]', desc: 'Give an item from your bag to another player.' }, async ctx => {
    const jid = targetOf(ctx); const to = numOf(ctx, jid); if (to === ctx.senderNum) throw new UserError('You cannot trade with yourself.');
    const rest = ctx.argv.filter(a => !a.startsWith('@') && !/^\+?\d{9,}$/.test(a)); const item = (rest[0] || '').toLowerCase(); const qty = Math.max(1, Math.floor(Number(rest[1])) || 1);
    const p = load(ctx); if (!SHOP[item] || (p.items[item] || 0) < qty) throw new UserError(`You do not have ${qty}× ${item || 'that item'}.`);
    const q = load(ctx, to); p.items[item] -= qty; if (!p.items[item]) delete p.items[item]; q.items[item] = (q.items[item] || 0) + qty; save(ctx, p); save(ctx, q, to);
    await ctx.send({ text: `🤝 *${p.name}* gave *${qty}× ${item}* to @${to}`, mentions: [jid] });
  });

  /* ------------------------------------- pets & battles ------------------------------------- */
  const PETS = ['🐶 Dog', '🐱 Cat', '🦊 Fox', '🐉 Dragon', '🦅 Eagle', '🐺 Wolf'];
  const petPower = p => (p.pet ? p.pet.level * 2 + Math.floor((p.pet.hunger || 0) / 25) : 0);
  const power = p => p.level + petPower(p) + (p.inventory?.includes('Knight Blade') ? 2 : 0);
  def('pet', { cat: 'game', usage: 'pet [name]', desc: 'Adopt a pet (200 coins) or see how yours is doing.' }, async ctx => {
    const p = load(ctx);
    if (!p.pet) {
      if (p.coins < 200) throw new UserError(`Adopting a pet costs 200 coins (you have ${fmtN(p.coins)}).`);
      p.coins -= 200; p.pet = { type: pick(PETS), name: (ctx.argv.join(' ') || 'Buddy').slice(0, 20), xp: 0, level: 1, hunger: 100, fed: Date.now() };
      save(ctx, p); return ctx.reply(`🎉 You adopted ${p.pet.type} named *${p.pet.name}*!\nFeed it with *${P(ctx)}feed* and level it up with *${P(ctx)}train*.`, { title: 'Pet' });
    }
    const hrs = (Date.now() - (p.pet.fed || Date.now())) / 36e5; p.pet.hunger = Math.max(0, Math.round(100 - hrs * 4)); p.pet.fed = Date.now(); save(ctx, p);
    await ctx.reply(`${p.pet.type} *${p.pet.name}*\n⭐ Level ${p.pet.level} • ✨ ${p.pet.xp}/100 XP\n🍖 Hunger bar: ${p.pet.hunger}/100`, { title: 'Pet' });
  });
  def('feed', { cat: 'game', desc: 'Feed your pet (10 coins, or use petfood).' }, async ctx => {
    const p = load(ctx); if (!p.pet) throw new UserError('You do not have a pet yet. Use *' + P(ctx) + 'pet*.');
    if (p.items.petfood > 0) { p.items.petfood--; if (!p.items.petfood) delete p.items.petfood; } else { if (p.coins < 10) throw new UserError('Feeding costs 10 coins.'); p.coins -= 10; }
    p.pet.hunger = 100; p.pet.fed = Date.now(); save(ctx, p);
    await ctx.reply(`🍖 ${p.pet.name} enjoyed the meal. Hunger: 100/100`, { title: 'Pet' });
  });
  def('train', { cat: 'game', desc: 'Train your pet to gain levels (every 5 minutes).' }, async ctx => {
    const p = load(ctx); if (!p.pet) throw new UserError('You do not have a pet yet. Use *' + P(ctx) + 'pet*.');
    cooldown(p, 'train', 5 * 60000);
    const xp = between(15, 40); p.pet.xp += xp; let up = '';
    while (p.pet.xp >= 100) { p.pet.xp -= 100; p.pet.level++; up = `\n🎉 *${p.pet.name}* reached level ${p.pet.level}!`; }
    save(ctx, p); await ctx.reply(`🏋️ ${p.pet.name} trained hard: +${xp} XP.${up}`, { title: 'Pet' });
  });
  def('battle', { cat: 'game', desc: 'Fight a random monster with your hunter and pet.' }, async ctx => {
    const p = load(ctx); cooldown(p, 'battle', 45000);
    const m = pick([['Cave Troll', 3, 60], ['Sand Wraith', 5, 90], ['Iron Golem', 7, 140], ['Storm Drake', 9, 220]]);
    const win = gamble(p, power(p) + rnd(8) > m[1] + rnd(8), 0);
    if (win) { p.coins += m[2]; p.xp += m[2] / 2; p.wins++; save(ctx, p); return ctx.reply(`⚔️ You defeated the *${m[0]}*!\n🪙 +${m[2]} coins • ✨ +${Math.floor(m[2] / 2)} XP`, { title: 'Battle' }); }
    const lost = p.shield > 0 ? 0 : Math.min(p.coins, between(10, 40)); if (p.shield > 0) p.shield--; p.coins -= lost; p.losses++; save(ctx, p);
    await ctx.reply(`💥 The *${m[0]}* was too strong.${lost ? ` You dropped ${lost} coins.` : ' Your medkit saved your coins.'}`, { title: 'Battle' });
  });
  def(['challenge'], { cat: 'game', group: true, usage: 'challenge <@user> [bet]', desc: 'Challenge a player to a duel. They accept with .duel' }, async ctx => {
    const jid = targetOf(ctx); const to = numOf(ctx, jid); if (to === ctx.senderNum) throw new UserError('You cannot challenge yourself.');
    const p = load(ctx); const bet = Math.min(500, Math.max(0, Math.floor(Number(ctx.argv.find(a => /^\d{1,4}$/.test(a))) || 0)));
    if (bet > p.coins) throw new UserError(`You only have ${fmtN(p.coins)} coins.`);
    ctx.rt.duels = ctx.rt.duels || new Map(); ctx.rt.duels.set(`${ctx.chat}:${to}`, { from: ctx.senderNum, fromJid: ctx.sender, bet, expires: Date.now() + 120000 });
    await ctx.send({ text: `⚔️ @${to}, *${p.name}* challenges you to a duel${bet ? ` for *${bet}* coins` : ''}!\nSend *${P(ctx)}duel* within 2 minutes to accept.`, mentions: [jid] });
  });
  def('duel', { cat: 'game', group: true, usage: 'duel', desc: 'Accept a challenge made to you (see .challenge).' }, async ctx => {
    const ch = ctx.rt.duels?.get(`${ctx.chat}:${ctx.senderNum}`);
    if (!ch || ch.expires < Date.now()) throw new UserError(`Nobody has challenged you here. Use *${P(ctx)}challenge @user 50* to challenge someone.`);
    ctx.rt.duels.delete(`${ctx.chat}:${ctx.senderNum}`);
    const a = load(ctx, ch.from), b = load(ctx);
    if (ch.bet > a.coins || ch.bet > b.coins) throw new UserError('One of you no longer has enough coins for that bet.');
    const sa = power(a) + rnd(10), sb = power(b) + rnd(10); const aWins = sa >= sb; const [w, l] = aWins ? [a, b] : [b, a];
    w.coins += ch.bet; l.coins -= ch.bet; w.wins++; l.losses++; w.xp += 25; save(ctx, a, ch.from); save(ctx, b);
    await ctx.send({ text: `🥊 *DUEL RESULT*\n${a.name}: ${sa}  vs  ${b.name}: ${sb}\n🏆 Winner: *${w.name}*${ch.bet ? `  (+${ch.bet} coins)` : ''}`, mentions: [ch.fromJid, ctx.sender].filter(Boolean) });
  });
  def('tournament', { cat: 'game', group: true, desc: 'Simulate a tournament between the top players of this bot (once an hour per chat).' }, async ctx => {
    const idx = ctx.get('eco:index', {}); const top = Object.entries(idx).sort((a, b) => b[1].level - a[1].level || b[1].net - a[1].net).slice(0, 8);
    if (top.length < 4) throw new UserError('Not enough players yet. At least 4 people need to have used the economy commands (try *' + P(ctx) + 'daily* and *' + P(ctx) + 'work*).');
    if (ctx.get(`tour:${ctx.chat}`, 0) > Date.now() - 36e5) throw new UserError('A tournament already ran here in the last hour.');
    ctx.set(`tour:${ctx.chat}`, Date.now());
    let round = top.map(([n, v]) => ({ n, name: v.name, s: v.level })); const log = [];
    while (round.length > 1) { const next = []; for (let i = 0; i < round.length; i += 2) { const x = round[i], y = round[i + 1]; if (!y) { next.push(x); continue; } const win = x.s + rnd(8) >= y.s + rnd(8) ? x : y; log.push(`${x.name} vs ${y.name} → *${win.name}*`); next.push(win); } round = next; }
    const champ = round[0]; const p = load(ctx, champ.n); p.coins += 200; p.wins++; save(ctx, p, champ.n);
    await ctx.reply(`🏆 *TOURNAMENT*\n\n${log.join('\n')}\n\n👑 Champion: *${champ.name}* (+200 coins)`, { title: 'Tournament' });
  });

  /* ------------------------------------ gambling & luck ------------------------------------ */
  def('spin', { cat: 'game', usage: 'spin <bet>', desc: 'Spin the wheel of fortune with a bet.' }, async ctx => {
    const p = load(ctx); const bet = amountArg(ctx.argv[0], Math.min(p.coins, 1000), 'bet');
    if (bet > p.coins) throw new UserError(`You only have ${fmtN(p.coins)} coins.`); if (bet > 1000) throw new UserError('The maximum bet is 1000.');
    const seg = pick([[0, '💀 BUST'], [0, '💀 BUST'], [0, '💀 BUST'], [0.5, '😬 HALF'], [1, '🙂 BREAK EVEN'], [1.5, '😎 x1.5'], [2, '🤑 x2'], [5, '🎰 JACKPOT x5']]);
    const win = gamble(p, seg[0] >= 1, bet); const mult = win && seg[0] < 1 ? 1 : seg[0];
    const delta = Math.round(bet * mult) - bet; p.coins += delta; (delta > 0 ? p.wins++ : delta < 0 && p.losses++); save(ctx, p);
    await ctx.reply(`🎡 ${seg[1]}\n${delta >= 0 ? '+' : ''}${fmtN(delta)} coins\n👛 Wallet: ${fmtN(p.coins)}`, { title: 'Wheel of fortune' });
  });
  def('lottery', { cat: 'game', desc: 'Buy a 50-coin ticket. A 1 in 20 chance wins the growing jackpot.' }, async ctx => {
    const p = load(ctx); if (p.coins < 50) throw new UserError('A ticket costs 50 coins.');
    const pot = Math.max(500, ctx.get('lottery:pot', 500)); p.coins -= 50;
    if (gamble(p, rnd(20) === 0, 50)) { p.coins += pot + 50; p.wins++; ctx.set('lottery:pot', 500); save(ctx, p); return ctx.reply(`🎉 *JACKPOT!* You won *${fmtN(pot + 50)}* coins!`, { title: 'Lottery' }); }
    ctx.set('lottery:pot', pot + 40); p.losses++; save(ctx, p);
    await ctx.reply(`🎟️ No luck this time. The jackpot is now *${fmtN(pot + 40)}* coins.`, { title: 'Lottery' });
  });
  def(['fortune', 'fortunecookie'], { cat: 'game', desc: 'Open a fortune cookie.' }, ctx => ctx.reply(`🥠 ${pick(FORTUNES)}\n🍀 Lucky number: *${between(1, 99)}*`, { title: 'Fortune' }));
  def('motivation', { cat: 'game', desc: 'A short motivational line.' }, ctx => ctx.reply(`💪 ${pick(MOTIVATION)}`, { title: 'Motivation' }));
  def('advice', { cat: 'game', desc: 'A piece of random advice.' }, async ctx => {
    let t; try { t = (await getJson('https://api.adviceslip.com/advice', { timeout: 8000 })).slip?.advice; } catch {}
    await ctx.reply(`💡 ${t || pick(MOTIVATION)}`, { title: 'Advice' });
  });
  alias('coinflip', 'flipcoin'); alias('rps', 'rockpaperscissors');

  /* -------------------------------------- blackjack -------------------------------------- */
  const show = (g, hide) => `🃏 You: ${g.hand.join(' ')} = *${val(g.hand)}*\n🎩 Dealer: ${hide ? g.dealer[0] + ' ??' : g.dealer.join(' ') + ' = *' + val(g.dealer) + '*'}`;
  def('blackjack', { cat: 'game', usage: 'blackjack <bet>', desc: 'Play blackjack against the dealer. Reply hit or stand.' }, async ctx => {
    if (ctx.rt.games.has(ctx.chat)) throw new UserError('A game is already running in this chat. Finish it first.');
    const p = load(ctx); const bet = amountArg(ctx.argv[0], Math.min(p.coins, 500), 'bet');
    if (bet > p.coins) throw new UserError(`You only have ${fmtN(p.coins)} coins.`); if (bet > 500) throw new UserError('The maximum bet is 500.');
    const deck = cards(); const g = { type: 'x-bj', player: ctx.senderNum, bet, deck, hand: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], deadline: Date.now() + 90000 };
    ctx.rt.games.set(ctx.chat, g);
    if (val(g.hand) === 21) return finishBj(ctx, g);
    await ctx.reply(`${show(g, true)}\n\nReply *hit* or *stand* (90 seconds).`, { title: `Blackjack — bet ${bet}` });
  });
  async function finishBj(ctx, g) {
    ctx.rt.games.delete(ctx.chat);
    while (val(g.dealer) < 17) g.dealer.push(g.deck.pop());
    const pv = val(g.hand), dv = val(g.dealer); const p = load(ctx);
    let delta, res;
    if (pv > 21) { delta = -g.bet; res = '💥 Bust! You lose.'; } else if (pv === 21 && g.hand.length === 2) { if (dv === 21 && g.dealer.length === 2) { delta = 0; res = '🤝 Both have blackjack — push.'; } else { delta = Math.floor(g.bet * 1.5); res = '🎉 Blackjack!'; } } else if (dv > 21 || pv > dv) { delta = g.bet; res = '🏆 You win!'; } else if (pv === dv) { delta = 0; res = '🤝 Push.'; } else { delta = -g.bet; res = '😔 Dealer wins.'; }
    p.coins += delta; delta > 0 ? p.wins++ : delta < 0 && p.losses++; save(ctx, p);
    await ctx.reply(`${show(g, false)}\n\n${res} ${delta >= 0 ? '+' : ''}${delta} coins\n👛 Wallet: ${fmtN(p.coins)}`, { title: 'Blackjack' });
  }
  hooks.push({ name: 'x-blackjack', run: async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    if (!g || g.type !== 'x-bj' || g.player !== ctx.senderNum || !ctx.fresh || !ctx.text) return false;
    const t = ctx.text.trim().toLowerCase();
    if (/^(hit|h)$/.test(t)) { g.hand.push(g.deck.pop()); if (val(g.hand) >= 21) await finishBj(ctx, g); else await ctx.reply(`${show(g, true)}\n\nReply *hit* or *stand*.`, { title: 'Blackjack' }); return true; }
    if (/^(stand|s)$/.test(t)) { await finishBj(ctx, g); return true; }
    return false;
  } });

  /* --------------------------- word & math games played in chat --------------------------- */
  const startGame = (ctx, g) => { if (ctx.rt.games.has(ctx.chat)) throw new UserError('A game is already running in this chat. Finish it (or wait for it to time out) first.'); ctx.rt.games.set(ctx.chat, { ...g, deadline: Date.now() + (g.secs || 90) * 1000 }); };
  const reward = async (ctx, c) => { const p = load(ctx); p.coins += c; p.wins++; p.xp += 10; save(ctx, p); return p; };
  def('hangman', { cat: 'game', usage: 'hangman [stop]', desc: 'Guess the word letter by letter. Anyone in the chat can play.' }, async ctx => {
    if (/^(stop|end)$/i.test(ctx.args)) { if (ctx.rt.games.get(ctx.chat)?.type === 'x-hang') { ctx.rt.games.delete(ctx.chat); return ctx.reply('Hangman stopped.'); } return; }
    startGame(ctx, { type: 'x-hang', word: pick(WORDS), guessed: new Set(), lives: 6, secs: 180 });
    const g = ctx.rt.games.get(ctx.chat);
    await ctx.reply(`🪢 *HANGMAN*\n\n${board(g)}\n\n❤️ Lives: ${g.lives}\nSend a *letter* (or the whole word). 3 minutes.`, { title: 'Hangman' });
  });
  const board = g => [...g.word].map(c => (g.guessed.has(c) ? c.toUpperCase() : '＿')).join(' ');
  def('mathgame', { cat: 'game', usage: 'mathgame', desc: 'First person to type the right answer wins coins.' }, async ctx => {
    const a = between(6, 40), b = between(3, 20), op = pick(['+', '-', '×']); const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
    startGame(ctx, { type: 'x-math', ans: String(ans), secs: 30 });
    await ctx.reply(`🧮 What is *${a} ${op} ${b}*?\nFirst correct answer wins (30 seconds).`, { title: 'Math game' });
  });
  def('puzzle', { cat: 'game', usage: 'puzzle', desc: 'Number-sequence puzzle: what comes next? First correct answer wins.' }, async ctx => {
    const s = between(1, 9), d = between(2, 7), kind = rnd(3); let seq, ans;
    if (kind === 0) { seq = [0, 1, 2, 3].map(i => s + d * i); ans = s + d * 4; } else if (kind === 1) { seq = [0, 1, 2, 3].map(i => s * 2 ** i); ans = s * 16; } else { seq = [0, 1, 2, 3].map(i => (i + s) ** 2); ans = (4 + s) ** 2; }
    startGame(ctx, { type: 'x-math', ans: String(ans), secs: 60 });
    await ctx.reply(`🧩 What comes next?\n*${seq.join(', ')}, ?*\nFirst correct answer wins (60 seconds).`, { title: 'Puzzle' });
  });
  def('scramble', { cat: 'game', usage: 'scramble', desc: 'Unscramble the word. First correct answer wins coins.' }, async ctx => {
    const w = pick(WORDS); let s; do { s = [...w].sort(() => rnd(3) - 1).join(''); } while (s === w);
    startGame(ctx, { type: 'x-scr', word: w, secs: 45 });
    await ctx.reply(`🔀 Unscramble: *${s.toUpperCase()}*\nFirst correct answer wins (45 seconds).`, { title: 'Scramble' });
  });
  hooks.push({ name: 'x-wordgames', run: async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    if (!g || !['x-hang', 'x-math', 'x-scr'].includes(g.type) || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.')) return false;
    const t = ctx.text.trim().toLowerCase();
    if (g.type === 'x-math' && t === g.ans) { ctx.rt.games.delete(ctx.chat); const p = await reward(ctx, 25); await ctx.reply(`✅ Correct, *${p.name}*! +25 coins`, { title: 'Winner' }); return true; }
    if (g.type === 'x-scr' && t === g.word) { ctx.rt.games.delete(ctx.chat); const p = await reward(ctx, 30); await ctx.reply(`✅ *${g.word.toUpperCase()}* — well done, *${p.name}*! +30 coins`, { title: 'Winner' }); return true; }
    if (g.type === 'x-hang') {
      if (!/^[a-z]+$/.test(t) || g.guessed.has(t)) return false;
      if (t.length > 1) { if (t === g.word) { [...g.word].forEach(c => g.guessed.add(c)); } else { g.lives--; } } else { g.guessed.add(t); if (!g.word.includes(t)) g.lives--; }
      const won = [...g.word].every(c => g.guessed.has(c));
      if (won) { ctx.rt.games.delete(ctx.chat); const p = await reward(ctx, 40); await ctx.reply(`🎉 *${g.word.toUpperCase()}* — solved by *${p.name}*! +40 coins`, { title: 'Hangman' }); }
      else if (g.lives <= 0) { ctx.rt.games.delete(ctx.chat); await ctx.reply(`💀 Out of lives! The word was *${g.word.toUpperCase()}*.`, { title: 'Hangman' }); }
      else await ctx.reply(`${board(g)}\n❤️ Lives: ${g.lives}`, { title: 'Hangman' });
      return true;
    }
    return false;
  } });
  tickers.push({ name: 'x-games-timeout', run: async api => { for (const [chat, g] of [...api.rt.games.entries()]) if (String(g.type).startsWith('x-') && Date.now() >= g.deadline) { api.rt.games.delete(chat); try { await api.sendTo(chat, { text: api.frame(`⌛ Time is up!${g.word ? ` The word was *${g.word.toUpperCase()}*.` : g.ans ? ` The answer was *${g.ans}*.` : ''}`) }); } catch {} } } });

  /* --------------------------------------- rankings --------------------------------------- */
  const rank = (name, sortKey, title, line, desc) => def(name, { cat: 'game', desc }, async ctx => {
    const idx = Object.values(ctx.get('eco:index', {})); if (!idx.length) throw new UserError(`Nobody is ranked yet. Play with *${P(ctx)}daily*, *${P(ctx)}work* or *${P(ctx)}hunt* first.`);
    const top = idx.sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 10);
    await ctx.reply(top.map((x, i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} *${x.name}* — ${line(x)}`).join('\n'), { title });
  });
  rank('highscores', 'net', 'Richest players', x => `${fmtN(x.net)} coins`, 'The richest players on this bot.');
  rank('winners', 'wins', 'Top winners', x => `${x.wins} wins`, 'Players with the most wins.');
  rank('losers', 'losses', 'Most losses', x => `${x.losses} losses`, 'Players with the most losses (a friendly roast).');

  /* ---------------------------------------- zodiac ---------------------------------------- */
  const signArg = s => SIGNS.find(x => x[0] === String(s || '').toLowerCase());
  def('zodiac', { cat: 'game', usage: 'zodiac <month> <day>  (e.g. zodiac 7 23)', desc: 'Find your zodiac sign from your birthday.' }, async ctx => {
    const [m, d] = ctx.argv.map(Number); if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new UserError(`Usage: *${P(ctx)}zodiac 7 23* (month then day)`);
    const s = signOf(m, d); await ctx.reply(`${s[1]} You are *${s[0][0].toUpperCase() + s[0].slice(1)}*.`, { title: 'Zodiac' });
  });
  def('horoscope', { cat: 'game', heavy: true, usage: 'horoscope <sign>', desc: 'A fun daily horoscope for a sign (for entertainment only).' }, async ctx => {
    const s = signArg(ctx.argv[0]); if (!s) throw new UserError(`Usage: *${P(ctx)}horoscope leo* — signs: ${SIGNS.map(x => x[0]).join(', ')}`);
    const r = await require('./ai').ask('gpt', `Write a short, upbeat, general horoscope for ${s[0]} for today in 3 sentences. Make no medical, financial or legal predictions. End with a lucky number and colour.`);
    await ctx.reply(`${s[1]} *${s[0].toUpperCase()}*\n\n${r.text}\n\n_For entertainment only._`, { title: 'Horoscope' });
  });
  def('compatibility', { cat: 'game', usage: 'compatibility <sign> <sign>', desc: 'Fun zodiac compatibility score for two signs.' }, async ctx => {
    const a = signArg(ctx.argv[0]), b = signArg(ctx.argv[1]); if (!a || !b) throw new UserError(`Usage: *${P(ctx)}compatibility leo libra*`);
    const h = crypto.createHash('md5').update([a[0], b[0]].sort().join('+')).digest()[0]; const pct = 40 + (h % 61);
    await ctx.reply(`${a[1]} ${a[0]} + ${b[1]} ${b[0]}\n💞 Compatibility: *${pct}%*\n${pct > 85 ? 'A cosmic match!' : pct > 65 ? 'Good chemistry.' : pct > 50 ? 'Needs some effort, but possible.' : 'Opposites… sometimes that works too.'}\n\n_Just for fun._`, { title: 'Compatibility' });
  });
  def('birthday', { cat: 'game', usage: 'birthday <day> <month> [year]', desc: 'Days until your next birthday (and your age if you add the year).' }, async ctx => {
    const [d, m, y] = ctx.argv.map(Number); if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new UserError(`Usage: *${P(ctx)}birthday 23 7 2001* (day month year)`);
    const now = new Date(); let next = new Date(now.getFullYear(), m - 1, d); if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(now.getFullYear() + 1, m - 1, d);
    const days = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5); const s = signOf(m, d);
    await ctx.reply(`🎂 ${days === 0 ? '*Happy birthday today!* 🎉' : `Your next birthday is in *${days} day(s)*.`}${y > 1900 ? `\n🎈 Turning *${next.getFullYear() - y}*` : ''}\n${s[1]} ${s[0]}`, { title: 'Birthday' });
  });

  /* ---------------------------------------- reactions ---------------------------------------- */
  for (const [name, [verb, endpoint]] of Object.entries(REACT)) {
    def(name, { cat: 'game', heavy: true, usage: `${name} [@user]`, desc: `Send a ${name} animation to someone.` }, async ctx => {
      const t = ctx.targets?.(true)?.[0]; const who = ctx.name || 'Someone'; const tn = t ? '@' + numOf(ctx, t) : 'everyone';
      const j = await getJson(`https://nekos.best/api/v2/${endpoint}`, { timeout: 12000 });
      const url = j.results?.[0]?.url; if (!url) throw new UserError('The animation service did not answer. Try again in a moment.');
      const gif = (await U.download(url)).buffer;
      const mp4 = await U.ff(gif, { inExt: 'gif', outExt: 'mp4', args: ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'] });
      await ctx.video(mp4, `*${who}* ${verb} ${tn}`, { gifPlayback: true, mentions: t ? [t] : [] });
    });
  }
  const imgFrom = (name, url, pickUrl, caption) => def(name, { cat: 'game', heavy: true, desc: `A random ${name} picture.` }, async ctx => {
    const j = await getJson(url, { timeout: 12000 }); const u = pickUrl(j); if (!u) throw new UserError('The picture service did not answer. Try again in a moment.');
    await ctx.image((await U.download(u)).buffer, caption);
  });
  alias('dogpic', 'dog');
  imgFrom('fox', 'https://randomfox.ca/floof/', j => j.image, '🦊 Fox');
  imgFrom('bird', 'https://some-random-api.com/img/bird', j => j.link, '🐦 Bird');
  imgFrom('panda', 'https://some-random-api.com/img/panda', j => j.link, '🐼 Panda');
  imgFrom('waifu', 'https://api.waifu.pics/sfw/waifu', j => j.url, '✨ Waifu');
  imgFrom('neko', 'https://api.waifu.pics/sfw/neko', j => j.url, '🐱 Neko');
  def('animal', { cat: 'game', heavy: true, desc: 'A random animal picture (dog, fox, bird or panda).' }, async ctx => registry.get(pick(['dog', 'fox', 'bird', 'panda'])).run(ctx));

  /* ------------------------------------------ emoji ------------------------------------------ */
  def(['emojify', 'textemoji'], { cat: 'sticker', usage: 'emojify <text>', desc: 'Turn text into emoji letters.' }, ctx => { const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}emojify hello*`); return ctx.reply(emojify(t.slice(0, 60))); });
  def('emojiinfo', { cat: 'sticker', usage: 'emojiinfo <emoji>', desc: 'Unicode code points of an emoji.' }, async ctx => {
    const e = ctx.input().trim(); if (!e) throw new UserError(`Usage: *${P(ctx)}emojiinfo 😀*`);
    await ctx.reply(`${e}\nCode points: ${[...e].slice(0, 12).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')}\nLength: ${[...e].length} code point(s)`, { title: 'Emoji info' });
  });
  def('emojiheart', { cat: 'sticker', desc: 'A heart made of emoji.' }, ctx => { const e = ctx.argv[0] || pick(['❤️', '💖', '💜', '💙', '💚']); const rows = ['  ##   ##  ', ' ######## ', ' ######## ', '  ######  ', '   ####   ', '    ##    ']; return ctx.reply(rows.map(r => [...r].map(c => (c === '#' ? e : '⬜')).join('')).join('\n')); });
  def('emojiwave', { cat: 'sticker', desc: 'A wave of emoji.' }, ctx => { const e = ctx.argv[0] || '🌊'; return ctx.reply([0, 1, 2, 3, 2, 1, 0].map(n => '⬜'.repeat(n) + e + '⬜'.repeat(3 - n)).join('\n')); });
  def('emojiroll', { cat: 'sticker', desc: 'Roll three random emoji.' }, ctx => ctx.reply(Array.from({ length: 3 }, () => pick([...'🍒🍋🔔💎7️⭐🍀🎲'])).join(' ')));
};

module.exports.helpers = { val, emojify, signOf };
