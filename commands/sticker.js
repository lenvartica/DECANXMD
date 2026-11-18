'use strict';
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError } = U;

const OPENMOJI_PACKS = {
  smiles: ['1F600', '1F601', '1F602', '1F603', '1F604', '1F605', '1F606', '1F609', '1F60A', '1F60D', '1F618', '1F923'],
  love: ['2764', '1F494', '1F495', '1F496', '1F497', '1F498', '1F49A', '1F49B', '1F49C', '1F49D', '1F49E', '1F49F'],
  reactions: ['1F44D', '1F44E', '1F44F', '1F64F', '1F4AF', '1F525', '1F92F', '1F973', '1F914', '1F62E', '1F621', '1F4A9'],
  animals: ['1F435', '1F412', '1F98D', '1F436', '1F431', '1F43B', '1F43C', '1F428', '1F42F', '1F981', '1F98A', '1F984'],
  pets: ['1F436', '1F431', '1F43B', '1F43C', '1F428', '1F430', '1F439', '1F424', '1F427', '1F438', '1F98B', '1F41D'],
  food: ['1F34E', '1F34C', '1F347', '1F353', '1F355', '1F354', '1F35F', '1F32D', '1F36D', '1F36A', '1F370', '1F36B'],
  nature: ['1F338', '1F339', '1F33B', '1F33C', '1F340', '1F33F', '1F343', '1F342', '1F335', '1F332', '1F333', '1F30D'],
  celebration: ['1F389', '1F38A', '1F388', '1F381', '1F380', '1F382', '1F386', '1F387', '1F393', '1F3B2', '1F3C6', '1F31F'],
  sports: ['26BD', '1F3C0', '1F3C8', '1F3BE', '1F3D0', '1F3B1', '1F3C6', '1F3C5', '1F94A', '1F3BF', '1F3CA', '1F3C4'],
  travel: ['1F697', '1F68C', '1F680', '2708', '1F6A2', '1F3D6', '1F3D4', '1F3D5', '1F5FC', '1F3F0', '1F3E0', '1F30B'],
  weather: ['2600', '1F31E', '1F324', '26C5', '1F326', '1F327', '1F328', '1F329', '1F32A', '1F32B', '1F308', '1F30A'],
  objects: ['1F4A1', '1F4F1', '1F4BB', '1F4F7', '1F3A7', '1F3B5', '1F3B8', '1F4DA', '1F4E6', '1F48E', '1F511', '1F381']
};
const OPENMOJI_AUTHOR = 'OpenMoji (CC BY-SA 4.0)';
const OPENMOJI_URL = code => `https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/${code}.svg`;

module.exports = ({ def, hooks }) => {
  const names = (ctx, text) => {
    const [a, b] = String(text || '').split(/[|,]/).map(s => s.trim());
    return { pack: a || ctx.var('STICKER_PACK'), author: b || ctx.var('STICKER_AUTHOR') };
  };

  async function makeSticker(m, { pack, author, crop = false, circle = false }) {
    let webp;
    if (m.kind === 'sticker') webp = m.buffer;
    else if (m.kind === 'video' || m.mime === 'image/gif') webp = await U.videoToWebp(m.buffer, m.mime === 'image/gif' ? 'gif' : 'mp4');
    else webp = await U.imageToWebp(m.buffer, { crop, circle });
    return U.withExif(webp, pack, author);
  }
  module.exports.makeSticker = makeSticker;

  def('sticker', { cat: 'sticker', heavy: true, usage: 'sticker [pack|author] [crop]', desc: 'Make a sticker from an image, GIF or short video (reply or send with caption).' }, async ctx => {
    const m = await ctx.needMedia(['image', 'video', 'sticker'], 'Reply to an image, GIF or short video.');
    const crop = /\bcrop(ped)?\b/i.test(ctx.args);
    const { pack, author } = names(ctx, ctx.args.replace(/\bcrop(ped)?\b/i, ''));
    await ctx.sticker(await makeSticker(m, { pack, author, crop }));
  });

  def('take', { cat: 'sticker', heavy: true, usage: 'take <pack>,<author>', desc: 'Change a sticker\'s pack name and author. Reply to a sticker.' }, async ctx => {
    const m = await ctx.needMedia(['sticker', 'image', 'video'], 'Reply to a sticker with *take pack,author*.');
    const { pack, author } = names(ctx, ctx.args || `${ctx.name || ctx.OWNER_NAME}`);
    await ctx.sticker(await makeSticker(m, { pack: ctx.args ? pack : (ctx.name || pack), author: ctx.args ? author : ctx.var('STICKER_AUTHOR') }));
  });

  def('circle', { cat: 'sticker', heavy: true, desc: 'Make a round sticker from an image. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image');
    const { pack, author } = names(ctx, ctx.args);
    await ctx.sticker(await U.withExif(await U.imageToWebp(m.buffer, { crop: true, circle: true }), pack, author));
  });

  def('photo', { cat: 'sticker', heavy: true, desc: 'Convert a sticker to a PNG image. Reply to a sticker.' }, async ctx => {
    const m = await ctx.needMedia('sticker');
    await ctx.image(await U.sharp()(m.buffer).png().toBuffer(), '🖼️ Sticker → photo');
  });

  def('mp4', { cat: 'sticker', heavy: true, desc: 'Convert an animated sticker to a video. Reply to a sticker.' }, async ctx => {
    const m = await ctx.needMedia('sticker');
    await ctx.video(await U.webpToMp4(m.buffer), '🎬 Sticker → video');
  });

  def('exif', { cat: 'sticker', desc: 'Show the pack name and author of a sticker. Reply to a sticker.' }, async ctx => {
    const m = await ctx.needMedia('sticker');
    const e = await U.readExif(m.buffer);
    if (!e) return ctx.reply('This sticker has no pack info.');
    await ctx.reply(`📦 ${U.bold('Pack')}: ${e['sticker-pack-name'] || '-'}\n✍️ ${U.bold('Author')}: ${e['sticker-pack-publisher'] || '-'}\n🆔 ${U.bold('ID')}: ${e['sticker-pack-id'] || '-'}`, { title: 'Sticker info' });
  });

  def('tg', { cat: 'sticker', heavy: true, usage: 'tg <t.me/addstickers/name> [count]', desc: 'Send a Telegram sticker pack as WhatsApp stickers (needs TELEGRAM_BOT_TOKEN on the server).' }, async ctx => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new UserError('Telegram stickers need a bot token. Add TELEGRAM_BOT_TOKEN to the local .env file and restart the bot (create one with @BotFather).');
    const link = ctx.args.match(/addstickers\/([A-Za-z0-9_]+)/);
    if (!link) throw new UserError('Send a link like https://t.me/addstickers/PackName');
    const limit = Math.min(15, Math.max(1, Number(ctx.argv[1]) || 8));
    const set = await U.getJson(`https://api.telegram.org/bot${token}/getStickerSet?name=${link[1]}`);
    if (!set.ok) throw new UserError('Pack not found.');
    const stickers = set.result.stickers.filter(s => !s.is_animated).slice(0, limit);
    if (!stickers.length) throw new UserError('This pack only has animated (.tgs) stickers, which are not supported.');
    await ctx.reply(`📥 Sending ${stickers.length} sticker(s) from *${set.result.title}*…`);
    for (const s of stickers) {
      try {
        const f = await U.getJson(`https://api.telegram.org/bot${token}/getFile?file_id=${s.file_id}`);
        const buf = await U.http(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`);
        const webp = s.is_video ? await U.videoToWebp(buf, 'webm') : buf;
        await ctx.sticker(await U.withExif(webp, set.result.title, ctx.var('STICKER_AUTHOR')));
        await U.sleep(700);
      } catch (e) { ctx.logger.warn({ error: e.message }, 'tg sticker failed'); }
    }
  });

  def('freepacks', { cat: 'sticker', since: '1.2.0', usage: 'freepacks', desc: 'Browse 12 free OpenMoji sticker packs (no API key needed).' }, async ctx => {
    const list = Object.entries(OPENMOJI_PACKS).map(([name, codes]) => `• *${name}* (${codes.length})`).join('\n');
    await ctx.reply(`🎨 Free sticker packs\n${list}\n\nSend *.freepack <name>* to get a pack. Artwork: OpenMoji, CC BY-SA 4.0 (openmoji.org).`, { title: 'Free sticker packs' });
  });

  def('freepack', { cat: 'sticker', since: '1.2.0', heavy: true, usage: 'freepack <name> [count]', desc: 'Send a free OpenMoji sticker pack; no API key or Telegram token required.' }, async ctx => {
    const [name, rawCount] = ctx.argv;
    const codes = OPENMOJI_PACKS[String(name || '').toLowerCase()];
    if (!codes) throw new UserError('Choose a pack with *.freepacks*, then send *.freepack <name> [count]*.');
    const count = rawCount ? Number(rawCount) : codes.length;
    if (!Number.isInteger(count) || count < 1 || count > codes.length) throw new UserError(`Choose a count from 1 to ${codes.length}.`);
    const pack = `OpenMoji: ${String(name).toLowerCase()}`;
    const packId = crypto.createHash('sha256').update(`openmoji:${String(name).toLowerCase()}`).digest('hex').slice(0, 32);
    const urls = codes.slice(0, count);
    await ctx.reply(`📦 Sending ${count} *${name}* stickers. Artwork by OpenMoji, licensed CC BY-SA 4.0 (openmoji.org).`, { title: 'Free sticker pack' });
    let sent = 0, failed = 0;
    for (let i = 0; i < urls.length; i += 4) {
      const batch = await Promise.allSettled(urls.slice(i, i + 4).map(async code => {
        const svg = await U.http(OPENMOJI_URL(code), { timeout: 12000, maxBytes: 500000, retries: 1 });
        const webp = await U.imageToWebp(svg);
        return U.withExif(webp, pack, OPENMOJI_AUTHOR, packId);
      }));
      for (const item of batch) {
        if (item.status === 'rejected') { failed++; continue; }
        await ctx.sticker(item.value);
        sent++;
        await U.sleep(350);
      }
    }
    if (!sent) throw new UserError('Could not download any stickers. Check that the bot PC can reach cdn.jsdelivr.net, then try again.');
    if (failed) await ctx.reply(`Sent ${sent} stickers; ${failed} could not be downloaded. Try the pack again for the missing ones.`);
  });
};

module.exports.__test = { OPENMOJI_PACKS, OPENMOJI_AUTHOR, OPENMOJI_URL };
