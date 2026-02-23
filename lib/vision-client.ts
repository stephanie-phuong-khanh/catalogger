/**
 * Vision client abstraction so image-editing code can use OpenAI or Gemini
 * without depending on a specific provider. Entry points create the client
 * (from env) and pass it in.
 */

import type OpenAI from 'openai';

/** Normalized 0–1 crop region for "center the subject" style cropping. */
export interface CropSuggestion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Interface for vision operations used by image editing (crop suggestions, classification, etc.).
 * Implementations wrap OpenAI, Gemini, or a mock for tests.
 */
export interface ImageVisionClient {
  /**
   * Suggest a crop region for this image (e.g. to center the main product).
   * Returns null if not available or on error. Coordinates are normalized 0–1.
   */
  suggestCrop(imageBuffer: Buffer, mimeType?: string): Promise<CropSuggestion | null>;
}

/**
 * Stub adapter: no API calls, always returns null. Use when no key is set or for tests.
 */
export class NoOpVisionClient implements ImageVisionClient {
  async suggestCrop(): Promise<CropSuggestion | null> {
    return null;
  }
}

/**
 * OpenAI-backed vision client (e.g. gpt-4o). suggestCrop is a stub for now.
 */
export class OpenAIVisionClient implements ImageVisionClient {
  constructor(private openai: OpenAI) {}

  async suggestCrop(_imageBuffer: Buffer, _mimeType?: string): Promise<CropSuggestion | null> {
    // TODO: call openai.chat.completions or vision API with image, parse bbox from response.
    return null;
  }
}

/**
 * Gemini-backed vision client. suggestCrop is a stub for now.
 * Constructor receives the client from @google/genai (GoogleGenAI instance).
 */
export class GeminiVisionClient implements ImageVisionClient {
  constructor(private _client: unknown) {}

  async suggestCrop(_imageBuffer: Buffer, _mimeType?: string): Promise<CropSuggestion | null> {
    // TODO: send image via this._client.models.generateContent, parse bbox from response.
    return null;
  }
}

export type VisionProvider = 'openai' | 'gemini';

/**
 * Create a vision client from env. Prefers VISION_PROVIDER=openai|gemini; if unset,
 * uses OPENAI_API_KEY vs GOOGLE_API_KEY to choose. Returns NoOpVisionClient if no keys.
 */
export function createVisionClient(): ImageVisionClient {
  const provider = (process.env.VISION_PROVIDER ?? '').toLowerCase() as VisionProvider | '';
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GOOGLE_API_KEY?.trim());

  if (provider === 'openai' || (!provider && hasOpenAI)) {
    if (!hasOpenAI) {
      return new NoOpVisionClient();
    }
    const OpenAI = require('openai').default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return new OpenAIVisionClient(openai);
  }

  if (provider === 'gemini' || (!provider && hasGemini && !hasOpenAI)) {
    if (!hasGemini) {
      return new NoOpVisionClient();
    }
    const { GoogleGenAI } = require('@google/genai');
    const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    return new GeminiVisionClient(genai);
  }

  return new NoOpVisionClient();
}
