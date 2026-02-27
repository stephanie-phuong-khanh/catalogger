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
  /** Called after each product group is resolved. groupUrls has refs that were found; articleRefs is the full list for the group (missing refs should be written with url: null). */
  onGroupDone?: (groupUrls: Record<string, string>, articleRefs: string[]) => void;
  /** Called before starting Puppeteer work for each group (for resolveVendorUrlsForGroups). */
  onGroupStart?: (group: { articleRefs: string[] }, groupIndex: number) => void;
  /** Called when a variant (e.g. color) on the product page matches an article_ref we're looking for. */
  onVariantMatch?: (ref: string, url: string) => void;
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

/** On a product page, read the displayed reference/SKU (e.g. ".product-reference" > span "ELN 700005"). Returns raw text or null. */
function getCurrentProductReference(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const refBlock = document.querySelector('.product-reference');
    if (refBlock) {
      const span = refBlock.querySelector('span');
      const text = (span ? span.textContent : refBlock.textContent) || '';
      const raw = text.replace(/\s+/g, ' ').trim();
      if (raw) return raw;
    }
    const skuEl = document.querySelector('[itemprop="sku"]') || document.getElementById('product_reference');
    if (skuEl) {
      const text = (skuEl.textContent || '').trim();
      if (text) return text;
    }
    const dataBlock = document.querySelector('[data-product-reference]');
    if (dataBlock) {
      const text = (dataBlock.getAttribute('data-product-reference') || dataBlock.textContent || '').trim();
      if (text) return text;
    }
    return null;
  });
}

/** Which article_ref (if any) appears as a substring in the page's reference text. */
function findMatchingArticleRef(pageText: string | null, articleRefs: Set<string>): string | null {
  if (!pageText) return null;
  for (const ref of articleRefs) {
    if (pageText.includes(ref)) return ref;
  }
  return null;
}

/** On a product page, return true if the displayed reference contains articleRef as a substring (e.g. "ELN 700005" contains "700005"). */
function productPageMatchesArticleRef(page: Page, articleRef: string): Promise<boolean> {
  return getCurrentProductReference(page).then((raw) => raw !== null && raw.includes(articleRef.trim()));
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

/** Upholstered Color swatches: .product-variants > .product-variants-item > ul > li > input.input-color (PrestaShop/Elina). */
const VARIANT_RADIO_SELECTOR = '.product-variants input.input-color';

/**
 * On a product page (single or multi-variant), collect URL for each article_ref in the set
 * by reading the current SKU and clicking through variant options. Only records refs that
 * appear on the page (site may have more colors than in our sheet – we ignore those).
 */
export async function collectVariantUrlsOnProductPage(
  page: Page,
  articleRefs: Set<string>,
  options: { waitAfterVariantClickMs?: number; onVariantMatch?: (ref: string, url: string) => void } = {},
): Promise<Record<string, string>> {
  const waitMs = options.waitAfterVariantClickMs ?? 800;
  const result: Record<string, string> = {};
  if (articleRefs.size === 0) return result;

  const recordCurrent = async (): Promise<void> => {
    const pageText = await getCurrentProductReference(page);
    const matchedRef = findMatchingArticleRef(pageText, articleRefs);
    if (matchedRef) {
      const url = page.url();
      if (!result[matchedRef]) {
        result[matchedRef] = url;
        options.onVariantMatch?.(matchedRef, url);
      }
    }
  };

  await recordCurrent();

  const variantCount = await page.evaluate((sel: string) => {
    return document.querySelectorAll<HTMLInputElement>(sel).length;
  }, VARIANT_RADIO_SELECTOR);

  const needCount = articleRefs.size;
  for (let i = 0; i < variantCount; i++) {
    if (Object.keys(result).length >= needCount) {
      break; // found all refs we need, no need to click through the rest
    }
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
  console.log('[resolve] Browser started.');

  const total: Record<string, string> = {};
  const totalGroups = groups.length;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    if (options.visitHomepageFirst !== false) {
      console.log('[resolve] Loading homepage for session/cookies...');
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, 2000));
      console.log('[resolve] Homepage loaded.');
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const refs = group.articleRefs.filter((r) => r?.trim());
      if (refs.length === 0) continue;

      options.onGroupStart?.({ articleRefs: refs }, groupIndex);

      const firstRef = refs[0];
      const searchUrl = `${base}${searchPath}?s=${encodeURIComponent(firstRef)}`;
      console.log(`[resolve] Group ${groupIndex + 1}/${totalGroups}: Loading search page (s=${firstRef})...`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });
      await dismissCookiePopup(page);
      console.log(`[resolve] Waiting ${waitAfterLoadMs}ms for Cloudflare/JS...`);
      await new Promise((r) => setTimeout(r, waitAfterLoadMs));

      const origin = new URL(page.url()).origin;
      const rawLinks = await getProductLinksFromSearchPage(page);
      const allProductHrefs = rawLinks.map((href) => toAbsoluteUrl(href, origin));
      if (allProductHrefs.length === 0) {
        console.log(`[resolve] Group ${groupIndex + 1}/${totalGroups}: No product links on search page, skipping.`);
        continue;
      }

      const productUrl = allProductHrefs[0];
      console.log(`[resolve] Opening product page (${allProductHrefs.length} link(s) found)...`);
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, waitAfterProductMs));

      const variantCount = await page.evaluate((sel: string) => {
        return document.querySelectorAll<HTMLInputElement>(sel).length;
      }, VARIANT_RADIO_SELECTOR);
      console.log(`[resolve] Checking variants (${variantCount} color(s))...`);

      const groupUrls = await collectVariantUrlsOnProductPage(page, new Set(refs), {
        waitAfterVariantClickMs,
        onVariantMatch: options.onVariantMatch,
      });
      const found = Object.keys(groupUrls).length;
      const missing = refs.filter((r) => !groupUrls[r]);
      if (missing.length > 0) {
        console.log(
          `[resolve] Group ${groupIndex + 1}/${totalGroups}: Found ${found}/${refs.length} refs; missing: ${missing.join(', ')}`,
        );
      }
      Object.assign(total, groupUrls);
      options.onGroupDone?.(groupUrls, refs);
    }

    console.log('[resolve] All groups done.');
    return total;
  } finally {
    await browser.close();
  }
}
