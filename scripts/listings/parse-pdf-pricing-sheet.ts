/**
 * Parse a PDF pricing sheet via Llama Cloud (LlamaExtract) and write structured JSON.
 * Handles multi-page PDFs (e.g. Elina Pilates 3-page pricing sheet).
 *
 * Prereq: LLAMA_CLOUD_API_KEY in .env (see docs/llamaparse-setup.md).
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
  inputFile: 'data/elina_pilates_pricing_sheet.pdf',
  outDir: 'data/parsed-pricing-sheets',
};

const LLAMA_CLOUD_BASE = 'https://api.cloud.llamaindex.ai';
const EXTRACTION_AGENT_NAME = 'catalogger_pricing_sheet';

/** JSON Schema for extraction: root object with a single "products" array. Customize to match your pricing sheet. */
const PRICING_SHEET_EXTRACTION_SCHEMA = {
  type: 'object',
  description: 'Pricing sheet with a list of products or services',
  properties: {
    products: {
      type: 'array',
      description: 'List of products or services from the pricing sheet',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Product or service name' },
          sku: { type: 'string', description: 'SKU or item number if present' },
          price: { type: 'string', description: 'Price as shown (e.g. "$99" or "99.00")' },
          description: { type: 'string', description: 'Short description if present' },
          features: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet points or feature list',
          },
          notes: { type: 'string', description: 'Any other notes or terms' },
        },
        additionalProperties: true,
      },
    },
  },
  required: ['products'],
} as const;

type ApiResponse = { id?: string; [k: string]: unknown };

function getApiKey(): string {
  const key = process.env.LLAMA_CLOUD_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'LLAMA_CLOUD_API_KEY is not set. Add it to .env (see docs/llamaparse-setup.md).'
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
        extraction_target: 'PER_DOC',
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

  const agentId = await getOrCreateExtractionAgent(apiKey);
  const fileId = await uploadFile(apiKey, inputPath);
  const jobId = await runExtractionJob(apiKey, agentId, fileId);
  const status = await pollJobUntilDone(apiKey, jobId);
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
