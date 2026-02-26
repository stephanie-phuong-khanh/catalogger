/**
 * Search a vendor site for a product using Puppeteer (PrestaShop / Elina Pilates).
 *
 * Usage:
 *   npm run search-vendor-puppeteer -- --article-ref=400004
 *   npm run search-vendor-puppeteer -- --article-ref=100006 --vendor-url="https://www.elinapilates.com"
 */

import { openSearchPage } from '../../lib/listings/search-vendor-puppeteer';

const CONFIG = {
  vendorBaseUrl: 'https://www.elinapilates.com',
  articleRef: '400004',
};

async function main() {
  const articleRef =
    process.argv.find((arg) => arg.startsWith('--article-ref='))?.split('=')[1]?.trim() ?? CONFIG.articleRef;
  const vendorUrl =
    process.argv.find((arg) => arg.startsWith('--vendor-url='))?.split('=')[1]?.trim() ?? CONFIG.vendorBaseUrl;

  console.log(`Step 1: Opening search page for article_ref="${articleRef}"...\n`);

  const result = await openSearchPage(vendorUrl, articleRef);

  console.log('Page title:', result.title);
  console.log('Search URL:', result.url);
  console.log('First product link:', result.productHref ?? '(none found)');
  console.log(result.title.includes('Just a moment') ? '\n(Still on Cloudflare challenge.)' : '\n(Page loaded.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
