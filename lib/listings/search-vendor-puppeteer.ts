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
  /** Time in ms to wait for real search results (e.g. "Showing 1-1 of 1 item(s)"). Default 12000. */
  waitForSearchResultsMs?: number;
  /** Time in ms to wait after loading each product page. Default 2000. */
  waitAfterProductLoadMs?: number;
  /** Run with visible browser (headless: false). Can get same results as your normal browser. Default false. */
  headed?: boolean;
  /** Visit the store homepage first to pick up cookies (e.g. country), then go to search. Default true. */
  visitHomepageFirst?: boolean;
}

/** PrestaShop product URLs: /path/id-product-name.html or ...html#/variant */
const PRODUCT_LINK_PATTERN = /\/\d+-[^/]+\.html(#|$)/i;

/** Dismiss cookie consent popup if present (click "ACCEPT ALL" or "DECLINE ALL"). */
async function dismissCookiePopup(page: Page): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 500));
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
      for (const el of buttons) {
        const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
        if (/accept\s*all|accept\s*all\s*cookies/i.test(text)) {
          (el as HTMLElement).click();
          return true;
        }
        if (/decline\s*all|reject\s*all/i.test(text)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      const closeBtn = document.querySelector('[aria-label="Close"], .close, [title="Close"]');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        return true;
      }
      return false;
    });
    if (clicked) await new Promise((r) => setTimeout(r, 300));
  } catch {
    // Ignore; popup may not be present
  }
}

/**
 * Step 2: On the search results page, get product links (hrefs). Prefer the main
 * results container so we don't pick up sidebar/footer links. Elina/PrestaShop
 * uses .products > .product_list for the actual search results.
 */
function getAllProductLinksFromPage(page: Page): Promise<string[]> {
  return page.evaluate((pattern: string) => {
    const re = new RegExp(pattern);
    const seen = new Set<string>();
    function collectFrom(root: Element): string[] {
      const out: string[] = [];
      const links = root.querySelectorAll<HTMLAnchorElement>('a[href*=".html"]');
      for (const a of links) {
        const href = a.getAttribute('href');
        if (href && re.test(href) && !seen.has(href)) {
          seen.add(href);
          out.push(href);
        }
      }
      return out;
    }
    const productsContainer = document.querySelector('.products, .product_list');
    if (productsContainer) {
      const fromProducts = collectFrom(productsContainer);
      if (fromProducts.length > 0) return fromProducts;
    }
    const bodyText = document.body?.innerText || '';
    if (/\bof\s+1\s+item\s*\(s\)/i.test(bodyText)) {
      let best: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let el: Element | null = walker.nextNode() as Element | null;
      while (el) {
        const elem = el as HTMLElement;
        const text = elem.innerText || elem.textContent || '';
        if (text && /\bof\s+1\s+item\s*\(s\)/i.test(text)) {
          const links = collectFrom(elem);
          if (links.length > 0 && (best.length === 0 || links.length < best.length)) best = links;
        }
        el = walker.nextNode() as Element | null;
      }
      if (best.length > 0) return best;
    }
    const container = document.getElementById('js-product-list');
    const fromContainer = container ? collectFrom(container) : [];
    if (fromContainer.length > 0) return fromContainer;
    return collectFrom(document.body);
  }, PRODUCT_LINK_PATTERN.source);
}

/** Resolve href to full URL using the page origin (e.g. https://www.elinapilates.com). */
function toAbsoluteUrl(href: string, baseOrigin: string): string {
  const s = href.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const base = baseOrigin.replace(/\/$/, '');
  return s.startsWith('/') ? `${base}${s}` : `${base}/${s}`;
}

/**
 * On a product page, check if the page shows the given article_ref (SKU).
 * PrestaShop may use [itemprop="sku"], #product_reference, or reference in body.
 */
function productPageMatchesArticleRef(page: Page, articleRef: string): Promise<boolean> {
  return page.evaluate((ref: string) => {
    const needle = ref.trim();
    if (!needle) return false;
    // PrestaShop: itemprop="sku" or #product_reference
    const skuEl = document.querySelector('[itemprop="sku"]') || document.getElementById('product_reference');
    if (skuEl) {
      const text = (skuEl.textContent || '').trim();
      if (text === needle || text.includes(needle)) return true;
    }
    // Fallback: reference block or data attribute (e.g. data-product-reference)
    const refBlock = document.querySelector('.product-reference, [data-product-reference]');
    if (refBlock) {
      const text = (refBlock.textContent || refBlock.getAttribute('data-product-reference') || '').trim();
      if (text === needle || text.includes(needle)) return true;
    }
    return false;
  }, articleRef);
}

/**
 * Step 1+2+3: Launch browser, open search page, collect all product links (full URLs),
 * then open each product page and return the first whose SKU/reference matches article_ref.
 * Returns full https product URL or null.
 */
export async function openSearchPage(
  vendorBaseUrl: string,
  articleRef: string,
  options: SearchVendorPuppeteerOptions = {},
): Promise<{
  title: string;
  url: string;
  productHref: string | null;
  allProductHrefs: string[];
}> {
  const base = vendorBaseUrl.replace(/\/$/, '');
  const searchPath = options.searchPath ?? '/eu/en/search';
  const waitAfterLoadMs = options.waitAfterLoadMs ?? 8000;
  const waitForSearchResultsMs = options.waitForSearchResultsMs ?? 12000;
  const waitAfterProductMs = options.waitAfterProductLoadMs ?? 2000;
  const visitHomepageFirst = options.visitHomepageFirst !== false;
  const searchUrl = `${base}${searchPath}?s=${encodeURIComponent(articleRef)}`;
  const homepageUrl = `${base}${searchPath.replace(/\/search$/, '')}`;

  const browser = await puppeteer.launch({
    headless: !options.headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    if (visitHomepageFirst) {
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Wait for network to settle so AJAX search results can load (PrestaShop may run search client-side)
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });
    await dismissCookiePopup(page);
    await new Promise((r) => setTimeout(r, waitAfterLoadMs));

    // Wait for the "real" search results: page shows "of 1 item(s)" so we don't scrape the
    // initial placeholder list (e.g. 13 unrelated products). If search returns 1 result we're good.
    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body?.innerText || '';
          return /\bof\s+1\s+item\s*\(s\)/i.test(bodyText);
        },
        { timeout: waitForSearchResultsMs },
      );
    } catch {
      // Proceed anyway; we may get placeholder results and will match by SKU on product pages
    }

    const title = await page.title();
    const url = page.url();
    const origin = new URL(url).origin;
    const rawLinks = await getAllProductLinksFromPage(page);
    const allProductHrefs = rawLinks.map((href) => toAbsoluteUrl(href, origin));

    let productHref: string | null = null;
    for (const productUrl of allProductHrefs) {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, waitAfterProductMs));
      const matches = await productPageMatchesArticleRef(page, articleRef);
      if (matches) {
        productHref = productUrl;
        break;
      }
    }

    return { title, url, productHref, allProductHrefs };
  } finally {
    await browser.close();
  }
}
