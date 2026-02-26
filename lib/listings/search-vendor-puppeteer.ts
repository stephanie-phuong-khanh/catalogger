import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

/** Options for PrestaShop search via Puppeteer (e.g. Elina Pilates). */
export interface SearchVendorPuppeteerOptions {
  searchPath?: string;
  /** Ms to wait after search page load (Cloudflare + JS). Default 8000. */
  waitAfterLoadMs?: number;
  /** Ms to wait after each product page load. Default 2000. */
  waitAfterProductLoadMs?: number;
  /** Ms to wait after clicking a variant (e.g. color) before re-checking SKU. Default 800. */
  waitAfterVariantClickMs?: number;
  /** Visible browser. Default false. */
  headed?: boolean;
  /** Visit homepage first to pick up cookies. Default true. */
  visitHomepageFirst?: boolean;
  /** Called after each product group is resolved (for resolveVendorUrlsForGroups). Use to persist incrementally. */
  onGroupDone?: (groupUrls: Record<string, string>) => void;
}

/** PrestaShop product URLs: .../id-name.html or ...html#/variant */
const PRODUCT_LINK_PATTERN = /\/\d+-[^/]+\.html(#|$)/i;

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
    // Popup may not be present
  }
}

/**
 * Get product links from the search results page. Uses .products / .product_list
 * (Elina/PrestaShop main results). Fallback: whole page (we still verify by SKU on product page).
 */
function getProductLinksFromSearchPage(page: Page): Promise<string[]> {
  return page.evaluate((pattern: string) => {
    const re = new RegExp(pattern);
    const seen = new Set<string>();
    function collect(root: Element): string[] {
      const out: string[] = [];
      root.querySelectorAll<HTMLAnchorElement>('a[href*=".html"]').forEach((a) => {
        const href = a.getAttribute('href');
        if (href && re.test(href) && !seen.has(href)) {
          seen.add(href);
          out.push(href);
        }
      });
      return out;
    }
    const main = document.querySelector('.products, .product_list');
    const fromMain = main ? collect(main) : [];
    if (fromMain.length > 0) return fromMain;
    return collect(document.body);
  }, PRODUCT_LINK_PATTERN.source);
}

function toAbsoluteUrl(href: string, origin: string): string {
  const s = href.trim();
  if (s.startsWith('http')) return s;
  const base = origin.replace(/\/$/, '');
  return s.startsWith('/') ? `${base}${s}` : `${base}/${s}`;
}

/** On a product page, read the currently displayed reference/SKU. Returns null if not found. */
function getCurrentProductReference(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const skuEl = document.querySelector('[itemprop="sku"]') || document.getElementById('product_reference');
    if (skuEl) {
      const text = (skuEl.textContent || '').trim();
      if (text) return text;
    }
    const refBlock = document.querySelector('.product-reference, [data-product-reference]');
    if (refBlock) {
      const text = (refBlock.textContent || refBlock.getAttribute('data-product-reference') || '').trim();
      if (text) return text;
    }
    return null;
  });
}

/** On a product page, return true if the displayed reference/SKU matches articleRef. */
function productPageMatchesArticleRef(page: Page, articleRef: string): Promise<boolean> {
  return page.evaluate((ref: string) => {
    const needle = ref.trim();
    if (!needle) return false;
    const skuEl = document.querySelector('[itemprop="sku"]') || document.getElementById('product_reference');
    if (skuEl) {
      const text = (skuEl.textContent || '').trim();
      if (text === needle || text.includes(needle)) return true;
    }
    const refBlock = document.querySelector('.product-reference, [data-product-reference]');
    if (refBlock) {
      const text = (refBlock.textContent || refBlock.getAttribute('data-product-reference') || '').trim();
      if (text === needle || text.includes(needle)) return true;
    }
    return false;
  }, articleRef);
}

/**
 * On a product page with variants (e.g. colors), if current variant doesn't match articleRef,
 * click other variant options (e.g. .input-color radios) and re-check. Returns the page URL
 * that shows the matching SKU, or null.
 */
async function findVariantMatchingRef(
  page: Page,
  articleRef: string,
  waitAfterClickMs: number = 800,
): Promise<string | null> {
  if (await productPageMatchesArticleRef(page, articleRef)) return page.url();
  const variantCount = await page.evaluate(() => {
    const radios = document.querySelectorAll<HTMLInputElement>(
      '.product-variants input.input-color, .variants-product input[type="radio"][name^="group"]',
    );
    return radios.length;
  });
  if (variantCount === 0) return null;
  for (let i = 0; i < variantCount; i++) {
    const clicked = await page.evaluate((index: number) => {
      const radios = document.querySelectorAll<HTMLInputElement>(
        '.product-variants input.input-color, .variants-product input[type="radio"][name^="group"]',
      );
      const el = radios[index];
      if (!el || el.checked) return false;
      (el as HTMLElement).click();
      return true;
    }, i);
    if (clicked) {
      await new Promise((r) => setTimeout(r, waitAfterClickMs));
      if (await productPageMatchesArticleRef(page, articleRef)) return page.url();
    }
  }
  return null;
}

const VARIANT_RADIO_SELECTOR =
  '.product-variants input.input-color, .variants-product input[type="radio"][name^="group"]';

/**
 * On a product page (single or multi-variant), collect URL for each article_ref in the set
 * by reading the current SKU and clicking through variant options. Only records refs that
 * appear on the page (site may have more colors than in our sheet – we ignore those).
 */
export async function collectVariantUrlsOnProductPage(
  page: Page,
  articleRefs: Set<string>,
  options: { waitAfterVariantClickMs?: number } = {},
): Promise<Record<string, string>> {
  const waitMs = options.waitAfterVariantClickMs ?? 800;
  const result: Record<string, string> = {};
  if (articleRefs.size === 0) return result;

  const recordCurrent = async (): Promise<void> => {
    const ref = await getCurrentProductReference(page);
    if (ref && articleRefs.has(ref)) result[ref] = page.url();
  };

  await recordCurrent();

  const variantCount = await page.evaluate((sel: string) => {
    return document.querySelectorAll<HTMLInputElement>(sel).length;
  }, VARIANT_RADIO_SELECTOR);

  for (let i = 0; i < variantCount; i++) {
    const clicked = await page.evaluate(
      (sel: string, index: number) => {
        const radios = document.querySelectorAll<HTMLInputElement>(sel);
        const el = radios[index];
        if (!el || el.checked) return false;
        (el as HTMLElement).click();
        return true;
      },
      VARIANT_RADIO_SELECTOR,
      i,
    );
    if (clicked) {
      await new Promise((r) => setTimeout(r, waitMs));
      await recordCurrent();
    }
  }
  return result;
}

/**
 * Search vendor site by article_ref (SKU): open search page, collect product links from
 * main results, open each product page and return the first whose reference matches.
 * Requires headed mode or visitHomepageFirst for Elina (session/cookies).
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
  const waitAfterProductMs = options.waitAfterProductLoadMs ?? 2000;
  const waitAfterVariantClickMs = options.waitAfterVariantClickMs ?? 800;
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

    if (options.visitHomepageFirst !== false) {
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, 2000));
    }

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });
    await dismissCookiePopup(page);
    await new Promise((r) => setTimeout(r, waitAfterLoadMs));

    const title = await page.title();
    const url = page.url();
    const origin = new URL(url).origin;
    const rawLinks = await getProductLinksFromSearchPage(page);
    const allProductHrefs = rawLinks.map((href) => toAbsoluteUrl(href, origin));

    let productHref: string | null = null;
    for (const productUrl of allProductHrefs) {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, waitAfterProductMs));
      const matchedUrl = await findVariantMatchingRef(page, articleRef, waitAfterVariantClickMs);
      if (matchedUrl) {
        productHref = matchedUrl;
        break;
      }
    }

    return { title, url, productHref, allProductHrefs };
  } finally {
    await browser.close();
  }
}

/**
 * Resolve vendor product URLs for many article_refs by grouping them (e.g. by product_name),
 * running one search per group with the first ref, then on the product page clicking through
 * variants and recording URL for each ref that appears. Only refs in the sheet are recorded;
 * extra colors on the site are ignored.
 *
 * @param vendorBaseUrl - e.g. https://www.elinapilates.com
 * @param groups - each group = list of article_refs for the same product (same page, different variants)
 * @param options - same as openSearchPage; waitAfterVariantClickMs used in collectVariantUrlsOnProductPage
 * @returns map article_ref → product URL (only for refs that were found on the site)
 */
export async function resolveVendorUrlsForGroups(
  vendorBaseUrl: string,
  groups: { articleRefs: string[] }[],
  options: SearchVendorPuppeteerOptions = {},
): Promise<Record<string, string>> {
  const base = vendorBaseUrl.replace(/\/$/, '');
  const searchPath = options.searchPath ?? '/eu/en/search';
  const waitAfterLoadMs = options.waitAfterLoadMs ?? 8000;
  const waitAfterProductMs = options.waitAfterProductLoadMs ?? 2000;
  const waitAfterVariantClickMs = options.waitAfterVariantClickMs ?? 800;
  const homepageUrl = base + searchPath.replace(/\/search$/, '');

  const browser = await puppeteer.launch({
    headless: !options.headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const total: Record<string, string> = {};

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    if (options.visitHomepageFirst !== false) {
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, 2000));
    }

    for (const group of groups) {
      const refs = group.articleRefs.filter((r) => r?.trim());
      if (refs.length === 0) continue;

      const firstRef = refs[0];
      const searchUrl = `${base}${searchPath}?s=${encodeURIComponent(firstRef)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, waitAfterLoadMs));

      const origin = new URL(page.url()).origin;
      const rawLinks = await getProductLinksFromSearchPage(page);
      const allProductHrefs = rawLinks.map((href) => toAbsoluteUrl(href, origin));
      if (allProductHrefs.length === 0) continue;

      const productUrl = allProductHrefs[0];
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, waitAfterProductMs));

      const groupUrls = await collectVariantUrlsOnProductPage(page, new Set(refs), {
        waitAfterVariantClickMs,
      });
      Object.assign(total, groupUrls);
      options.onGroupDone?.(groupUrls);
    }

    return total;
  } finally {
    await browser.close();
  }
}
