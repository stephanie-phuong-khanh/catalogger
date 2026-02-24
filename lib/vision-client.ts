/**
 * Vision client abstraction so image-editing code can use OpenAI or Gemini
 * without depending on a specific provider. Entry points create the client
 * (from env) and pass it in.
 */

import type OpenAI from 'openai';
import { z } from 'zod';


/**
 * Image context for crop/editing decisions.
 * - contextual: lifestyle/contextual shot; background has meaningful context to preserve (e.g. room, scene).
 * - negligible_background: clear subject, background is simple and can be cropped freely (e.g. product on wood).
 * - cutout: product on completely blank/plain background (e.g. white).
 */
export const ClassifyImageContextSchema = z.object({
  kind: z.enum(['contextual', 'negligible_background', 'cutout']).describe('One of: contextual (lifestyle/meaningful background), negligible_background (simple background, safe to crop), cutout (blank/plain background).'),
  reason: z.string().default('').describe('Short explanation; empty string if not needed.'),
});
export type ClassifyImageContextResult = z.infer<typeof ClassifyImageContextSchema>;

/**
 * Interface for vision operations used by image editing (crop suggestions, classification, etc.).
 * Implementations wrap OpenAI, Gemini, or a mock for tests.
 */
export interface ImageVisionClient {
  /**
   * Classify image context: contextual (lifestyle), negligible_background, or cutout.
   */
  classifyImageContext(imageBuffer: Buffer, mimeType?: string): Promise<ClassifyImageContextResult>;
}

/** Prompt for image context classification. */
export const CLASSIFY_IMAGE_CONTEXT_PROMPT = `Classify this product image for crop/editing:

- **contextual**: Lifestyle or contextual shot. The background has meaningful context to preserve (e.g. room, furniture, window view, people, scene). Cropping would remove important context. Example: sauna in a bedroom with bed and city view.

- **negligible_background**: Clear subject with a simple, non-blank background that can be cropped freely (e.g. product on wood, textured but uniform backdrop). The background does not add important context. Example: product on wooden planks.

- **cutout**: Product on a completely blank or plain background (e.g. pure white, solid color). Isolated product shot. Example: product on white seamless.

Reply with the single best-matching category and an optional short reason.`;

/**
 * Stub adapter: no API calls. classifyImageContext returns negligible_background.
 */
export class NoOpVisionClient implements ImageVisionClient {
  async classifyImageContext(): Promise<ClassifyImageContextResult> {
    return { kind: 'negligible_background', reason: 'No-op client' };
  }
}

/**
 * OpenAI-backed vision client using Responses API (gpt-4o) with Zod for structured output.
 */
export class OpenAIVisionClient implements ImageVisionClient {
  constructor(private openai: OpenAI) {}

  async classifyImageContext(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
  ): Promise<ClassifyImageContextResult> {
    const { zodTextFormat } = require('openai/helpers/zod');
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    const input = [
      {
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text: CLASSIFY_IMAGE_CONTEXT_PROMPT },
          { type: 'input_image' as const, image_url: dataUrl, detail: 'low' as const },
        ],
      },
    ];
    const response = await this.openai.responses.parse({
      model: 'gpt-4o',
      temperature: 0,
      input,
      text: { format: zodTextFormat(ClassifyImageContextSchema, 'classify_context') },
    });
    const parsed = response.output_parsed as ClassifyImageContextResult | null;
    if (parsed) return parsed;
    return { kind: 'negligible_background', reason: 'No structured response from model.' };
  }
}

/**
 * Gemini-backed vision client.
 * Constructor receives the client from @google/genai (GoogleGenAI instance).
 */
export class GeminiVisionClient implements ImageVisionClient {
  constructor(private _client: unknown) {}

  async classifyImageContext(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
  ): Promise<ClassifyImageContextResult> {
    const client = this._client as { models: { generateContent: (params: {
      model: string;
      contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      config?: { responseMimeType?: string };
    }) => Promise<{ text?: string }> } };
    const base64 = imageBuffer.toString('base64');
    const contents = [
      {
        text:
          CLASSIFY_IMAGE_CONTEXT_PROMPT +
          '\n\nReply with only a JSON object with keys "kind" (one of: contextual, negligible_background, cutout) and optional "reason" (string). No other text.',
      },
      { inlineData: { mimeType, data: base64 } },
    ];
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: { responseMimeType: 'application/json' },
    });
    const text = response.text?.trim();
    if (!text) return { kind: 'negligible_background', reason: 'Empty response from model.' };
    try {
      const parsed = ClassifyImageContextSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      return { kind: 'negligible_background', reason: parsed.error.message || 'Invalid response shape.' };
    } catch (e) {
      return { kind: 'negligible_background', reason: e instanceof Error ? e.message : 'Failed to parse JSON.' };
    }
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
