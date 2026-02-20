## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). You should see the form (Excel upload, vendor website, and two placeholders).

3. **Run the pipeline separately (unchanged)**
   ```bash
   npm run pipeline
   ```
   This still runs from the command line and writes to `data/listings/`. The app does not run the pipeline yet.

4. **Sync listings to Vercel Blob** (optional, for the web listings viewer)
   ```bash
   npm run sync-listings-to-blob           # upload only (no remote wipe)
   npm run sync-listings-to-blob -- --full # full sync: wipe listings/ in Blob, then upload (use after renames/deletes)
   ```
   Uploads files under `data/listings/` to your Vercel Blob store (skips files whose name starts with `_`, e.g. `_all_listings.json`). **`--full`** makes Blob exactly match local: deletes all existing blobs under `listings/`, then uploads current files. Use `--full` when you rename or delete folders so the old paths are removed. Requires `CATALOGGER_LISTINGS_READ_WRITE_TOKEN` in `.env` or `.env.local` (from the private listings Blob store in Vercel).
