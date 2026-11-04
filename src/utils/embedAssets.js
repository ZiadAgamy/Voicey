import { getVoiceyImage } from '../config/images.js';

export async function embedWithAsset(embed, filename) {
  const imageUrl = getVoiceyImage(filename);

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  return {
    embeds: [embed],
  };
}