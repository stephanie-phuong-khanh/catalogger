## Setup

**Install dependencies**
   ```bash
   npm install
   ```

**Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). You should see the form (Excel upload, vendor website, and two placeholders).

**Run the pipeline separately (unchanged)**
   ```bash
   npm run pipeline
   ```
   This still runs from the command line and writes to `data/listings/`. The app does not run the pipeline yet.

**Sync listings to Vercel Blob** (optional, for the web listings viewer)
   ```bash
   npm run sync-listings-to-blob                                                              # upload all (overwrites existing)
   npm run sync-listings-to-blob -- --full                                                    # full sync: wipe listings/ in Blob, then upload
   npm run sync-listings-to-blob -- --single tab_09_gdina_traditional/GDI-8005-01.json       # upload one file only
   ```
   Uploads files under `data/listings/` to your Vercel Blob store (skips files whose name starts with `_`, e.g. `_all_listings.json`). Default run overwrites existing blobs with the same path. **`--full`** wipes all blobs under `listings/` then uploads (use after renames/deletes). **`--single <path>`** uploads only one file; path is relative to `data/listings/`. Requires `CATALOGGER_LISTINGS_READ_WRITE_TOKEN` in `.env` or `.env.local` (from the private listings Blob store in Vercel).

**Subject segmentation (rembg)** – for outline/crop pipeline
   1. Make sure Docker desktop is installed. Pull the image: `docker pull danielgatis/rembg`
   2. Run: `npm run test-segmentation -- --image-path "path/to/image.png"` to test. Outputs go to `data/segmentation-tests/` by default.
