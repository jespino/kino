// PDF export (CLI and studio): one page per picture, each filling a page the
// size of the video (1 px = 1 pt). The host rasterizes the pages, so glows,
// patterns and fonts look exactly like the video.
import { PDFDocument } from 'pdf-lib';

export interface PdfPage {
  /** PNG or JPEG bytes */
  image: Uint8Array;
  type: 'png' | 'jpeg';
}

export interface PdfInfo {
  title?: string;
  /** page size in points (the video size) */
  width: number;
  height: number;
}

export async function buildPdf(pages: PdfPage[], info: PdfInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (info.title) doc.setTitle(info.title);
  doc.setCreator('Kino');
  doc.setProducer('Kino (pdf-lib)');
  for (const p of pages) {
    const img = p.type === 'png' ? await doc.embedPng(p.image) : await doc.embedJpg(p.image);
    const page = doc.addPage([info.width, info.height]);
    page.drawImage(img, { x: 0, y: 0, width: info.width, height: info.height });
  }
  return doc.save();
}
