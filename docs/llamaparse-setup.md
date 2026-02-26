# LlamaParse / Llama Cloud API setup for PDF pricing sheets

This walkthrough gets you from zero to parsing a multi-page PDF pricing sheet and getting **structured JSON** that matches a schema you define. The same API key works for **LlamaParse** (turn PDFs into markdown/text/tables) and **LlamaExtract** (turn documents into schema-shaped JSON).

---

## 1. Get an API key

1. Go to **[LlamaCloud](https://cloud.llamaindex.ai/)** and sign in (Google, GitHub, etc.).
2. In the left sidebar, click **API Key**.
3. Click **Generate New Key**.
4. Name the key (e.g. `catalogger-local`) and click **Create new key**.
5. **Copy the key immediately** — you won’t see the full value again. It usually starts with `llx-`.

---

## 2. Store the key in your environment

**Do not commit the key.** Use a `.env` file (already gitignored in this repo) or your shell profile.

**Option A – project `.env` (recommended for local dev)**

In the project root:

```bash
# .env or .env.local
LLAMA_CLOUD_API_KEY=llx-your-key-here
```

The script loads this via `dotenv`, so no export is needed if you run with `npm run parse-pdf-pricing-sheet`.

**Option B – shell (current session only)**

```bash
export LLAMA_CLOUD_API_KEY=llx-your-key-here
```

---

## 3. How parsing vs extraction fits your use case

- **LlamaParse**  
  Upload a PDF → get back **markdown**, **text**, or **tables** (and optionally images).  
  Good for: “I need the content of this PDF in a readable form.”  
  *Structured JSON output from Parse is deprecated; use Extract for that.*

- **LlamaExtract**  
  Upload a document + define a **JSON schema** → get back **JSON that conforms to that schema**.  
  Good for: “I need this pricing sheet as a list of products with name, SKU, price, etc.”

For “read a 3‑page pricing sheet and output JSON defined by my structure,” **LlamaExtract** is the right tool. The script uses the **LlamaExtract** REST API with a **pricing-sheet schema** you can edit.

---

## 4. What the script does (end-to-end)

1. **Reads** `LLAMA_CLOUD_API_KEY` from the environment (via `dotenv`).
2. **Ensures an extraction agent** exists: creates one with the pricing-sheet JSON schema if needed (or reuses an existing agent by name).
3. **Uploads** your PDF to Llama Cloud Files API.
4. **Starts an extraction job** (document + agent).
5. **Polls** until the job finishes.
6. **Writes** the extraction result to  
   `data/parsed-pricing-sheets/<basename-of-pdf>.json`.

So: **one API key**, **one PDF input**, **one JSON output** file shaped by your schema.

---

## 5. Define your JSON structure (schema)

The script uses a **JSON Schema** to tell LlamaExtract what to extract. That schema is in code in `scripts/listings/parse-pdf-pricing-sheet.ts` (see `PRICING_SHEET_EXTRACTION_SCHEMA`).

Default idea:

- **Root:** an object with a single property, e.g. `products`, which is an **array of product objects**.
- **Each product:** fields like `name`, `sku`, `price`, `description`, `features` (array), plus any extra you add.

You can change that schema to match your exact structure (e.g. different field names, nested objects, or “one object per page”). The schema is passed to the Llama Cloud API when creating or updating the extraction agent.

---

## 6. Run the script

**Prereqs:** `.env` (or env) has `LLAMA_CLOUD_API_KEY` set.

```bash
# Default input/output (see CONFIG in script)
npm run parse-pdf-pricing-sheet

# Custom input (and optional output dir)
npm run parse-pdf-pricing-sheet -- --input-file="data/elina_pilates_pricing_sheet.pdf"
npm run parse-pdf-pricing-sheet -- --input-file="data/elina_pilates_pricing_sheet.pdf" --out-dir="data/parsed-pricing-sheets"
```

Output is written to:

`<out-dir>/<input-pdf-basename>.json`

e.g. `data/parsed-pricing-sheets/elina_pilates_pricing_sheet.json`.

---

## 7. Optional: LlamaParse-only (markdown) then your own LLM

If you only want **markdown/text** from the PDF and prefer to do **JSON extraction yourself** (e.g. with OpenAI or Gemini already in this repo):

1. Use the same **API key** and the **LlamaParse** upload + result APIs to get markdown per page.
2. Pass that markdown into your existing LLM pipeline with a **prompt + Zod (or JSON) schema** to produce the final JSON.

That way you don’t create an extraction agent; you only use LlamaParse. The current script is built around LlamaExtract so you get “PDF → your JSON” in one flow.

---

## 8. References

- [Llama Cloud API key](https://developers.llamaindex.ai/python/cloud/general/api_key)
- [LlamaParse getting started (TypeScript)](https://developers.llamaindex.ai/typescript/cloud/llamaparse/getting_started/)
- [LlamaExtract getting started](https://developers.llamaindex.ai/python/cloud/llamaextract/getting_started/)
- [LlamaExtract REST API](https://developers.llamaindex.ai/python/cloud/llamaextract/getting_started/api/) (create agent, upload file, run job, get result)
