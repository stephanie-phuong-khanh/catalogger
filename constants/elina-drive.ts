/**
 * Base URLs for Elina Pilates Google Drive image folders.
 * Used by the FE to resolve googleDriveLinks[].baseUrlConstantKey to a clickable link.
 */
export const ELINA_DRIVE_BASE_URLS: Record<string, string> = {
  // Elina Pilates: Scraped from vendor site
  vendorSiteScraped: 'https://drive.google.com/drive/folders/1UtDDqVoTJB741ehIhMo38iGpzZBCwV25?usp=drive_link',
  // Elina Pilates: Prepared images for Dansons
  elinaProvided: 'https://drive.google.com/drive/folders/1a8gPUaj5wUWqf13M3TW0YT9uadS89FPJ?usp=drive_link',
};
