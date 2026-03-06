## Setup

**Install dependencies**
   ```bash
   npm install
   ```

**Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Scripts to run

See **Vendor pipelines** below for the main Elina and Golden Designs flows.

**Other**
- **`sync-listings-to-blob`** — Upload `listings/` to Vercel Blob (for the web viewer). `--full` wipes and re-uploads; `--single <path>` uploads one file. Requires `CATALOGGER_LISTINGS_READ_WRITE_TOKEN`.
- **`parse-sheet`** — Parse Golden Designs XLSX to JSON only (no vendor search). Config in `scripts/listings/parse-sheet.ts`.
- **`process-images-for-sku`** — Prepare 1500×1500 images for a SKU folder: `--input-dir`, `--output-dir`.
- **`edit-image`** — Run edit (resize/crop) on a single image: `--image-path`, `--out-dir`.

**Image processing** — For subject segmentation (e.g. crop-with-segmentation, or edit-image on non-square images), you need Docker and the rembg image:
   ```bash
   docker pull danielgatis/rembg
   ```
   Keep Docker Desktop running when using those scripts.

All scripts: see `package.json` (e.g. `eval-specs`, `rename-sku-images`, `test-segmentation`, `crop-with-segmentation`).

---

## Vendor pipelines

**Elina Pilates** (run in order; each step writes a file the next step reads):
1. `parse-pdf-pricing-sheet` → `data/elina/elina_pilates_pricing_sheet.json`
2. `resolve-elina-urls` → `data/elina/elina_pilates_products_urls.json`
3. `scrape-elina-site` → `data/elina/elina_pilates_products_site.json`
4. (Optional) `download-elina-product-images` (images from site URLs) or `map-elina-sku-to-images` (map SKUs to local folders) → images / `elina_sku_to_images.json`
5. `generate-listings-elina` → `listings/elina_pilates/*.json`

**Golden Designs** (single script; config in `scripts/listings/pipeline.ts`):
- `pipeline` = parse XLSX sheet → search vendor (Shopify) → generate listing. Writes to `listings/tab_03_dynamic_low_emf/` (or whatever `outputDir` + `sheetIndex` in CONFIG). Use `--single SKU` for one product.
- Optional: `process-images-for-sku` to prepare 1500×1500 images from a SKU folder.
