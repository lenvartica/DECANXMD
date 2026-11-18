'use strict';
const { UserError, bold } = require('../lib/util');

const random = n => Math.floor(Math.random() * n);
const pick = a => a[random(a.length)];
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const money = n => `${Math.max(0, Math.floor(n)).toLocaleString('en-US')} XP`;
const cleanName = s => String(s || 'Hunter').replace(/[\r\n*_~]/g, '').slice(0, 32);
const QUESTIONS = [
  { q: 'Which planet is known as the Red Planet?', a: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1 },
  { q: 'What is 12 × 8?', a: ['84', '92', '96', '108'], correct: 2 },
  { q: 'Which language runs natively in a browser?', a: ['Java', 'C++', 'JavaScript', 'Rust'], correct: 2 },
  { q: 'What is the largest ocean on Earth?', a: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 },
  { q: 'How many sides does a hexagon have?', a: ['5', '6', '7', '8'], correct: 1 },
  { q: 'Which gas do plants absorb?', a: ['Oxygen', 'Hydrogen', 'Carbon dioxide', 'Nitrogen'], correct: 2 },
  { q: 'What is the square root of 144?', a: ['10', '11', '12', '14'], correct: 2 },
  { q: 'Which data format uses key-value pairs?', a: ['JSON', 'PNG', 'MP3', 'JPEG'], correct: 0 }
];

module.exports = ({ def, hooks, tickers }) => {
  const playerKey = ctx => `decanxmd_player_${ctx.senderNum || ctx.chat}`;
  const getPlayer = ctx => ctx.get(playerKey(ctx), { name: cleanName(ctx.name), level: 1, xp: 0, coins: 100, wins: 0, losses: 0, lastDaily: 0, lastHunt: 0, inventory: ['Starter Dagger'] });
  const savePlayer = (ctx, p) => { p.name = cleanName(ctx.name || p.name); p.level = Math.max(1, Math.floor(1 + p.xp / 250)); ctx.set(playerKey(ctx), p); return p; };
  const playerCard = (ctx, p) => `🧬 *${p.name || 'Hunter'}*\n🏅 Level: *${p.level}*\n✨ XP: *${p.xp}*\n🪙 Coins: *${p.coins}*\n⚔️ Wins: *${p.wins}*  •  💥 Losses: *${p.losses}*\n🎒 Inventory: ${(p.inventory || []).join(', ')}`;

  def('channel', { cat: 'community', desc: 'Get the official DECANXMD WhatsApp channel invitation.' }, async ctx => {
    const url = process.env.CHANNEL_URL || ctx.CHANNEL_URL || 'https://whatsapp.com/channel/0029VbDqBjyFnSzHeIHAzH3m';
    await ctx.reply(`📢 *DECANXMD OFFICIAL CHANNEL*\n\nFollow for updates, new commands, releases and community announcements.\n\n🔗 ${url}\n\nTap the invitation above to open WhatsApp Channel.` , { title: 'View Channel' });
  });

  def(['solo', 'hunter', 'profile'], { cat: 'game', desc: 'Show your Solo Leveling-inspired hunter profile.' }, async ctx => {
    const p = getPlayer(ctx);
    savePlayer(ctx, p);
    await ctx.reply(`🌑 *HUNTER STATUS WINDOW*\n\n${playerCard(ctx, p)}\n\nUse *.daily*, *.hunt*, *.dungeon*, *.raid*, *.shop* or *.inventory* to progress.`, { title: 'Hunter System' });
  });

  def('daily', { cat: 'game', desc: 'Claim daily coins and XP once every 20 hours.' }, async ctx => {
    const p = getPlayer(ctx);
    const wait = 20 * 60 * 60 * 1000 - (Date.now() - number(p.lastDaily));
    if (wait > 0) throw new UserError(`Daily reward already claimed. Try again in ${Math.ceil(wait / 3600000)} hour(s).`);
    const coins = 100 + random(151), xp = 25 + random(36);
    p.lastDaily = Date.now(); p.coins += coins; p.xp += xp; savePlayer(ctx, p);
    await ctx.reply(`🎁 *DAILY REWARD CLAIMED*\n\n🪙 +${coins} coins\n✨ +${xp} XP\n\n${playerCard(ctx, p)}`, { title: 'Daily Supply Drop' });
  });

  def(['hunt', 'shadowhunt'], { cat: 'game', desc: 'Play a complete one-message shadow hunt. No setup or reply required.' }, async ctx => {
    const p = getPlayer(ctx);
    const now = Date.now();
    const wait = 30 * 1000 - (now - number(p.lastHunt));
    if (wait > 0) throw new UserError(`Your hunter needs to recover for ${Math.ceil(wait / 1000)} seconds.`);
    p.lastHunt = now;
    const enemy = pick([{ name: 'Goblin Scout', power: 1, xp: 25, coins: 15 }, { name: 'Steel Fang Lycan', power: 2, xp: 40, coins: 25 }, { name: 'Dungeon Knight', power: 3, xp: 60, coins: 40 }, { name: 'Elite Orc', power: 4, xp: 85, coins: 60 }, { name: 'Shadow Beast', power: 5, xp: 120, coins: 90 }]);
    const strength = p.level + random(5) + (p.inventory.includes('Knight Blade') ? 2 : 0);
    const roll = strength - enemy.power + random(4) - 1;
    if (roll >= 0) { const xp = enemy.xp + random(20), coins = enemy.coins + random(25); p.xp += xp; p.coins += coins; p.wins++; savePlayer(ctx, p); return ctx.reply(`🌌 *SHADOW HUNT — VICTORY*\n\n👹 Target: *${enemy.name}*\n⚔️ Combat rating: ${strength}\n🗡️ Result: Shadow extracted successfully\n\n✨ +${xp} XP\n🪙 +${coins} coins\n\n${playerCard(ctx, p)}`, { title: 'Instant Dungeon Encounter' }); }
    const lost = Math.min(p.coins, 10 + random(16)); p.coins -= lost; p.losses++; savePlayer(ctx, p);
    await ctx.reply(`🌑 *SHADOW HUNT — RETREAT*\n\n👹 Target: *${enemy.name}*\n⚠️ The gate was above your current rank. You escaped, but dropped ${lost} coins.\n\nTrain with *.daily* and try again.\n\n${playerCard(ctx, p)}`, { title: 'Instant Dungeon Encounter' });
  });

  def(['dungeon', 'gate'], { cat: 'game', desc: 'Run a complete random dungeon simulation in one message.' }, async ctx => {
    const p = getPlayer(ctx);
    const rank = pick(['E-Rank Gate', 'D-Rank Gate', 'C-Rank Gate', 'B-Rank Gate', 'A-Rank Gate', 'S-Rank Gate']);
    const tier = ['E-Rank Gate', 'D-Rank Gate', 'C-Rank Gate', 'B-Rank Gate', 'A-Rank Gate', 'S-Rank Gate'].indexOf(rank) + 1;
    const power = p.level + random(8) + (p.inventory.includes('Knight Blade') ? 3 : 0);
    const danger = tier * 2 + random(7);
    if (power >= danger) { const xp = 45 * tier + random(50), coins = 30 * tier + random(40); p.xp += xp; p.coins += coins; p.wins++; if (tier >= 4 && !p.inventory.includes('Knight Blade') && random(3) === 0) p.inventory.push('Knight Blade'); savePlayer(ctx, p); return ctx.reply(`🚪 *GATE CLEARED*\n\n${rank}\n${pick(['🧟 Boss defeated.', '⚔️ Elite monster eliminated.', '🌑 Shadow extraction successful.', '💎 Rare loot recovered.'])}\n\n✨ Reward: +${xp} XP\n🪙 Reward: +${coins} coins\n${p.inventory.includes('Knight Blade') ? '🗡️ Knight Blade secured!\n' : ''}\n${playerCard(ctx, p)}`, { title: 'Dungeon Instance' }); }
    const loss = Math.min(p.coins, tier * 8); p.coins -= loss; p.losses++; savePlayer(ctx, p); await ctx.reply(`🚨 *DUNGEON RETREAT*\n\n${rank}\nYour hunter power (${power}) was below the gate threat (${danger}). You escaped with ${loss} coins lost to repairs.\n\nUpgrade your level and try another gate.\n\n${playerCard(ctx, p)}`, { title: 'Dungeon Instance' });
  });

  def('raid', { cat: 'game', desc: 'One-message boss raid simulation with rewards.' }, async ctx => {
    const p = getPlayer(ctx);
    const boss = pick([{ name: 'Cerberus', hp: 160, reward: 100 }, { name: 'Baruka', hp: 230, reward: 160 }, { name: 'The Ice Elf Commander', hp: 300, reward: 220 }, { name: 'Shadow Dragon', hp: 420, reward: 350 }]);
    let hp = boss.hp, turns = 0, damage = 0;
    while (hp > 0 && turns < 8) { turns++; const hit = 12 + p.level * 4 + random(28); hp -= hit; damage += hit; }
    if (hp <= 0) { const xp = 70 + turns * 12, coins = boss.reward + random(80); p.xp += xp; p.coins += coins; p.wins++; savePlayer(ctx, p); return ctx.reply(`🐉 *BOSS RAID CLEARED*\n\nTarget: *${boss.name}*\nCombat turns: ${turns}\nTotal damage: ${damage}\nStatus: *BOSS DEFEATED*\n\n✨ +${xp} XP  •  🪙 +${coins} coins\n\n${playerCard(ctx, p)}`, { title: 'Shadow Raid' }); }
    p.losses++; savePlayer(ctx, p); await ctx.reply(`🐉 *BOSS RAID FAILED*\n\n${boss.name} survived with ${Math.max(0, hp)} HP. Your damage: ${damage}. Train your hunter and launch another raid.`, { title: 'Shadow Raid' });
  });

  def('inventory', { cat: 'game', desc: 'View your hunter inventory.' }, async ctx => { const p = getPlayer(ctx); await ctx.reply(`🎒 *HUNTER INVENTORY*\n\n${(p.inventory || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nCoins: ${p.coins}`, { title: 'Inventory' }); });

  def('shop', { cat: 'game', desc: 'Buy hunter equipment using game coins.' }, async ctx => {
    const p = getPlayer(ctx); const a = (ctx.argv[0] || '').toLowerCase();
    if (!a || a === 'list') return ctx.reply('🛒 *HUNTER SHOP*\n\n1. Knight Blade — 250 coins\n   +2 combat power\n\nBuy: *.shop blade*', { title: 'Hunter Supply Shop' });
    if (a !== 'blade') throw new UserError('Available item: *.shop blade*');
    if (p.inventory.includes('Knight Blade')) throw new UserError('You already own the Knight Blade.');
    if (p.coins < 250) throw new UserError(`You need 250 coins. Your balance: ${p.coins}.`);
    p.coins -= 250; p.inventory.push('Knight Blade'); savePlayer(ctx, p); await ctx.reply(`🗡️ *KNIGHT BLADE ACQUIRED*\n\nYour combat power has increased.\n\n${playerCard(ctx, p)}`, { title: 'Purchase complete' });
  });

  def(['coinflip', 'flip'], { cat: 'game', desc: 'Flip a coin instantly.' }, async ctx => { const result = pick(['HEADS 🟡', 'TAILS ⚫']); await ctx.reply(`🪙 *COIN FLIP*\n\n${result}`, { title: 'Quick Game' }); });
  def('dice', { cat: 'game', desc: 'Roll one or more dice, e.g. dice 3.' }, async ctx => { const count = Math.min(6, Math.max(1, Math.floor(number(ctx.argv[0], 1)))); const rolls = Array.from({ length: count }, () => 1 + random(6)); await ctx.reply(`🎲 *DICE ROLL*\n\n${rolls.map((n, i) => `Die ${i + 1}: ${['⚀','⚁','⚂','⚃','⚄','⚅'][n - 1]} (${n})`).join('\n')}\n\nTotal: *${rolls.reduce((a, b) => a + b, 0)}*`, { title: 'Quick Game' }); });
  def(['slots', 'slot'], { cat: 'game', desc: 'Play a one-message slot machine for fun.' }, async ctx => { const icons = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐']; const r = [pick(icons), pick(icons), pick(icons)]; const win = r.every(x => x === r[0]); const pair = new Set(r).size === 2; await ctx.reply(`🎰 *DECANXMD SLOTS*\n\n┏━━━━━━━━━━┓\n┃ ${r.join(' │ ')} ┃\n┗━━━━━━━━━━┛\n\n${win ? '🏆 JACKPOT! Three matching symbols!' : pair ? '✨ Pair match! Nice spin.' : '🔁 No match — spin again.'}\n\nThis is a free game; no real money or purchases.`, { title: 'Arcade' }); });

  def(['trivia', 'quiz'], { cat: 'game', desc: 'Start a WhatsApp trivia question; answer 1-4 in chat.' }, async ctx => {
    const old = ctx.rt.games.get(ctx.chat);
    if (old?.type === 'decx-trivia') throw new UserError('A quiz is already active here. Answer 1-4 or send *.quiz stop*.');
    if (/^(stop|end)$/i.test(ctx.args)) { ctx.rt.games.delete(ctx.chat); return ctx.reply('Quiz stopped.'); }
    const q = pick(QUESTIONS); ctx.rt.games.set(ctx.chat, { type: 'decx-trivia', question: q, player: ctx.senderNum, deadline: Date.now() + 60000 });
    await ctx.reply(`🧠 *DECANXMD TRIVIA*\n\n${q.q}\n\n${q.a.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nReply with *1, 2, 3 or 4*. You have 60 seconds.`, { title: 'Quick Quiz' });
  });

  hooks.push({ name: 'decanxmdTrivia', run: async ctx => {
    const g = ctx.rt.games.get(ctx.chat);
    if (!g || g.type !== 'decx-trivia' || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.')) return false;
    if (/^(stop|cancel)$/i.test(ctx.text.trim())) { ctx.rt.games.delete(ctx.chat); await ctx.reply('Quiz cancelled.'); return true; }
    if (!/^[1-4]$/.test(ctx.text.trim())) return false;
    ctx.rt.games.delete(ctx.chat);
    const correct = Number(ctx.text.trim()) - 1 === g.question.correct;
    if (correct) { const p = getPlayer(ctx); p.xp += 20; p.coins += 10; p.wins++; savePlayer(ctx, p); await ctx.reply(`✅ *CORRECT!* +20 XP and +10 coins.\n\n${playerCard(ctx, p)}`, { title: 'Quiz result' }); }
    else await ctx.reply(`❌ Not quite! Correct answer: *${g.question.a[g.question.correct]}*. Try *.trivia* for another question.`, { title: 'Quiz result' });
    return true;
  }});
  tickers.push({ name: 'decanxmdTriviaTimeout', run: async api => { for (const [chat, g] of [...api.rt.games.entries()]) if (g.type === 'decx-trivia' && Date.now() >= g.deadline) { api.rt.games.delete(chat); await api.sendTo(chat, { text: api.frame(`⌛ Quiz time is up. Correct answer: *${g.question.a[g.question.correct]}*`) }).catch(() => {}); } } });

  def('leaderboard', { cat: 'game', desc: 'Show your current hunter profile. Per-session leaderboard is not shared across users unless storage supports it.' }, async ctx => {
    const p = getPlayer(ctx); await ctx.reply(`🏆 *HUNTER LEADERBOARD SNAPSHOT*\n\n${playerCard(ctx, p)}\n\nNote: stats are stored per bot session and player; a global cross-session ranking requires shared database aggregation.`, { title: 'Hunter Rankings' });
  });
};
