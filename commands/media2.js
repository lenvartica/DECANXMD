'use strict';
/** More media tools: blur, resize, triggered, metadata, ocr, transcribe, readpdf. */
const U = require('../lib/util');
const cards = require('../lib/cards');
const { UserError, bold } = U;

const getMedia = async (ctx, kinds, hint) => {
  const m = await ctx.media().catch(() => null);
  if (!m || !kinds.includes(m.kind)) throw new UserError(hint);
  return m;
};
const kb = n => (n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(2) + ' MB');

module.exports = ({ def }) => {
  const P = ctx => ctx.var('PREFIX');

  def('blur', { cat: 'editor', heavy: true, usage: 'blur [1-40] (reply to an image)', desc: 'Blur an image. Higher number = more blur (default 10).' }, async ctx => {
    const m = await getMedia(ctx, ['image'], `Reply to an image with *${P(ctx)}blur* (or *${P(ctx)}blur 25*).`);
    const n = Math.min(40, Math.max(1, parseFloat(ctx.argv[0]) || 10));
    await ctx.image(await U.sharp()(m.buffer).rotate().blur(n).jpeg({ quality: 90 }).toBuffer(), `🌫️ Blur ${n}`);
  });

  def(['resize', 'scale'], { cat: 'editor', heavy: true, usage: 'resize 800x600 • resize 50% • resize 1024 (reply to an image)', desc: 'Change an image size by pixels (800x600, or one side only) or by percent.' }, async ctx => {
    const m = await getMedia(ctx, ['image'], `Reply to an image, for example *${P(ctx)}resize 800x600* or *${P(ctx)}resize 50%*.`);
    const a = (ctx.argv[0] || '').toLowerCase();
    const img = U.sharp()(m.buffer).rotate();
    const meta = await U.sharp()(m.buffer).metadata();
    let w, h;
    const pct = a.match(/^(\d{1,3})%$/), px = a.match(/^(\d{1,4})(?:x(\d{1,4}))?$/);
    if (pct) { w = Math.round(meta.width * pct[1] / 100); h = Math.round(meta.height * pct[1] / 100); }
    else if (px) { w = +px[1]; h = px[2] ? +px[2] : undefined; }
    else throw new UserError(`Examples: *${P(ctx)}resize 800x600*, *${P(ctx)}resize 50%*, *${P(ctx)}resize 1024*`);
    if (w < 16 || w > 4000 || (h && (h < 16 || h > 4000))) throw new UserError('Sizes must be between 16 and 4000 pixels.');
    const buf = await img.resize(w, h, { fit: h ? 'fill' : 'inside' }).jpeg({ quality: 90 }).toBuffer();
    const r = await U.sharp()(buf).metadata();
    await ctx.image(buf, `📐 ${r.width}×${r.height} • ${kb(buf.length)}`);
  });

  def('triggered', { cat: 'editor', heavy: true, desc: 'Red "TRIGGERED" meme effect. Reply to an image.' }, async ctx => {
    const m = await getMedia(ctx, ['image'], `Reply to an image with *${P(ctx)}triggered*.`);
    const S = 512;
    const base = await U.sharp()(m.buffer).rotate().resize(S, S, { fit: 'cover' }).modulate({ saturation: 1.5 }).linear(1.1, -8).tint('#ff3b3b').toBuffer();
    const bar = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect y="${S - 90}" width="${S}" height="90" fill="#e11d1d"/>${cards.text('TRIGGERED', S / 2, S - 70, 8, '#ffffff', 'middle')}<rect width="${S}" height="${S}" fill="none" stroke="#ff0000" stroke-width="10"/></svg>`;
    await ctx.image(await U.sharp()(base).composite([{ input: Buffer.from(bar) }]).jpeg({ quality: 90 }).toBuffer(), '😡');
  });

  def(['metadata', 'mediainfo'], { cat: 'editor', heavy: true, desc: 'Technical details of a replied image, video, audio, sticker or file.' }, async ctx => {
    const m = await getMedia(ctx, ['image', 'video', 'audio', 'sticker', 'document'], `Reply to a photo, video, audio, sticker or file with *${P(ctx)}metadata*.`);
    const rows = [`${bold('Type')}: ${m.kind}${m.animated ? ' (animated)' : ''}`, `${bold('Format')}: ${m.mime || 'unknown'}`, `${bold('Size')}: ${kb(m.buffer.length)}`];
    if (m.name) rows.push(`${bold('Name')}: ${m.name}`);
    if (m.seconds) rows.push(`${bold('Duration')}: ${m.seconds}s`);
    if (['image', 'sticker'].includes(m.kind)) {
      const x = await U.sharp()(m.buffer).metadata().catch(() => null);
      if (x) rows.push(`${bold('Dimensions')}: ${x.width}×${x.height}`, `${bold('Color')}: ${x.space || '?'}${x.hasAlpha ? ' + transparency' : ''}`, `${bold('Camera data')}: ${x.exif ? 'present' : 'none'}`);
    }
    await ctx.reply(rows.join('\n'), { title: 'Metadata' });
  });

  /* ---------------- text extraction ---------------- */
  async function aiVision(m, prompt) {
    const { ask } = require('./ai');
    for (const p of ['gemini', 'gpt']) if (process.env[{ gemini: 'GEMINI_API_KEY', gpt: 'OPENAI_API_KEY' }[p]]) return (await ask(p, prompt, m)).text;
    return null;
  }
  async function ocrSpace(m) {
    const body = new URLSearchParams({ apikey: process.env.OCR_SPACE_KEY || 'helloworld', language: 'eng', isOverlayRequired: 'false', base64Image: `data:${m.mime || 'image/jpeg'};base64,${m.buffer.toString('base64')}` });
    const j = await U.getJson('https://api.ocr.space/parse/image', { method: 'POST', timeout: 60000, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (j.IsErroredOnProcessing) throw new Error([].concat(j.ErrorMessage || 'OCR failed').join(' '));
    return (j.ParsedResults || []).map(r => r.ParsedText).join('\n').trim();
  }
  def(['ocr', 'imgtext', 'totext'], { cat: 'editor', heavy: true, usage: 'ocr (reply to an image)', desc: 'Read the text inside an image.' }, async ctx => {
    const m = await getMedia(ctx, ['image'], `Reply to a photo of text with *${P(ctx)}ocr*.`);
    let text = await aiVision(m, 'Extract ALL the text visible in this image exactly as written. Output only the text, no commentary. If there is no text, reply with: NO TEXT').catch(() => null);
    if (!text) text = await ocrSpace(m).catch(e => { throw new UserError('Could not read the text (' + String(e.message).slice(0, 80) + ').'); });
    if (!text || /^NO TEXT$/i.test(text.trim())) throw new UserError('I could not find any text in that image.');
    await ctx.reply(text.slice(0, 3500), { title: 'Text from image' });
  });

  def(['transcribe', 'speech2text', 'stt'], { cat: 'audio', heavy: true, usage: 'transcribe (reply to a voice note or audio)', desc: 'Turn a voice note into text (needs GROQ_API_KEY or OPENAI_API_KEY on the server).' }, async ctx => {
    const m = await getMedia(ctx, ['audio', 'video'], `Reply to a voice note with *${P(ctx)}transcribe*.`);
    const provider = process.env.GROQ_API_KEY ? { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: process.env.GROQ_API_KEY, model: 'whisper-large-v3' } : process.env.OPENAI_API_KEY ? { url: 'https://api.openai.com/v1/audio/transcriptions', key: process.env.OPENAI_API_KEY, model: 'whisper-1' } : null;
    if (!provider) throw new UserError('Voice-to-text needs a speech service. Add GROQ_API_KEY (free at groq.com) or OPENAI_API_KEY to the server settings.');
    if (m.buffer.length > 24 * 1048576) throw new UserError('That audio is too large (limit about 24 MB).');
    const form = new FormData();
    form.append('model', provider.model);
    form.append('file', new Blob([m.buffer], { type: m.mime || 'audio/ogg' }), m.kind === 'video' ? 'audio.mp4' : 'audio.ogg');
    const r = await fetch(provider.url, { method: 'POST', headers: { authorization: `Bearer ${provider.key}` }, body: form, signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.text) throw new UserError('Transcription failed: ' + String(j.error?.message || r.status).slice(0, 100));
    await ctx.reply(j.text.trim() || '(no speech detected)', { title: 'Transcript' });
  });

  def(['readpdf', 'pdftext', 'pdf2text'], { cat: 'document', heavy: true, usage: 'readpdf (reply to a PDF)', desc: 'Extract the text from a PDF document.' }, async ctx => {
    const m = await getMedia(ctx, ['document'], `Reply to a PDF with *${P(ctx)}readpdf*.`);
    if (!/pdf/i.test(m.mime || '') && !/\.pdf$/i.test(m.name || '')) throw new UserError('That file is not a PDF.');
    let parse;
    try { parse = require('pdf-parse'); } catch { throw new UserError('PDF reading is not installed on this server yet. Run npm install (pdf-parse is in package.json) and redeploy.'); }
    const r = await parse(m.buffer).catch(() => { throw new UserError('I could not read that PDF (it may be scanned images or password protected).'); });
    const t = String(r.text || '').replace(/\n{3,}/g, '\n\n').trim();
    if (!t) throw new UserError('That PDF has no selectable text (it is probably a scan). Try *' + P(ctx) + 'ocr* on a photo of the page.');
    await ctx.reply(`${t.slice(0, 3200)}${t.length > 3200 ? '\n\n…(' + (t.length - 3200) + ' more characters)' : ''}\n\n📄 ${r.numpages} page${r.numpages > 1 ? 's' : ''}`, { title: 'PDF text' });
  });
};
