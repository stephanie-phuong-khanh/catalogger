/**
 * Vision client abstraction so image-editing code can use OpenAI or Gemini
 * without depending on a specific provider. Entry points create the client
 * (from env) and pass it in.
 */

import type OpenAI from 'openai';
import { z } from 'zod';

/** Zod schema for crop proposal — enforces structure and gives a reason when rejecting. */
export const ProposeCropSchema = z.object({
  useCenterCrop: z.boolean().describe('True if the red square crop is acceptable; false if it cuts the product or is badly composed.'),
  reason: z.string().describe('When useCenterCrop is false, briefly explain why (e.g. "crops the sauna on the left", "cuts through the bed"). When true, leave empty or say "OK".'),
});
export type ProposeCropResult = z.infer<typeof ProposeCropSchema>;

/**
 * Interface for vision operations used by image editing (crop suggestions, classification, etc.).
 * Implementations wrap OpenAI, Gemini, or a mock for tests.
 */
export interface ImageVisionClient {
  /**
   * Ask the model whether the proposed crop (shown as red overlay on the image) is acceptable.
   * Returns structured result (useCenterCrop + reason) so callers can show why a crop was rejected.
   */
  proposeCrop(imageWithOverlayBuffer: Buffer, prompt: string, mimeType?: string): Promise<ProposeCropResult>;
}

/**
 * Stub adapter: no API calls. proposeCrop returns approved (don't block).
 */
export class NoOpVisionClient implements ImageVisionClient {
  async proposeCrop(): Promise<ProposeCropResult> {
    return { useCenterCrop: true, reason: '' };
  }
}

/**
 * OpenAI-backed vision client using Responses API (gpt-4o) with Zod for structured output.
 */
export class OpenAIVisionClient implements ImageVisionClient {
  constructor(private openai: OpenAI) {}

  async proposeCrop(
    imageWithOverlayBuffer: Buffer,
    prompt: string,
    mimeType: string = 'image/jpeg',
  ): Promise<ProposeCropResult> {
    const { zodTextFormat } = require('openai/helpers/zod');
    const dataUrl = `data:${mimeType};base64,${imageWithOverlayBuffer.toString('base64')}`;
    const input = [
      {
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text: prompt },
          { type: 'input_image' as const, image_url: dataUrl, detail: 'low' as const },
        ],
      },
    ];
    const response = await this.openai.responses.parse({
      model: 'gpt-4o',
      temperature: 0,
      input,
      text: { format: zodTextFormat(ProposeCropSchema, 'propose_crop') },
    });
    const parsed = response.output_parsed as ProposeCropResult | null;
    if (parsed) return parsed;
    return { useCenterCrop: false, reason: 'No structured response from model.' };
  }
}

/**
 * Gemini-backed vision client.
 * Constructor receives the client from @google/genai (GoogleGenAI instance).
 */
export class GeminiVisionClient implements ImageVisionClient {
  constructor(private _client: unknown) {}

  async proposeCrop(
    imageWithOverlayBuffer: Buffer,
    prompt: string,
    mimeType: string = 'image/jpeg',
  ): Promise<ProposeCropResult> {
    const client = this._client as { models: { generateContent: (params: {
      model: string;
      contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      config?: { responseMimeType?: string };
    }) => Promise<{ text?: string }> } };
    const base64 = imageWithOverlayBuffer.toString('base64');
    const contents = [
      {
        text:
          prompt +
          '\n\nReply with only a JSON object with keys "useCenterCrop" (boolean) and "reason" (string). When useCenterCrop is false, explain why in reason. When true, reason can be empty. No other text.',
      },
      { inlineData: { mimeType, data: base64 } },
    ];
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: { responseMimeType: 'application/json' },
    });
    const text = response.text?.trim();
    if (!text) return { useCenterCrop: false, reason: 'Empty response from model.' };
    try {
      const parsed = ProposeCropSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      return { useCenterCrop: false, reason: parsed.error.message || 'Invalid response shape.' };
    } catch (e) {
      return { useCenterCrop: false, reason: e instanceof Error ? e.message : 'Failed to parse JSON.' };
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
