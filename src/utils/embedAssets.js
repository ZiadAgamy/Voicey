import { getVoiceyImage } from '../config/images.js';

/**
 * Remote-image version of the old asset helper.
 *
 * The function name is kept for compatibility with the existing commands.
 *
 * It NEVER reads /assets.
 * It NEVER uploads an attachment.
 *
 * Images are displayed as full embed images using setImage().
 */
export async function embedWithAsset(embed, filename) {
  const imageUrl = getVoiceyImage(filename);

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  return {
    embeds: [embed],
  };
}