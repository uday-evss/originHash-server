const QRCode = require('qrcode');

// A sticker's QR opens the public verify page for its code, so a phone's own camera app
// lands somewhere useful and the in-app scanner can tell exactly which unit it is.
// Falls back to the bare code (which the in-app scanner also accepts) if PUBLIC_APP_URL is unset.
const stickerQrPayload = (code) => {
  const appUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return appUrl ? `${appUrl}/verify/${encodeURIComponent(code)}` : code;
};

// The same QR as printed on the sticker, as a PNG data URL for showing in the app.
const stickerQrDataUrl = (code) => QRCode.toDataURL(stickerQrPayload(code), { margin: 1, width: 320 });

module.exports = { stickerQrPayload, stickerQrDataUrl };
