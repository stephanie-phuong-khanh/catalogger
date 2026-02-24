/**
 * Subject segmentation via rembg subprocess.
 *
 * Recommended: Docker (no local Python). Set REMBG_USE_DOCKER=1 in .env.local and run:
 *   docker pull danielgatis/rembg
 * This script will run rembg via `docker run` with a mounted temp dir.
 *
 * Fallback: local Python (pip install "rembg[cpu,cli]"). Set REMBG_PYTHON=./venv/bin/python if needed.
 *
 * Output: mask as Float32Array (0–1 per pixel), same dimensions as input image.
 * Callers use this to get outline coordinates (contours) and to propose crops.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import sharp from 'sharp';

export interface RembgMaskResult {
  data: Float32Array;
  width: number;
  height: number;
}

const REMBG_ARGS = ['i', '-om'] as const;

function runRembgCommand(
  command: string,
  args: string[],
): Promise<{ ok: boolean; stderr: string; spawnFailed?: boolean }> {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ ok: code === 0, stderr }));
    child.on('error', (err) =>
      resolve({ ok: false, stderr: err?.message ?? String(err), spawnFailed: true }),
    );
  });
}

/**
 * Run rembg to get a subject mask; returns mask as float 0–1 (subject = 1, background = 0).
 * Uses "rembg i -om input.png mask.png" so output is mask-only. Reads mask PNG and normalizes to 0–1.
 *
 * Command resolution: if REMBG_USE_DOCKER=1, run rembg via Docker; otherwise try REMBG_PYTHON, then rembg / python3 -m rembg / python -m rembg.
 *
 * If the overlay highlights the background instead of the subject, set REMBG_INVERT_MASK=1.
 */
export async function runRembgSegmentation(imageBuffer: Buffer): Promise<RembgMaskResult | null> {
  let tempDir: string | null = null;

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembg-'));
    const inputPath = path.join(tempDir, 'input.png');
    const maskPath = path.join(tempDir, 'mask.png');

    await sharp(imageBuffer).ensureAlpha().png().toFile(inputPath);

    const args = [...REMBG_ARGS, inputPath, maskPath];
    let result: { ok: boolean; stderr: string; spawnFailed?: boolean };

    const useDocker =
      /^(1|true|yes)$/i.test(String(process.env.REMBG_USE_DOCKER ?? '').trim());

    if (useDocker) {
      const absTemp = path.resolve(tempDir);
      result = await runRembgCommand('docker', [
        'run',
        '--rm',
        '-v',
        `${absTemp}:/data`,
        'danielgatis/rembg',
        'i',
        '-om',
        '/data/input.png',
        '/data/mask.png',
      ]);
    } else {
      const rembgPythonRaw = process.env.REMBG_PYTHON?.trim();
      const rembgPython =
        rembgPythonRaw && !path.isAbsolute(rembgPythonRaw)
          ? path.resolve(process.cwd(), rembgPythonRaw)
          : rembgPythonRaw;
      if (rembgPython) {
        const rembgBin = path.join(path.dirname(rembgPython), 'rembg');
        result = await runRembgCommand(rembgBin, args);
        if (!result.ok && result.spawnFailed) {
          result = await runRembgCommand(rembgPython, ['-m', 'rembg', ...args]);
        }
      } else {
        result = await runRembgCommand('rembg', args);
        if (!result.ok && (result.spawnFailed || result.stderr.includes('ENOENT'))) {
          result = await runRembgCommand('python3', ['-m', 'rembg', ...args]);
        }
        if (!result.ok && (result.spawnFailed || result.stderr.includes('ENOENT'))) {
          result = await runRembgCommand('python', ['-m', 'rembg', ...args]);
        }
      }
    }

    if (!result.ok || !fs.existsSync(maskPath)) {
      const err = result.stderr?.trim() ?? '';
      let hint = '';
      if (err.includes('No module named rembg') || err.includes('No module named \'rembg\'')) {
        hint = ' Set REMBG_USE_DOCKER=1 in .env.local and run: docker pull danielgatis/rembg (recommended).';
      } else if (useDocker && err.includes('Cannot connect to the Docker daemon')) {
        hint = ' Start Docker Desktop (required for REMBG_USE_DOCKER=1).';
      }
      console.warn(`rembg failed: ${err || 'no mask produced'}${hint}`);
      return null;
    }

    if (/^(1|true|yes)$/i.test(String(process.env.REMBG_DEBUG_SAVE_MASK ?? '').trim())) {
      const debugDir = path.join(process.cwd(), 'data', 'segmentation-tests');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      fs.copyFileSync(maskPath, path.join(debugDir, 'rembg-raw-mask.png'));
      console.warn('rembg: saved raw mask to data/segmentation-tests/rembg-raw-mask.png');
    }

    // Read mask as-is (no ensureAlpha): rembg -om often writes grayscale; adding alpha can give wrong channel
    const { data: raw, info } = await sharp(maskPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const len = width * height;
    const invert =
      /^(1|true|yes)$/i.test(String(process.env.REMBG_INVERT_MASK ?? '').trim());
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const idx = i * channels;
      const a =
        channels === 1
          ? raw[idx]!
          : channels >= 4
            ? raw[idx + 3]!
            : raw[idx + 1]!; // 2-channel: use second (alpha)
      const v = a / 255;
      data[i] = invert ? 1 - v : v;
    }

    return { data, width, height };
  } catch (err) {
    console.warn('rembg segmentation failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
  }
}
