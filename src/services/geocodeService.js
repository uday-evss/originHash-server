const axios = require('axios');

// Turns scan coordinates into a place name ("Shamshabad, Telangana") using OpenStreetMap's
// Nominatim. Its usage policy asks for at most one request per second, an identifying
// User-Agent, and caching: https://operations.osmfoundation.org/policies/nominatim/
// For heavy production traffic, point GEOCODER_URL at a paid or self-hosted Nominatim.
const ENDPOINT = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT || `OriginHash/1.0 (${process.env.PUBLIC_APP_URL || 'originhash backend'})`;
const MIN_GAP_MS = 1100;

// ~100 m buckets, so nearby scans share one lookup.
const cache = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

const placeName = (address = {}) => {
  const locality =
    address.suburb || address.village || address.town || address.city_district || address.city || address.county;
  // Indian city suburbs often come back as municipal wards ("Ward 107 Madhapur") — keep the area name.
  const area = locality?.replace(/^ward\s+(no\.?\s*)?\d+\s*[-,]?\s*/i, '') || locality;
  return [area, address.state].filter(Boolean).join(', ') || null;
};

// Resolves to a place name, or null when the service has nothing for these coordinates.
// Rejects on network/service errors (those aren't cached, so a later call retries).
const reverseGeocode = (latitude, longitude) => {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  const lookup = queue.then(async () => {
    if (cache.has(key)) return cache.get(key);
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const { data } = await axios.get(ENDPOINT, {
      params: { format: 'jsonv2', lat: latitude, lon: longitude, zoom: 14, addressdetails: 1, 'accept-language': 'en' },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 8000,
    });
    const name = placeName(data?.address);
    cache.set(key, name);
    return name;
  });
  queue = lookup.catch(() => {});
  return lookup;
};

module.exports = { reverseGeocode };
