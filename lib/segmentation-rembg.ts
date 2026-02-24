/**
 * Subject segmentation via rembg subprocess.
 *
 * Uses publicly available Docker container to run rembg.
 *   docker pull danielgatis/rembg
 * This script will run rembg via `docker run` with a mounted temp dir.
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
 * Command resolution: Run rembg via Docker.
 * 
 * @param imageBuffer The image buffer to segment.
 * @param invertMask If true, invert the mask (subject = 0, background = 1).
 */
export async function runRembgSegmentation(
  imageBuffer: Buffer,
  invertMask: boolean = false,
): Promise<RembgMaskResult | null> {
  let tempDir: string | null = null;

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rembg-'));
    const inputPath = path.join(tempDir, 'input.png');
    const maskPath = path.join(tempDir, 'mask.png');

    await sharp(imageBuffer).ensureAlpha().png().toFile(inputPath);

    const args = [...REMBG_ARGS, inputPath, maskPath];
    let result: { ok: boolean; stderr: string; spawnFailed?: boolean };

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

    if (!result.ok || !fs.existsSync(maskPath)) {
      const err = result.stderr?.trim() ?? '';
      console.warn(`rembg failed: ${err || 'no mask produced'}`);
      return null;
    }

    // Read mask as-is (no ensureAlpha): rembg -om often writes grayscale; adding alpha can give wrong channel
    const { data: raw, info } = await sharp(maskPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const len = width * height;
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
      data[i] = invertMask ? 1 - v : v;
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
