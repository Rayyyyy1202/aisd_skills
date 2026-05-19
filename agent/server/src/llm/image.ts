import OpenAI from 'openai';

export interface ImageConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export interface ImageRequest {
  prompt: string;
  size?: string;
  quality?: string;
}

export interface ImageResult {
  bytes: Buffer;
  model: string;
}

const DEFAULT_MODEL = 'gpt-image-1';

export class ImageGenerator {
  private openai: OpenAI;
  private model: string;

  constructor(private config: ImageConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model && config.model.trim() ? config.model.trim() : DEFAULT_MODEL;
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const size = req.size ?? '1024x1024';
    const quality = req.quality ?? 'medium';
    const params: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      n: 1,
      size,
      quality,
    };
    const res = await this.openai.images.generate(params as unknown as Parameters<typeof this.openai.images.generate>[0]);
    const data = res.data?.[0];
    if (!data) throw new Error('image API returned no data');
    const b64 = data.b64_json;
    if (!b64) {
      const url = data.url;
      if (!url) throw new Error('image API returned neither b64_json nor url');
      const fetched = await fetch(url);
      if (!fetched.ok) throw new Error(`failed to download image url: HTTP ${fetched.status}`);
      const ab = await fetched.arrayBuffer();
      return { bytes: Buffer.from(ab), model: this.model };
    }
    return { bytes: Buffer.from(b64, 'base64'), model: this.model };
  }
}
