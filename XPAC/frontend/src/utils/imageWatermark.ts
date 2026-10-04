/**
 * Stamp text onto an image file in the browser, before it is uploaded.
 *
 * Used for the payment proof in TransactionFormModal: the customer's full name goes in the upper
 * right corner, in orange, so a proof image always says whose payment it is wherever it ends up
 * (Google Drive, a printout, a forwarded screenshot).
 *
 * The text is scaled to the image (about 4% of the shorter side, never under 16px) so it reads
 * the same on a phone photo and a small screenshot, and gets a dark outline so it stays legible
 * on white receipts as well as dark backgrounds. A name too wide for the image wraps onto more
 * lines rather than running off the edge.
 *
 * Never throws: anything that is not a decodable image, or a browser without canvas support, gets
 * the original file back unchanged, so a stamping problem can never block saving the payment.
 */

const ORANGE = '#f97316';

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });

/** Break `text` into lines no wider than `maxWidth` at the context's current font. */
const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

export const stampTextTopRight = async (file: File, text: string): Promise<File> => {
  const label = (text || '').trim();
  if (!label || !file || !file.type.startsWith('image/')) return file;

  try {
    const img = await loadImage(file);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);

    const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.04));
    const margin = Math.round(fontSize * 0.75);
    const lineHeight = Math.round(fontSize * 1.2);

    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, Math.round(fontSize / 6));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillStyle = ORANGE;

    const lines = wrapLines(ctx, label, width - margin * 2);
    const x = width - margin;
    lines.forEach((line, i) => {
      const y = margin + i * lineHeight;
      ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
    });

    // PNG stays PNG (lossless screenshots); everything else is written as JPEG at high quality.
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.92));
    if (!blob) return file;

    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    const baseName = (file.name || 'payment_proof').replace(/\.[^/.]+$/, '');
    return new File([blob], `${baseName}.${extension}`, { type: outputType, lastModified: Date.now() });
  } catch {
    return file;
  }
};
