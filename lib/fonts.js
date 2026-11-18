'use strict';
/**
 * Unicode font engine (v1.2.0). Turns plain text into "fonts" using Unicode look-alike alphabets.
 * Characters a style cannot express are passed through unchanged, so output never contains unassigned code points.
 * The Math Alphanumeric block has reserved "holes" (e.g. script ℬ, fraktur ℭ, double-struck ℂ); they live in the
 * Letterlike Symbols block and are patched in here.
 */
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const a = 'abcdefghijklmnopqrstuvwxyz';
const D = '0123456789';
const cp = n => String.fromCodePoint(n);

/** Build a char->char map from start code points of the upper, lower and (optional) digit runs, plus hole patches. */
function alpha(up, low, dig, holes = {}) {
  const m = new Map();
  if (up) for (let i = 0; i < 26; i++) m.set(A[i], cp(up + i));
  if (low) for (let i = 0; i < 26; i++) m.set(a[i], cp(low + i));
  if (dig) for (let i = 0; i < 10; i++) m.set(D[i], cp(dig + i));
  for (const [k, v] of Object.entries(holes)) m.set(k, v);
  return m;
}
const pairs = (from, to) => { const m = new Map(); const f = [...from], t = [...to]; f.forEach((c, i) => t[i] && m.set(c, t[i])); return m; };

const SCRIPT_HOLES = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' };
const FRAKTUR_HOLES = { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' };
const DOUBLE_HOLES = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };

const SUP = pairs(a + D + '+-=()', 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᵠʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾');
const SUB = pairs('aeoxhklmnpst' + D + '+-=()', 'ₐₑₒₓₕₖₗₘₙₚₛₜ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎');
const SMALLCAPS = pairs(a, 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ');
const FLIP = pairs(a + '.,!?\'"()[]&_;', 'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz˙\'¡¿,„)(][⅋‾؛');
const BRACKET = (() => { const m = new Map(); for (let i = 0; i < 26; i++) { m.set(a[i], cp(0x249C + i)); m.set(A[i], cp(0x249C + i)); } return m; })();
const BLACKCIRCLE = (() => { const m = new Map(); for (let i = 0; i < 26; i++) { m.set(A[i], cp(0x1F150 + i)); m.set(a[i], cp(0x1F150 + i)); } return m; })();
const SQUARED = (() => { const m = new Map(); for (let i = 0; i < 26; i++) { m.set(A[i], cp(0x1F130 + i)); m.set(a[i], cp(0x1F130 + i)); } return m; })();
const BLACKSQUARE = (() => { const m = new Map(); for (let i = 0; i < 26; i++) { m.set(A[i], cp(0x1F170 + i)); m.set(a[i], cp(0x1F170 + i)); } return m; })();
const CIRCLED = (() => { const m = alpha(0x24B6, 0x24D0); m.set('0', '⓪'); for (let i = 1; i <= 9; i++) m.set(String(i), cp(0x2460 + i - 1)); return m; })();
const FULLWIDTH = (() => { const m = new Map(); for (let k = 33; k <= 126; k++) m.set(String.fromCharCode(k), cp(0xFF01 + k - 33)); m.set(' ', '　'); return m; })();

const mapper = (m, { upperFold = false, lowerFold = false } = {}) => t => [...t].map(c => m.get(upperFold ? c.toUpperCase() : lowerFold ? c.toLowerCase() : c) ?? m.get(c) ?? c).join('');
const combine = mark => t => [...t].map(c => (/\s/.test(c) ? c : c + mark)).join('');

/** Ordered list; the position (1-based) is the number users type: .style 3 hello */
const STYLES = [
  ['bold', 'Bold', mapper(alpha(0x1D5D4, 0x1D5EE, 0x1D7EC))],
  ['boldserif', 'Bold Serif', mapper(alpha(0x1D400, 0x1D41A, 0x1D7CE))],
  ['italic', 'Italic', mapper(alpha(0x1D608, 0x1D622))],
  ['bolditalic', 'Bold Italic', mapper(alpha(0x1D63C, 0x1D656))],
  ['serifitalic', 'Serif Italic', mapper(alpha(0x1D434, 0x1D44E, 0, { h: 'ℎ' }))],
  ['serifbolditalic', 'Serif Bold Italic', mapper(alpha(0x1D468, 0x1D482))],
  ['script', 'Script', mapper(alpha(0x1D49C, 0x1D4B6, 0, SCRIPT_HOLES))],
  ['boldscript', 'Bold Script', mapper(alpha(0x1D4D0, 0x1D4EA))],
  ['fraktur', 'Fraktur', mapper(alpha(0x1D504, 0x1D51E, 0, FRAKTUR_HOLES))],
  ['boldfraktur', 'Bold Fraktur', mapper(alpha(0x1D56C, 0x1D586))],
  ['doublestruck', 'Double-struck', mapper(alpha(0x1D538, 0x1D552, 0x1D7D8, DOUBLE_HOLES))],
  ['mono', 'Monospace', mapper(alpha(0x1D670, 0x1D68A, 0x1D7F6))],
  ['sans', 'Sans', mapper(alpha(0x1D5A0, 0x1D5BA, 0x1D7E2))],
  ['circled', 'Circled', mapper(CIRCLED)],
  ['blackcircled', 'Black Circled', mapper(BLACKCIRCLE)],
  ['squared', 'Squared', mapper(SQUARED)],
  ['blacksquared', 'Black Squared', mapper(BLACKSQUARE)],
  ['bracketed', 'Bracketed', mapper(BRACKET)],
  ['fullwidth', 'Fullwidth', mapper(FULLWIDTH)],
  ['smallcaps', 'Small Caps', mapper(SMALLCAPS, { lowerFold: true })],
  ['superscript', 'Superscript', mapper(SUP, { lowerFold: true })],
  ['subscript', 'Subscript', mapper(SUB, { lowerFold: true })],
  ['upsidedown', 'Upside Down', t => [...t.toLowerCase()].map(c => FLIP.get(c) ?? c).reverse().join('')],
  ['strike', 'Strikethrough', combine('̶')],
  ['underline', 'Underline', combine('̲')],
  ['doubleunderline', 'Double Underline', combine('̳')],
  ['slash', 'Slashed', combine('̸')],
  ['spaced', 'Spaced Out', t => [...t].join(' ')],
  ['dotted', 'Dotted', t => [...t].map(c => (/\s/.test(c) ? c : c + '̇')).join('')]
];

const byId = new Map(STYLES.map(([id, label, fn], i) => [id, { id, label, fn, n: i + 1 }]));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = { serif: 'boldserif', cursive: 'boldscript', gothic: 'boldfraktur', medieval: 'boldfraktur', typewriter: 'mono', monospace: 'mono', bubble: 'circled', bubbles: 'circled', blackbubble: 'blackcircled', wide: 'fullwidth', vapor: 'fullwidth', vaporwave: 'fullwidth', tiny: 'superscript', sup: 'superscript', sub: 'subscript', flip: 'upsidedown', upside: 'upsidedown', strikethrough: 'strike', small: 'smallcaps', caps: 'smallcaps', double: 'doublestruck', outline: 'doublestruck', box: 'squared', bold: 'bold' };

/** Look a style up by number (1-based), id, label or alias. Returns {id,label,fn,n} or null. */
function find(key) {
  const k = norm(key);
  if (!k) return null;
  if (/^\d+$/.test(k)) return STYLES[Number(k) - 1] ? byId.get(STYLES[Number(k) - 1][0]) : null;
  if (byId.has(k)) return byId.get(k);
  if (ALIASES[k]) return byId.get(ALIASES[k]);
  for (const s of byId.values()) if (norm(s.label) === k) return s;
  return null;
}
const apply = (key, text) => { const s = find(key); if (!s) throw new Error(`Unknown font style "${key}"`); return s.fn(String(text)); };
const list = () => [...byId.values()];

module.exports = { STYLES, list, find, apply, ALIASES };
