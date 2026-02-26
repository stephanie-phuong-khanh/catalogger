/**
 * Parse a PDF pricing sheet via Llama Cloud (LlamaExtract) and write structured JSON.
 * Handles multi-page PDFs (e.g. Elina Pilates 3-page pricing sheet).
 * 
 * 1. Ensures an extraction agent exists: creates one with the pricing-sheet JSON schema if needed (or reuses an existing agent by name).
 * 2. Uploads your PDF to Llama Cloud Files API.
 * 3. Starts an extraction job (document + agent).
 * 4. Polls until the job finishes.
 * 5. Writes the extraction result to the output directory.
 *
 * Prereq: LLAMA_CLOUD_API_KEY in .env
 *
 * Usage:
 *   npm run parse-pdf-pricing-sheet -- --input-file="data/elina_pilates_pricing_sheet.pdf"
 *   npm run parse-pdf-pricing-sheet -- --input-file="data/foo.pdf" --out-dir="data/parsed-pricing-sheets"
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });

const CONFIG = {
  inputFile: 'data/input/elina_pilates_pricing_sheet.pdf',
  outDir: 'data/parsed-pricing-sheets',
};

const LLAMA_CLOUD_BASE = 'https://api.cloud.llamaindex.ai';
const EXTRACTION_AGENT_NAME = 'catalogger_pricing_sheet';


// const PRICING_SHEET_EXTRACTION_SCHEMA = {
//   type: 'object',
//   description: 'Pricing sheet with a list of products',
//   properties: {
//     products: {
//       type: 'array',
//       description: 'List of products from the pricing sheet',
//       items: {
//         type: 'object',
//         properties: {
//           description: {
//             type: 'string',
//             description: 'The product name, without the color of the product. In the document, this is spelled in all caps with spaces or underscores between words. In the extraction output, it should be spelled normally with only spaces between words.',
//             example: 'Elite Reformer Tower',
//           },
//           variants: {
//             type: 'array',
//             description: 'The variants of the product. Each variant is a different color of the product.',
//             items: {
//               type: 'object',
//               properties: {
//                 article_ref: {
//                   type: 'string',
//                   description: 'The article reference number of the product variant. It is a combination of the country code and the 6-digit article number. Do not include the country code in the extraction output.',
//                   example: '400004',
//                 },
//                 color: {
//                   type: 'string',
//                   description: 'The color of the product variant. In the document, the color is included in the product name. In the extraction output, it should be spelled in all caps. Do not include the color in the description.',
//                   example: 'BLACK',
//                 },
//                 price_usd: {
//                   type: 'number',
//                   description: 'The price of the item as a numeric value. Note: The document uses European format where \'.\' is the thousand separator and \',\' is the decimal. Strip the currency symbol and normalize to a standard float (e.g., \'$3.995,00\' should become 3995.0).',
//                   example: 2725.00,
//                 },
//                 barcode: {
//                   type: 'string',
//                   description: 'The barcode of the product variant. It is a 13-digit number that is unique to the product variant.',
//                   example: '8421941006647',
//                 }
//               },
//               required: ['article_ref', 'color', 'price_usd', 'barcode'],
//             },
//           },
//         },
//         required: ['description', 'variants'],
//       },
//     },
//   },
//   required: ['products'],
// } as const;

const PRICING_SHEET_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'A flat list of every individual row/item in the pricing table.',
        items: {
          type: 'object',
          properties: {
            product_base_name: {
              type: 'string',
              description: 'The product name, without the color of the product. Listed as part of the content of the "Description" column of the input table. In the document, this is spelled in all caps with spaces or underscores between words. Products of the same name but different colors are listed in consecutive rows. In the extraction output, it should be spelled normally with only spaces between words. DO NOT include the color in the product_base_name.',
              example: 'Elite Reformer Tower',
            },
            color: {
              type: 'string',
              description: 'The color of the product variant. Listed as part of the content of the "Description" column of the input table. In the extraction output, it should be spelled in all caps. Do not include the color in the product_base_name.',
              example: 'BLACK',
            },
            article_number: {
              type: 'string',
              description: 'The article reference number of the product variant. Listed in the "Article Ref." column of the input table, as a combination of the country code and the 6-digit article number. Do not include the country code in the extraction output.',
              example: '400004',
              pattern: '^[0-9]{6}$',
            },
            price_usd: {
              type: 'number',
              description: 'Numeric price. Listed in the "Prices / MAP Prices$" column of the input table. The value is the price of the item in USD. Note: The document uses European format where \'.\' is the thousand separator and \',\' is the decimal. Strip the currency symbol and normalize to a standard float (e.g., \'$3.995,00\' should become 3995.0).',
              example: 2725.00,
            },
            barcode: {
              type: 'string',
              description: 'The 13-digit barcode of the product variant. Listed in the "Barcode" column of the input table.',
              example: '8421941006647',
              pattern: '^[0-9]{13}$',
            }
          },
          required: ['product_base_name', 'color', 'article_number', 'price_usd', 'barcode'],
        }
    },
  },
  required: ['items']
} as const;


type ApiResponse = { id?: string; [k: string]: unknown };

function getApiKey(): string {
  const key = process.env.LLAMA_CLOUD_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'LLAMA_CLOUD_API_KEY is not set. Add it to .env or .env.local.'
    );
  }
  return key;
}

async function llamaCloudFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${LLAMA_CLOUD_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers as Record<string, string>),
    },
  });
  return res;
}

/** Create extraction agent or get existing by name. Returns agent id. */
async function getOrCreateExtractionAgent(apiKey: string): Promise<string> {
  const byNameRes = await llamaCloudFetch(
    apiKey,
    `/api/v1/extraction/extraction-agents/by-name/${encodeURIComponent(EXTRACTION_AGENT_NAME)}`,
    { method: 'GET' }
  );
  if (byNameRes.ok) {
    const data = (await byNameRes.json()) as ApiResponse;
    if (data.id) {
      console.log(`Using existing extraction agent: ${EXTRACTION_AGENT_NAME} (${data.id})`);
      return data.id as string;
    }
  }

  const createRes = await llamaCloudFetch(apiKey, '/api/v1/extraction/extraction-agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: EXTRACTION_AGENT_NAME,
      data_schema: PRICING_SHEET_EXTRACTION_SCHEMA,
      config: {
        extraction_target: 'PER_TABLE_ROW',
        extraction_mode: 'BALANCED',
      },
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create extraction agent: ${createRes.status} ${text}`);
  }
  const data = (await createRes.json()) as ApiResponse;
  const id = data.id as string;
  console.log(`Created extraction agent: ${EXTRACTION_AGENT_NAME} (${id})`);
  return id;
}

/** Upload PDF to Llama Cloud Files. Returns file id. */
async function uploadFile(apiKey: string, filePath: string): Promise<string> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const buffer = fs.readFileSync(absolutePath);
  const name = path.basename(filePath);
  const form = new FormData();
  form.append('upload_file', new Blob([buffer], { type: 'application/pdf' }), name);

  const res = await fetch(`${LLAMA_CLOUD_BASE}/api/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload file: ${res.status} ${text}`);
  }
  const data = (await res.json()) as ApiResponse;
  const fileId = data.id as string;
  console.log(`Uploaded file: ${name} (${fileId})`);
  return fileId;
}

/** Start extraction job. Returns job id. */
async function runExtractionJob(
  apiKey: string,
  extractionAgentId: string,
  fileId: string
): Promise<string> {
  const res = await llamaCloudFetch(apiKey, '/api/v1/extraction/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extraction_agent_id: extractionAgentId,
      file_id: fileId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start extraction job: ${res.status} ${text}`);
  }
  const data = (await res.json()) as ApiResponse;
  const jobId = data.id as string;
  console.log(`Started extraction job: ${jobId}`);
  return jobId;
}

type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/** Poll job until SUCCESS or FAILED. Returns final status. */
async function pollJobUntilDone(
  apiKey: string,
  jobId: string,
  pollIntervalMs: number = 2000
): Promise<JobStatus> {
  for (;;) {
    const res = await llamaCloudFetch(apiKey, `/api/v1/extraction/jobs/${jobId}`, {
      method: 'GET',
    });
    if (!res.ok) {
      throw new Error(`Failed to get job status: ${res.status}`);
    }
    const data = (await res.json()) as { status?: JobStatus; [k: string]: unknown };
    const status = data.status ?? 'PENDING';
    console.log(`  Job status: ${status}`);
    if (status === 'SUCCESS' || status === 'FAILED') return status;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/** Get extraction result (valid when job status is SUCCESS). */
async function getJobResult(apiKey: string, jobId: string): Promise<unknown> {
  const res = await llamaCloudFetch(apiKey, `/api/v1/extraction/jobs/${jobId}/result`, {
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get job result: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data;
}

async function main(): Promise<void> {
  const inputFileArg = process.argv.find((arg) => arg.startsWith('--input-file'));
  if (inputFileArg) {
    CONFIG.inputFile = inputFileArg.includes('=') ? inputFileArg.split('=')[1]! : process.argv[process.argv.indexOf('--input-file') + 1] ?? CONFIG.inputFile;
  }
  const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir'));
  if (outDirArg) {
    CONFIG.outDir = outDirArg.includes('=') ? outDirArg.split('=')[1]! : process.argv[process.argv.indexOf('--out-dir') + 1] ?? CONFIG.outDir;
  }

  if (!CONFIG.inputFile.endsWith('.pdf')) {
    throw new Error('Input file must be a PDF');
  }

  const apiKey = getApiKey();
  const inputPath = path.isAbsolute(CONFIG.inputFile) ? CONFIG.inputFile : path.join(process.cwd(), CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const agentId = await getOrCreateExtractionAgent(apiKey); // 1 - Ensures an extraction agent exists
  const fileId = await uploadFile(apiKey, inputPath); // 2 - Uploads PDF to Llama Cloud Files API
  const jobId = await runExtractionJob(apiKey, agentId, fileId); // 3 - Starts an extraction job (document + agent)
  const status = await pollJobUntilDone(apiKey, jobId); // 4 - Polls until the job finishes
  if (status !== 'SUCCESS') {
    throw new Error(`Extraction job failed with status: ${status}`);
  }

  const result = (await getJobResult(apiKey, jobId)) as Record<string, unknown>;
  const raw = result?.result ?? result?.extraction ?? result;
  const parsedData = raw ?? { products: [] };
  const products = Array.isArray((parsedData as any).products) ? (parsedData as any).products : Array.isArray(parsedData) ? parsedData : [];
  const count = Array.isArray(products) ? products.length : 0;

  const outPath = path.join(CONFIG.outDir, `${path.basename(CONFIG.inputFile, '.pdf')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsedData, null, 2));
  console.log(`Wrote ${count} product(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
