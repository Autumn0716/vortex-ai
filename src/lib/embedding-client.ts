export interface EmbeddingProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  dimensions?: number;
  encodingFormat?: 'float';
}

export interface EmbeddingResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export const DEFAULT_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export function buildEmbeddingEndpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, '')}/embeddings`;
}

export async function createEmbeddings(
  input: string[] | string,
  config: EmbeddingProviderConfig,
): Promise<EmbeddingResponse> {
  const response = await fetch(buildEmbeddingEndpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input,
      dimensions: config.dimensions,
      encoding_format: config.encodingFormat ?? 'float',
    }),
  });

  const payload = (await response.json()) as EmbeddingResponse & {
    error?: { message?: string; code?: string };
  };

  if (!response.ok || payload.error) {
    const message =
      payload.error?.message ||
      `Embedding request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function buildEmbeddingContentHash(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `embed_${(hash >>> 0).toString(36)}`;
}
