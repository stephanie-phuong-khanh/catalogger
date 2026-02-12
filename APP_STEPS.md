### 1. Connect form → pipeline (or API)

- Add `app/api/run-pipeline/route.ts` that:
  - Accepts the uploaded Excel (multipart) and website URL.
  - Saves the file somewhere (e.g. `data/uploads/`), then calls your existing `parseSheet`, `searchVendorSite`, `generateListing` from `lib/` (you’ll need to pass the sheet path and vendor URL from the request). Return the generated listings as JSON.

### 2. API route to read listings

- Add `app/api/listings/route.ts`.
- Use Node `fs` (or `fs/promises`) to read `data/listings/_all_listings.json` and return it. Next.js route handlers run on the server, so `fs` is allowed.
- From the client, `fetch('/api/listings')` and set state with the result.

### 3. “One-by-one” review flow

- After “Generate listings” (or “Load listings” if using Option B), redirect or show a new view.
- State: `listings: Listing[]`, `currentIndex: number`.
- UI: show one listing at a time. Left (or top): **inputs** — pricing sheet row (from `listing._raw`) and vendor body text (from `listing._vendorData.body`, stripped to plain text). Right (or below): **generated** — title, features, overview, specs in editable fields (e.g. text inputs / textareas).
- Buttons: “Previous”, “Next”, “Save” (update in-memory state). No persistence yet except “Save to file” = trigger a download of the current (or all) listing as JSON.

### 4. Save to file

- In the browser you can’t write to the user’s disk arbitrarily. So “save” = **download**.
- Implement “Export” / “Save to file”: build a JSON (or CSV) of the current listing (or all edited listings) and trigger a download with a blob URL, e.g. `const blob = new Blob([JSON.stringify(listing, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${listing.sku}.json`; a.click();`.

---

## File layout (current)

```
app/
  layout.tsx    # Root layout, metadata
  page.tsx       # Form (upload, website, placeholders)
  globals.css    # Basic styles
next.config.js
next-env.d.ts
```

When you add the review flow, you can either keep everything on one page (form → then show list + detail) or add a route like `app/review/page.tsx` and navigate there after submit.
