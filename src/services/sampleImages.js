const axios = require('axios');

// Photos for "Generate sample folder": each category is an iNaturalist species whose curated
// taxon photos (sharp, subject-filling, Creative Commons) are used. No API key needed; one API
// call covers every category.
const CATEGORIES = [
  { name: 'dog', taxonId: 47144 },
  { name: 'cat', taxonId: 118552 },
  { name: 'human', taxonId: 43584 },
  { name: 'peacock', taxonId: 1204 },
  { name: 'lion', taxonId: 41964 },
  { name: 'tiger', taxonId: 41967 },
  { name: 'elephant', taxonId: 43694 },
  { name: 'horse', taxonId: 209233 },
  { name: 'zebra', taxonId: 43335 },
  { name: 'giraffe', taxonId: 42157 },
  { name: 'butterfly', taxonId: 48662, topPhotos: 2 }, // its 3rd photo is a caterpillar
  { name: 'parrot', taxonId: 19022 },
  { name: 'owl', taxonId: 20044 },
  { name: 'camel', taxonId: 81542 },
  { name: 'rabbit', taxonId: 43151 },
  { name: 'fox', taxonId: 42069 },
  { name: 'cow', taxonId: 74113 },
  { name: 'eagle', taxonId: 5305 },
  { name: 'flamingo', taxonId: 73222 },
  { name: 'panda', taxonId: 41659 },
];

// Only each species' first few curated photos are used: iNaturalist orders them most
// representative first, and later ones drift into tracks, droppings, skulls, eggs and larvae.
const TOP_PHOTOS = 3;

const INATURALIST_API = 'https://api.inaturalist.org/v1';
const HEADERS = { 'User-Agent': 'OriginHash/1.0 (sample image stock generator)' };
const TIMEOUT_MS = 20000;

// Curated photos rarely change, so keep them for a while instead of asking on every click.
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null; // { at, photosByTaxon: Map<taxonId, photo[]> }

// Taxon id → its usable photos in iNaturalist's curated order: Creative Commons only ("all
// rights reserved" has no licence code), at the 1024 px "large" size — above the upload
// minimum of 640×480.
const loadPhotos = async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.photosByTaxon;

  const ids = CATEGORIES.map((c) => c.taxonId).join(',');
  const { data } = await axios.get(`${INATURALIST_API}/taxa/${ids}`, { headers: HEADERS, timeout: TIMEOUT_MS });

  const photosByTaxon = new Map();
  for (const taxon of data.results || []) {
    const photos = (taxon.taxon_photos || [])
      .map(({ photo }) => photo)
      .filter((photo) => photo?.url && photo.license_code)
      .map((photo) => ({
        url: photo.url.replace(/\/square\.(\w+)(\?.*)?$/, '/large.$1'),
        attribution: photo.attribution,
        license: photo.license_code,
      }));
    photosByTaxon.set(taxon.id, photos);
  }

  cache = { at: Date.now(), photosByTaxon };
  return photosByTaxon;
};

const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Every category in random order, each with its top photos in random order.
const sampleCandidates = async () => {
  const photosByTaxon = await loadPhotos();
  return shuffle(CATEGORIES)
    .map((category) => ({
      category: category.name,
      photos: shuffle((photosByTaxon.get(category.taxonId) || []).slice(0, category.topPhotos || TOP_PHOTOS)),
    }))
    .filter((candidate) => candidate.photos.length);
};

// Downloads one photo as an upload-shaped file ({ buffer, originalname, mimetype, size }).
const downloadPhoto = async (photo, fileName) => {
  const { data, headers } = await axios.get(photo.url, {
    responseType: 'arraybuffer',
    headers: HEADERS,
    timeout: TIMEOUT_MS,
  });
  const buffer = Buffer.from(data);
  return {
    buffer,
    originalname: fileName,
    mimetype: String(headers['content-type'] || 'image/jpeg').split(';')[0],
    size: buffer.length,
  };
};

module.exports = { CATEGORIES, sampleCandidates, downloadPhoto };
