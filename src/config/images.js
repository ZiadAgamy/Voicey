/**
 * Optional embed thumbnails.
 *
 * Voicey works fine with no images at all. To show a thumbnail in an embed,
 * host a PNG somewhere permanent and put its direct URL in your `.env`:
 *
 *   VOICEY_IMAGE_WELCOME=https://example.com/welcome.png
 *
 * Note: Fluxer/Discord CDN attachment links are signed and EXPIRE, so they are
 * a bad choice here. Use a permanent host (your own site, GitHub raw, etc).
 */
const KEYS = [
  'welcome',
  'control',
  'setup',
  'help',
  'prefix',
  'botinfo',
  'uptime',
  'language',
];

export const VoiceyImages = Object.fromEntries(
  KEYS.map((key) => [key, process.env[`VOICEY_IMAGE_${key.toUpperCase()}`]?.trim() || null]),
);

const FILE_TO_KEY = Object.fromEntries(KEYS.map((key) => [`${key}.png`, key]));

function validUrl(value) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getVoiceyImage(filename) {
  const key = FILE_TO_KEY[filename];
  const url = key ? VoiceyImages[key] : null;

  return url && validUrl(url) ? url : null;
}
