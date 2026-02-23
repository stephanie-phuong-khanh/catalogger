/**
 * Go through the raw image directory and match the image folder by name to the SKU in the
 * listings directory (or another source of truth).
 *
 * Step 1: List directory tree under RAW_IMAGE_DIR.
 *
 * Usage: npm run process-images
 * Requires: RAW_IMAGE_DIR in .env.local
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const RAW_IMAGE_DIR = process.env.RAW_IMAGE_DIR;

function printTree(dir: string, prefix: string = ''): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    // directories first, then by name
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (let i = 0; i < sorted.length; i++) {
    const ent = sorted[i];
    const isLast = i === sorted.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const name = ent.isDirectory() ? `${ent.name}/` : ent.name;
    console.log(prefix + branch + name);
    if (ent.isDirectory()) {
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(path.join(dir, ent.name), nextPrefix);
    }
  }
}

function main() {
  if (!RAW_IMAGE_DIR) {
    console.error('Missing RAW_IMAGE_DIR in .env or .env.local');
    process.exit(1);
  }
  if (!fs.existsSync(RAW_IMAGE_DIR)) {
    console.error('RAW_IMAGE_DIR does not exist:', RAW_IMAGE_DIR);
    process.exit(1);
  }
  console.log('RAW_IMAGE_DIR:', RAW_IMAGE_DIR);
  console.log('');
  console.log(path.basename(RAW_IMAGE_DIR) || RAW_IMAGE_DIR);

  // Only print the tree if the user passes the --print-tree flag
  if (process.argv.includes('--print-tree')) {
    printTree(RAW_IMAGE_DIR);
  }
}

main();
