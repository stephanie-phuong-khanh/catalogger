/**
 * Extract product data from a loaded Elina Pilates product page (PrestaShop).
 * No tab clicking: all tab content is in the DOM on load.
 *
 * Selectors from data/elina-product-page-sample.html:
 * - Product name: h1.product-detail-name
 * - Reference: .product-reference span (first in main content)
 * - Text under images: #product-description-short or .description-short
 * - Tabs: .product-tabs .nav-tabs a[data-toggle="tab"] (href="#id") + #tab-content .tab-pane
 * - YouTube: iframe[src*="youtube.com/embed/"] inside any .tab-pane
 *
 * --- Variant/color/ref-specific in the sample (excluded from variant comparison) ---
 * - .product-reference span (main column + inside #product-details): SKU e.g. "ELN 300003" / "ELN 700155-0".
 * - #product-details tab: data-product JSON (reference, price, id_product_attribute, etc.); .product-reference again; "Specific References" section with ean13 (e.g. 8421941009648).
 * - #description tab: long copy can include "Reference: Ean13 - 8421941005466" (variant-specific).
 * - JSON-LD in <head>: "sku", "mpn", offers.url (with #/105-upholstered_color-grey), breadcrumb item URL.
 * - Color selector: .product-variants input.input-color (value/title per color); we don’t scrape for comparison.
 * - Images: cover and thumbs can differ per variant (different color).
 */

import type { Page } from 'puppeteer';

export interface ScrapedTab {
  id: string;
  title: string;
  content: string;
  videos: string[];
}

export interface ScrapedProductData {
  product_name: string | null;
  reference: string | null;
  text_under_images: string | null;
  tabs: ScrapedTab[];
  /** All YouTube embed URLs found in any tab (deduplicated). */
  videos: string[];
}

/**
 * Run in page context: extract product name, reference, text under images, and all tab content.
 * Returns serializable object (no DOM nodes).
 * Helper structuredContentFromElement is inlined so it is available when serialized for page.evaluate().
 */
function extractProductDataInPage(): ScrapedProductData {
  function structuredContentFromElement(root: Element): string {
    const lines: string[] = [];
    const getText = (el: Element) => (el as HTMLElement).innerText?.trim() || '';
    const process = (node: Node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'iframe') return;
      if (tag === 'h1') {
        lines.push('## ' + getText(el));
        lines.push('');
        return;
      }
      if (tag === 'h2') {
        lines.push('## ' + getText(el));
        lines.push('');
        return;
      }
      if (tag === 'h3') {
        lines.push('### ' + getText(el));
        lines.push('');
        return;
      }
      if (tag === 'h4' || tag === 'h5' || tag === 'h6') {
        lines.push('#### ' + getText(el));
        lines.push('');
        return;
      }
      if (tag === 'p') {
        const t = getText(el);
        if (t) {
          lines.push(t);
          lines.push('');
        }
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        el.querySelectorAll(':scope > li').forEach((li) => {
          const t = getText(li as Element);
          if (t) lines.push('- ' + t);
        });
        lines.push('');
        return;
      }
      if (tag === 'dl') {
        const dts = el.querySelectorAll(':scope > dt');
        const dds = el.querySelectorAll(':scope > dd');
        for (let i = 0; i < dts.length && i < dds.length; i++) {
          const label = getText(dts[i] as Element);
          const value = getText(dds[i] as Element).replace(/\s+/g, ' ').trim();
          if (label) lines.push('**' + label + '**: ' + value);
        }
        lines.push('');
        return;
      }
      el.childNodes.forEach(process);
    };
    process(root);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  const result: ScrapedProductData = {
    product_name: null,
    reference: null,
    text_under_images: null,
    tabs: [],
    videos: [],
  };

  const nameEl = document.querySelector('h1.product-detail-name, .h1.product-detail-name');
  if (nameEl) {
    result.product_name = (nameEl as HTMLElement).innerText?.trim() || null;
  }

  const refEl = document.querySelector('.product-reference span');
  if (refEl) {
    result.reference = (refEl as HTMLElement).innerText?.trim() || null;
  }

  const shortDesc =
    document.querySelector('#product-description-short') ||
    document.querySelector('.product-description-short') ||
    document.querySelector('.description-short');
  if (shortDesc) {
    result.text_under_images = structuredContentFromElement(shortDesc as Element);
  }

  const navTabs = document.querySelector('.product-tabs .nav-tabs');
  const tabLinks = navTabs?.querySelectorAll('a[data-toggle="tab"]') ?? [];

  const tabIds = new Set<string>();
  for (const a of tabLinks) {
    const href = (a as HTMLAnchorElement).getAttribute('href');
    const title = (a as HTMLElement).innerText?.trim() || '';
    if (href?.startsWith('#')) {
      const id = href.slice(1).trim();
      if (id && !tabIds.has(id)) {
        tabIds.add(id);
        const pane = document.getElementById(id);
        let content = '';
        const videoUrls: string[] = [];
        if (pane) {
          const iframes = pane.querySelectorAll('iframe[src*="youtube.com/embed/"]');
          iframes.forEach((iframe) => {
            const src = (iframe as HTMLIFrameElement).getAttribute('src');
            if (src) videoUrls.push(src);
          });
          content = structuredContentFromElement(pane);
        }
        result.tabs.push({ id, title, content, videos: videoUrls });
        result.videos.push(...videoUrls);
      }
    }
  }

  result.videos = [...new Set(result.videos)];

  return result;
}

/**
 * Scrape the currently loaded Elina product page. Call after page.goto(productUrl).
 */
export async function scrapeElinaProductPage(page: Page): Promise<ScrapedProductData> {
  return page.evaluate(extractProductDataInPage);
}

/**
 * Normalize for variant comparison: trim and collapse whitespace.
 * Excludes reference and tab body content so variant-specific data (SKU, EAN,
 * Product Details specs, review text) doesn't cause false mismatches.
 */
export function normalizeSharedContent(data: ScrapedProductData): string {
  const parts = [
    data.product_name ?? '',
    data.text_under_images ?? '',
    ...data.tabs.map((t) => `${t.id}|${t.title}|${t.videos.join(',')}`),
    (data.videos ?? []).join(','),
  ];
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}
