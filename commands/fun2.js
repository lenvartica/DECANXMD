'use strict';
/** More fun: riddle, rate, compliment, insult (playful roast), pickup, guess, wordgame. */
const U = require('../lib/util');
const { UserError, bold } = U;

const rnd = a => a[Math.floor(Math.random() * a.length)];
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const RIDDLES = [
  ['What has keys but cannot open locks?', 'a piano'], ['What gets wetter the more it dries?', 'a towel'], ['I speak without a mouth and hear without ears. What am I?', 'an echo'],
  ['What has hands but cannot clap?', 'a clock'], ['The more you take, the more you leave behind. What am I?', 'footsteps'], ['What can travel around the world while staying in a corner?', 'a stamp'],
  ['What has a head and a tail but no body?', 'a coin'], ['What goes up but never comes down?', 'your age'], ['What has many teeth but cannot bite?', 'a comb'],
  ['I am tall when I am young and short when I am old. What am I?', 'a candle'], ['What can you catch but not throw?', 'a cold'], ['What has one eye but cannot see?', 'a needle'],
  ['What building has the most stories?', 'a library'], ['What runs but never walks, has a mouth but never talks?', 'a river'], ['What is full of holes but still holds water?', 'a sponge']
];
const COMPLIMENTS = ['You make hard things look easy. 🌟', 'Your energy lifts everyone around you. ☀️', 'You have a great sense of humour. 😄', 'You are the kind of person people are glad to know. 💛', 'Your ideas are sharper than you give yourself credit for. 💡', 'You handle pressure like a pro. 💪', 'Your kindness is contagious. 🌻', 'You are proof that effort pays off. 🚀', 'Smart, funny and reliable: rare combo! 🏆', 'You light up the chat just by showing up. ✨'];
const ROASTS = ['You are the reason the "Are you sure?" button exists. 😅', 'Your Wi-Fi password is probably "password123" and honestly, same. 📶', 'You are not lazy, you are just on energy-saving mode. 🔋', 'You type "brb" and come back next week. 🐢', 'You have the confidence of someone who never reads the instructions. 📖', 'You are like a cloud: when you disappear, it is a beautiful day. ☁️ (just joking!)', 'Your phone battery has seen things. 🪫', 'You can lose an argument with a calculator. 🧮', 'You are proof that even slow loading gets there eventually. ⏳', 'You take 3 hours to reply and 3 seconds to screenshot. 📸'];
const PICKUPS = ['Are you a Wi-Fi signal? Because I am feeling a connection. 📶', 'Do you have a map? I keep getting lost in your eyes. 🗺️', 'Are you a campfire? Because you are hot and I want s\'more. 🔥', 'Is your name Google? Because you have everything I am searching for. 🔎', 'Are you a keyboard? Because you are just my type. ⌨️', 'Do you believe in love at first text? 📱', 'If you were a vegetable you would be a cute-cumber. 🥒', 'Are you made of copper and tellurium? Because you are Cu-Te. 🧪', 'I am no photographer, but I can picture us together. 📷', 'Are you a charger? Because I would die without you. 🔌'];
const WORDS = ['kenya', 'planet', 'garden', 'laptop', 'rocket', 'dolphin', 'mountain', 'whatsapp', 'football', 'elephant', 'library', 'journey', 'diamond', 'keyboard', 'sunshine', 'network', 'bicycle', 'chocolate', 'umbrella', 'telescope', 'battery', 'island', 'courage', 'treasure', 'volcano', 'butterfly', 'universe', 'pyramid', 'dragon', 'harvest'];
const scramble = w => { let s; do { s = [...w].sort(() => Math.random() - 0.5).join(''); } while (s === w); return s; };

module.exports = ({ def }) => {
  const P = ctx => ctx.var('PREFIX');
  const subject = ctx => { const t = ctx.targets()[0]; return t ? '@' + ctx.jidUser(t) : (ctx.args || ''); };
  const withMention = async (ctx, body, title) => { const t = ctx.targets()[0]; await ctx.send({ text: ctx.frame(body, title), ...(t ? { mentions: [t] } : {}) }, { quoted: ctx.msg }); };

  def('riddle', { cat: 'game', usage: 'riddle • riddle answer', desc: 'A random riddle. Reveal the answer with "riddle answer".' }, async ctx => {
    const open = (ctx.rt.riddle ||= new Map());
    if (/^(answer|ans|reveal)$/i.test(ctx.argv[0] || '')) {
      const r = open.get(ctx.chat);
      if (!r) throw new UserError(`No riddle is open. Get one with *${P(ctx)}riddle*.`);
      open.delete(ctx.chat);
      return ctx.reply(`💡 The answer is ${bold(r[1])}.`, { title: 'Riddle answer' });
    }
    const r = rnd(RIDDLES);
    open.set(ctx.chat, r);
    await ctx.reply(`${r[0]}\n\nThink you know it? Say it out loud, then check with *${P(ctx)}riddle answer*.`, { title: 'Riddle 🧩' });
  });

  def(['rate', 'rateme'], { cat: 'game', usage: 'rate <anything>', desc: 'Rates anything from 0 to 10 (the same thing always gets the same score).' }, async ctx => {
    const what = subject(ctx).trim() || '@' + ctx.senderNum;
    const score = hash(norm(what)) % 11;
    const bar = '▰'.repeat(score) + '▱'.repeat(10 - score);
    await withMention(ctx, `${bold(what)}\n\n${bar} ${bold(score + '/10')}\n${score >= 9 ? 'Legendary! 🏆' : score >= 7 ? 'Really good 👍' : score >= 5 ? 'Solid 🙂' : score >= 3 ? 'Could be better 😬' : 'Oof… 💀'}`, 'Rating');
  });

  def(['compliment', 'praise'], { cat: 'game', usage: 'compliment [@user]', desc: 'Send someone a kind compliment.' }, async ctx => {
    const s = subject(ctx);
    await withMention(ctx, `${s ? s + '\n\n' : ''}${rnd(COMPLIMENTS)}`, 'Compliment');
  });
  def(['insult', 'roast'], { cat: 'game', usage: 'roast [@user]', desc: 'A light-hearted, friendly roast (all in good fun).' }, async ctx => {
    const s = subject(ctx);
    await withMention(ctx, `${s ? s + '\n\n' : ''}${rnd(ROASTS)}\n\n_Just for laughs. No offence meant!_`, 'Roast 🔥');
  });
  def(['pickup', 'pickupline', 'flirt'], { cat: 'game', usage: 'pickup [@user]', desc: 'A cheesy pick-up line.' }, async ctx => {
    const s = subject(ctx);
    await withMention(ctx, `${s ? s + '\n\n' : ''}${rnd(PICKUPS)}`, 'Pick-up line 😏');
  });

  def(['guess', 'guessnumber'], { cat: 'game', usage: 'guess • guess <number>', desc: 'Guess the secret number between 1 and 100. I tell you higher or lower.' }, async ctx => {
    const games = (ctx.rt.guess ||= new Map());
    const key = ctx.chat + '|' + ctx.senderNum;
    let g = games.get(key);
    const n = parseInt(ctx.argv[0], 10);
    if (!g || /^(new|restart)$/i.test(ctx.argv[0] || '')) {
      g = { secret: 1 + Math.floor(Math.random() * 100), tries: 0, at: Date.now() };
      games.set(key, g);
      if (Number.isNaN(n)) return ctx.reply(`🔢 I picked a number from ${bold('1 to 100')}.\nGuess with *${P(ctx)}guess 50*. You have 8 tries!`, { title: 'Guess the number' });
    }
    if (!(n >= 1 && n <= 100)) throw new UserError(`Send a number from 1 to 100: *${P(ctx)}guess 42*`);
    g.tries++;
    if (n === g.secret) { games.delete(key); return ctx.reply(`🎉 Correct! The number was ${bold(String(n))}. You needed ${bold(String(g.tries))} ${g.tries === 1 ? 'try' : 'tries'}.`, { title: 'You win!' }); }
    if (g.tries >= 8) { games.delete(key); return ctx.reply(`💀 Out of tries! The number was ${bold(String(g.secret))}.\nPlay again: *${P(ctx)}guess*`, { title: 'Game over' }); }
    await ctx.reply(`${n < g.secret ? '⬆️ Higher' : '⬇️ Lower'}!  (${8 - g.tries} tries left)`, { title: 'Guess the number' });
    if (games.size > 500) games.delete(games.keys().next().value);
  });

  def('wordgame', { cat: 'game', usage: 'wordgame • wordgame <answer> • wordgame skip', desc: 'Unscramble the word. Answer with "wordgame <word>".' }, async ctx => {
    const games = (ctx.rt.wordgame ||= new Map());
    let g = games.get(ctx.chat);
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!g || a === 'skip') {
      if (g && a === 'skip') { games.delete(ctx.chat); await ctx.reply(`⏭️ It was ${bold(g.word)}.`, { title: 'Word game' }); }
      const word = rnd(WORDS);
      games.set(ctx.chat, { word, hint: word[0], at: Date.now() });
      return ctx.reply(`Unscramble this word:\n\n🔤 ${bold(scramble(word).toUpperCase())}\n\nAnswer: *${P(ctx)}wordgame <word>* • skip: *${P(ctx)}wordgame skip*`, { title: 'Word game' });
    }
    if (!a) return ctx.reply(`🔤 ${bold(scramble(g.word).toUpperCase())}\nStarts with *${g.hint.toUpperCase()}*. Answer: *${P(ctx)}wordgame <word>*`, { title: 'Word game' });
    if (norm(a) === g.word) { games.delete(ctx.chat); return ctx.reply(`🎉 @${ctx.senderNum} got it: ${bold(g.word)}!\nNext word: *${P(ctx)}wordgame*`, { title: 'Word game' }); }
    await ctx.react('❌');
  });
};
