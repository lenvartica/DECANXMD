'use strict';
const U = require('../lib/util');
const { UserError } = U;

function pdfFrom(items) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    items.forEach((it, i) => {
      if (i) doc.addPage();
      if (it.image) doc.image(it.image, { fit: [515, 760], align: 'center', valign: 'center' });
      else doc.fontSize(12).text(it.text, { align: 'left' });
    });
    doc.end();
  });
}

module.exports = ({ def }) => {
  def('pdf', { cat: 'document', heavy: true, usage: 'pdf [text] (or reply to an image / text)', desc: 'Make a PDF from text or from a replied image.' }, async ctx => {
    const m = await ctx.media().catch(() => null);
    let items;
    if (m && m.kind === 'image') {
      items = [{ image: await U.sharp()(m.buffer).rotate().flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer() }];
    } else {
      const t = ctx.input();
      if (!t) throw new UserError('Reply to an image or text, or write the text after the command.');
      items = [{ text: t }];
    }
    await ctx.doc(await pdfFrom(items), 'document.pdf', 'application/pdf');
  });

  def('page', { cat: 'document', heavy: true, usage: 'page <website>', desc: 'Save a website as a full-page PDF.' }, async ctx => {
    const raw = ctx.input().trim();
    const url = U.findUrl(raw) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? 'https://' + raw : null);
    if (!url) throw new UserError('Send a website link.');
    const png = await U.http(`https://image.thum.io/get/width/1100/fullpage/noanimate/${url}`, { timeout: 60000 });
    const jpg = await U.sharp()(png).flatten({ background: '#fff' }).jpeg({ quality: 85 }).toBuffer();
    await ctx.doc(await pdfFrom([{ image: jpg }]), 'page.pdf', 'application/pdf', { caption: `📄 ${url}` });
  });
};
