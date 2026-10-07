const axios = require('axios');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { stickerQrPayload } = require('./stickerQr');

// A shareable PNG of a scan: the sticker drawn like the printed label (header, product, photo + QR as
// equal squares, ORIGINHASH + code), with the scan's outcome above and when / where below.
// Text is SVG rendered by sharp, so no browser (or CORS access to the photo) is needed.

const W = 1080;
const M = 60; // outer margin
const TILE = 380;
const FONT = "'Segoe UI', 'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";
const MONO = "'Consolas', 'DejaVu Sans Mono', 'Liberation Mono', monospace";
const FOREST = '#163832';
const GOLD = '#c9a464';
const CREAM = '#fbf3e7';
const BORDER = '#e7ddcc';
const MUTED = '#6b7280';

const STATUS = {
  VERIFIED: { label: 'Verified', color: '#15803d', bg: '#dcfce7' },
  MATCHED: { label: 'Verified · Authentic', color: '#15803d', bg: '#dcfce7' },
  AUTHENTIC: { label: 'Verified · Authentic', color: '#15803d', bg: '#dcfce7' },
  SCANNED: { label: 'Tracked · Product scanned', color: '#1d4ed8', bg: '#dbeafe' },
  UNMATCHED: { label: 'Product mismatched', color: '#dc2626', bg: '#fee2e2' },
  ALREADY_VIEWED: { label: 'Already verified earlier', color: '#9a3412', bg: '#ffedd5' },
  NOT_FOUND: { label: 'Not authentic', color: '#dc2626', bg: '#fee2e2' },
  INVALID: { label: 'Not an OriginHash QR', color: '#dc2626', bg: '#fee2e2' },
  ROLLED_BACK: { label: 'Not verified', color: '#374151', bg: '#e5e7eb' },
  PENDING: { label: 'Not verified', color: '#374151', bg: '#e5e7eb' },
};

// A scan whose code isn't one of our stickers (NOT_FOUND / INVALID): the result, what was scanned,
// and when / where — there is no sticker to draw.
const buildNoStickerCard = (scan, status) => {
  const H = 640;
  const cardTop = M + 64 + 36;
  const cardW = W - M * 2;
  const statusW = Math.min(cardW, 60 + status.label.length * 19);
  const lines = scan.code
    ? ['This code is not in OriginHash records,', 'so the product may not be genuine.']
    : ["This QR code doesn't belong to an", 'OriginHash product sticker.'];
  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="${(W - statusW) / 2}" y="${M}" width="${statusW}" height="64" rx="32" fill="${status.bg}"/>
  <text x="${W / 2}" y="${M + 43}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="700" fill="${status.color}">${esc(status.label)}</text>
  <rect x="${M}" y="${cardTop}" width="${cardW}" height="300" rx="26" fill="#ffffff" stroke="${BORDER}" stroke-width="3"/>
  <text x="${W / 2}" y="${cardTop + 70}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="700" fill="${MUTED}">${scan.code ? 'CODE SCANNED' : 'QR SCANNED'}</text>
  <text x="${W / 2}" y="${cardTop + 130}" text-anchor="middle" font-family="${MONO}" font-size="40" font-weight="700" fill="${FOREST}">${esc(clip(scan.code || 'Unknown QR code', 30))}</text>
  ${lines.map((l, i) => `<text x="${W / 2}" y="${cardTop + 200 + i * 40}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${MUTED}">${esc(l)}</text>`).join('')}
  <text x="${M + 40}" y="${cardTop + 300 + 60}" font-family="${FONT}" font-size="26" font-weight="700" fill="${FOREST}">ORIGINHASH</text>
  <text x="${W - M - 40}" y="${cardTop + 300 + 60}" text-anchor="end" font-family="${FONT}" font-size="26" fill="${MUTED}">${esc(`Checked on ${dateTime(scan.createdAt)}`)}</text>
  ${scan.locationName ? `<text x="${W - M - 40}" y="${cardTop + 300 + 100}" text-anchor="end" font-family="${FONT}" font-size="26" fill="${MUTED}">${esc(clip(scan.locationName, 50))}</text>` : ''}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Long values are cut to fit (the card is a fixed width).
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

const fmt = (date, opts) => new Date(date).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', ...opts });
const dateTime = (d) => fmt(d, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const shortDate = (d) => fmt(d, { day: '2-digit', month: '2-digit', year: '2-digit' });

const fetchPhoto = async (url) => {
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    return await sharp(Buffer.from(data)).rotate().resize(TILE, TILE, { fit: 'cover', position: sharp.strategy.attention }).png().toBuffer();
  } catch {
    return null; // the card is still useful without the photo
  }
};

// scan: the Scan with qrCode.batch loaded; showPhoto: whether this viewer may see the sticker image.
const buildShareCard = async (scan, { showPhoto }) => {
  const { qrCode } = scan;
  const status = STATUS[scan.result] || { label: 'Verification', color: MUTED, bg: '#e5e7eb' };
  if (!qrCode) return buildNoStickerCard(scan, status);
  const { batch } = qrCode;

  const [qr, photo] = await Promise.all([
    QRCode.toBuffer(stickerQrPayload(qrCode.code), { margin: 1, width: TILE, color: { dark: '#000000', light: '#ffffff' } }),
    showPhoto && qrCode.imageUrl ? fetchPhoto(qrCode.imageUrl) : null,
  ]);

  // Vertical layout
  const statusTop = M;
  const statusH = 64;
  const cardTop = statusTop + statusH + 36;
  const headerH = 130;
  const productY = cardTop + headerH + 64;
  const tilesTop = productY + (batch.variantSize ? 64 : 36);
  const footerY = tilesTop + TILE + 62;
  const cardBottom = footerY + 34;
  const metaY = cardBottom + 60;
  const H = metaY + (scan.locationName ? 90 : 50) + M - 20;

  const cardW = W - M * 2;
  const tiles = photo ? [W / 2 - TILE - 30, W / 2 + 30] : [W / 2 - TILE / 2];
  const qrX = photo ? tiles[1] : tiles[0];

  const statusW = Math.min(cardW, 60 + status.label.length * 19);
  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="${(W - statusW) / 2}" y="${statusTop}" width="${statusW}" height="${statusH}" rx="${statusH / 2}" fill="${status.bg}"/>
  <text x="${W / 2}" y="${statusTop + 43}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="700" fill="${status.color}">${esc(status.label)}</text>

  <rect x="${M}" y="${cardTop}" width="${cardW}" height="${cardBottom - cardTop}" rx="26" fill="#ffffff" stroke="${BORDER}" stroke-width="3"/>
  <path d="M${M} ${cardTop + 26} a26 26 0 0 1 26 -26 h${cardW - 52} a26 26 0 0 1 26 26 v${headerH - 26} h-${cardW} z" fill="${FOREST}"/>
  <text x="${M + 40}" y="${cardTop + 60}" font-family="${FONT}" font-size="44" font-weight="700" fill="#ffffff">${esc(clip(String(batch.producer).toUpperCase(), 32))}</text>
  <text x="${M + 40}" y="${cardTop + 104}" font-family="${FONT}" font-size="28" fill="${GOLD}">${esc(clip(`Batch ${batch.batchNo} · Packed ${shortDate(batch.createdAt)}`, 52))}</text>

  <text x="${W / 2}" y="${productY}" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="700" fill="${FOREST}">${esc(clip(batch.productName, 34))}</text>
  ${batch.variantSize ? `<text x="${W / 2}" y="${productY + 40}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${MUTED}">${esc(clip(batch.variantSize, 40))}</text>` : ''}

  ${tiles.map((x) => `<rect x="${x - 2}" y="${tilesTop - 2}" width="${TILE + 4}" height="${TILE + 4}" rx="18" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>`).join('')}

  <text x="${M + 40}" y="${footerY}" font-family="${FONT}" font-size="26" font-weight="700" fill="${FOREST}">ORIGINHASH</text>
  <text x="${W - M - 40}" y="${footerY}" text-anchor="end" font-family="${MONO}" font-size="34" font-weight="700" fill="${FOREST}">${esc(qrCode.code)}</text>

  <text x="${W / 2}" y="${metaY}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${MUTED}">${esc(`${scan.action === 'record' ? 'Scanned' : 'Checked'} on ${dateTime(scan.createdAt)}`)}</text>
  ${scan.locationName ? `<text x="${W / 2}" y="${metaY + 42}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="${MUTED}">${esc(clip(scan.locationName, 60))}</text>` : ''}
</svg>`;

  const layers = [{ input: qr, left: Math.round(qrX), top: Math.round(tilesTop) }];
  if (photo) {
    const mask = Buffer.from(`<svg width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="16" fill="#fff"/></svg>`);
    const rounded = await sharp(photo).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: rounded, left: Math.round(tiles[0]), top: Math.round(tilesTop) });
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
};

module.exports = { buildShareCard };
