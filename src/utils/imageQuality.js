const sharp = require('sharp');

// Minimum size in either orientation (a portrait 480×640 is as good as a landscape 640×480).
// Stickers print the image at about 500 px and phones show it at roughly that size, so VGA is
// enough — as long as the photo is actually sharp, which the focus check below makes sure of.
const MIN_LONG_SIDE = 640;
const MIN_SHORT_SIDE = 480;

// Sharpness: variance of the Laplacian on a 512 px greyscale copy, averaged over the busiest
// quarter of a 4×4 grid, so a sharp product on a plain background still counts as sharp.
// Calibrated on the stock images: sharp photos score about 500–3000 (including a small subject
// on white); out-of-focus shots and small images blown up to size score about 15–110.
const MIN_FOCUS_SCORE = 150;
const GRID = 4;

const focusScore = async (buffer) => {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const tiles = Array.from({ length: GRID * GRID }, () => ({ sum: 0, sumSq: 0, n: 0 }));
  for (let y = 1; y < h - 1; y++) {
    const row = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      const tile = tiles[row * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w))];
      tile.sum += lap;
      tile.sumSq += lap * lap;
      tile.n += 1;
    }
  }

  const variances = tiles
    .filter((t) => t.n)
    .map((t) => t.sumSq / t.n - (t.sum / t.n) ** 2)
    .sort((a, b) => b - a);
  const busiest = variances.slice(0, Math.max(1, Math.round(variances.length / 4)));
  return Math.round(busiest.reduce((a, b) => a + b, 0) / busiest.length);
};

// Resolves to a rejection reason, or null when the image is good to use.
const checkImageQuality = async (buffer, { width, height }) => {
  if (Math.max(width, height) < MIN_LONG_SIDE || Math.min(width, height) < MIN_SHORT_SIDE) {
    return `Too small (${width}×${height}). Minimum is ${MIN_LONG_SIDE}×${MIN_SHORT_SIDE}, in either orientation.`;
  }
  const score = await focusScore(buffer);
  if (score < MIN_FOCUS_SCORE) {
    return `Too blurry (sharpness ${score}, needs ${MIN_FOCUS_SCORE}). Use a sharper, in-focus photo.`;
  }
  return null;
};

module.exports = { checkImageQuality, focusScore, MIN_LONG_SIDE, MIN_SHORT_SIDE, MIN_FOCUS_SCORE };
