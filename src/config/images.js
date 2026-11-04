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
