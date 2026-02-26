/**
 * Search a vendor site for a product using Puppeteer (PrestaShop / Elina Pilates).
 *
 * Usage:
 *   npm run search-vendor-puppeteer -- --article-ref=100006
 *   npm run search-vendor-puppeteer -- --article-ref=100006 --vendor-url="https://www.elinapilates.com"
 *   npm run search-vendor-puppeteer -- --article-ref=100006 --headed   (visible browser; can match your session)
 *   npm run search-vendor-puppeteer -- --article-ref=100006 --no-visit-homepage
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
  const headed = process.argv.includes('--headed');
  const visitHomepageFirst = !process.argv.includes('--no-visit-homepage');

  console.log(`Opening search page for article_ref="${articleRef}", then checking each result for SKU match...\n`);
  if (headed) console.log('(Running in headed mode – browser window will open.)\n');

  const result = await openSearchPage(vendorUrl, articleRef, {
    headed,
    visitHomepageFirst,
  });

  console.log('Search page title:', result.title);
  console.log('Search URL:', result.url);
  console.log(`\nAll product links (${result.allProductHrefs.length}):`);
  result.allProductHrefs.forEach((href, i) => console.log(`  ${i + 1}. ${href}`));
  console.log('\nMatch by SKU:', result.productHref ?? '(none)');
  if (result.productHref) console.log('  → Clickable:', result.productHref);
  console.log(result.title.includes('Just a moment') ? '\n(Still on Cloudflare challenge.)' : '\n(Done.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
