'use strict';
const { UserError, http, getJson, sharp } = require('../lib/util');

module.exports = ({ def }) => {
  async function pollinationsText(prompt) {
    // Keyless fallback. Two request shapes against the same free service: the simple GET, then the OpenAI-style POST.
    const errors = [];
    try {
      const t = await http('https://text.pollinations.ai/' + encodeURIComponent(prompt) + '?model=openai', { as: 'text', timeout: 45000 });
      if (t && t.trim().length > 1) return t.trim();
      errors.push('empty reply');
    } catch (e) { errors.push(e.message); }
    try {
      const j = await getJson('https://text.pollinations.ai/openai', { method: 'POST', timeout: 60000, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'openai', messages: [{ role: 'user', content: prompt }] }) });
      const t = j?.choices?.[0]?.message?.content;
      if (t && t.trim().length > 1) return t.trim();
      errors.push('empty reply');
    } catch (e) { errors.push(e.message); }
    throw new UserError(`The free AI service did not answer (${errors[errors.length - 1]}). For reliable AI replies the owner can add a free key: GROQ_API_KEY (console.groq.com) or GEMINI_API_KEY (aistudio.google.com) in the dashboard's Environment panel.`);
  }
  async function openaiCompat({ base, key, model, prompt, image, extraHeaders = {} }) {
    const content = image
      ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime || 'image/jpeg'};base64,${image.buffer.toString('base64')}` } }]
      : prompt;
    const j = await getJson(base + '/chat/completions', {
      method: 'POST', timeout: 90000,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }] })
    });
    const t = j.choices?.[0]?.message?.content;
    if (!t) throw new Error(j.error?.message || 'Empty AI reply');
    return t.trim();
  }
  async function gemini(prompt, image) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const parts = [{ text: prompt }];
    if (image) parts.push({ inlineData: { mimeType: image.mime || 'image/jpeg', data: image.buffer.toString('base64') } });
    const j = await getJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', timeout: 90000, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] })
    });
    const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
    if (!t) throw new Error(j.error?.message || 'Gemini returned no text');
    return t.trim();
  }

  const PROVIDERS = {
    gpt: { env: 'OPENAI_API_KEY', run: (p, img) => openaiCompat({ base: 'https://api.openai.com/v1', key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', prompt: p, image: img }) },
    gemini: { env: 'GEMINI_API_KEY', run: gemini },
    groq: { env: 'GROQ_API_KEY', run: p => openaiCompat({ base: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', prompt: p }) },
    or: { env: 'OPENROUTER_API_KEY', run: p => openaiCompat({ base: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', prompt: p }) }
  };

  /** Ask a provider; falls back to a free keyless model when no API key is configured. */
  async function ask(provider, prompt, image) {
    const p = PROVIDERS[provider];
    if (p && process.env[p.env]) return { text: await p.run(prompt, image), via: provider };
    // Asked for a provider that has no key? Use any other provider that does have one before the keyless fallback.
    for (const [name, alt] of Object.entries(PROVIDERS)) {
      if (name === provider || !process.env[alt.env]) continue;
      try { return { text: await alt.run(prompt, name === 'gpt' || name === 'gemini' ? image : undefined), via: name }; } catch { /* try the next one */ }
    }
    return { text: await pollinationsText(prompt), via: 'free fallback model (set ' + (p?.env || 'an API key') + ' for the real one)' };
  }
  module.exports.ask = ask;

  for (const name of Object.keys(PROVIDERS)) {
    def(name, { cat: 'ai', heavy: true, usage: `${name} <question>`, desc: `Ask ${{ gpt: 'ChatGPT', gemini: 'Google Gemini', groq: 'Groq (Llama)', or: 'OpenRouter' }[name]}. Reply to an image to ask about it (gpt/gemini).` }, async ctx => {
      const prompt = ctx.input();
      if (!prompt) throw new UserError(`Ask something, e.g. *${ctx.var('PREFIX')}${name} explain black holes simply*`);
      let image = null;
      if (['gpt', 'gemini'].includes(name)) {
        const m = await ctx.media().catch(() => null);
        if (m?.kind === 'image') image = m;
      }
      const r = await ask(name, prompt, image);
      await ctx.reply(r.text + (r.via !== name ? `\n\n_via ${r.via}_` : ''));
    });
  }

  async function genImage(prompt, preferOpenAI) {
    if (preferOpenAI && process.env.OPENAI_API_KEY) {
      const j = await getJson('https://api.openai.com/v1/images/generations', {
        method: 'POST', timeout: 120000,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' })
      });
      const b = j.data?.[0]?.b64_json;
      if (!b) throw new Error(j.error?.message || 'No image returned');
      return Buffer.from(b, 'base64');
    }
    const seed = Math.floor(Math.random() * 1e6);
    return http(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`, { timeout: 120000 });
  }
  def('dall', { cat: 'ai', heavy: true, usage: 'dall <prompt>', desc: 'Generate an image (DALL-E if OPENAI_API_KEY is set, otherwise a free generator).' }, async ctx => {
    const p = ctx.input();
    if (!p) throw new UserError('Describe the image, e.g. *dall a samurai under a purple moon*');
    await ctx.image(await genImage(p, true), `🎨 ${p}`);
  });
  def('bing', { cat: 'ai', heavy: true, usage: 'bing <prompt>', desc: 'Generate an image from a prompt (free generator).' }, async ctx => {
    const p = ctx.input();
    if (!p) throw new UserError('Describe the image, e.g. *bing a neon city at night*');
    await ctx.image(await genImage(p, false), `🖼️ ${p}`);
  });

  def('upscale', { cat: 'ai', heavy: true, desc: 'Enlarge and sharpen a replied image (2x).' }, async ctx => {
    const m = await ctx.needMedia('image');
    const s = sharp();
    const meta = await s(m.buffer).metadata();
    const factor = Math.max(1, Math.min(2, 4096 / Math.max(meta.width || 1, meta.height || 1)));
    const out = await s(m.buffer).rotate().resize(Math.round(meta.width * factor), Math.round(meta.height * factor), { kernel: 'lanczos3' }).sharpen({ sigma: 1.1 }).modulate({ saturation: 1.05 }).png().toBuffer();
    await ctx.doc(out, 'upscaled.png', 'image/png', { caption: `✨ Upscaled ${meta.width}x${meta.height} → ${Math.round(meta.width * factor)}x${Math.round(meta.height * factor)}` });
  });
};
