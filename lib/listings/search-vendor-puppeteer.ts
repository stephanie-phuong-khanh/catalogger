import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

/** Options for PrestaShop search via Puppeteer (e.g. Elina Pilates). */
export interface SearchVendorPuppeteerOptions {
  /** Path to search page including locale, e.g. "/eu/en/search". Default "/eu/en/search". */
  searchPath?: string;
  /** Time in ms to wait after load for Cloudflare/JS. Default 8000. */
  waitAfterLoadMs?: number;
}

/** PrestaShop product URLs are typically /path/id-product-name.html */
const PRODUCT_LINK_PATTERN = /\/\d+-[^/]+\.html$/i;

/**
 * Step 2: On the current search results page, get the href of the first product link.
 * Returns relative or absolute URL, or null if none found.
 */
function getFirstProductLinkFromPage(page: Page): Promise<string | null> {
  return page.evaluate((pattern: string) => {
    const re = new RegExp(pattern);
    const links = document.querySelectorAll<HTMLAnchorElement>('a[href*=".html"]');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href && re.test(href)) return href;
    }
    return null;
  }, PRODUCT_LINK_PATTERN.source);
}

/**
 * Step 1+2: Launch browser, navigate to the PrestaShop search URL, wait for load,
 * then extract the first product link from the results. Returns title, search URL, and product href.
 */
export async function openSearchPage(
  vendorBaseUrl: string,
  articleRef: string,
  options: SearchVendorPuppeteerOptions = {},
): Promise<{ title: string; url: string; productHref: string | null }> {
  const base = vendorBaseUrl.replace(/\/$/, '');
  const searchPath = options.searchPath ?? '/eu/en/search';
  const waitAfterLoadMs = options.waitAfterLoadMs ?? 8000;
  const searchUrl = `${base}${searchPath}?s=${encodeURIComponent(articleRef)}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, waitAfterLoadMs));

    const title = await page.title();
    const url = page.url();
    const productHref = await getFirstProductLinkFromPage(page);
    return { title, url, productHref };
  } finally {
    await browser.close();
  }
}
