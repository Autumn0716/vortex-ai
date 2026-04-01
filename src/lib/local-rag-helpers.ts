export interface ChunkDocumentOptions {
  chunkSize?: number;
  overlap?: number;
}

export interface DocumentChunk {
  index: number;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;

export function buildSemanticCacheKey(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decomposeTaskQuery(query: string): string[] {
  const normalized = query
    .replace(/[，。；;]/g, ',')
    .replace(/\b(?:then|and then|after that)\b/gi, ',')
    .replace(/先|然后|再|接着/g, ',')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [query.trim()].filter(Boolean);
}

export function chunkDocumentContent(
  content: string,
  options: ChunkDocumentOptions = {},
): DocumentChunk[] {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const overlap = Math.max(0, Math.min(options.overlap ?? DEFAULT_CHUNK_OVERLAP, chunkSize - 1));
  const words = content
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let currentWords: string[] = [];
  let currentLength = 0;
  let cursor = 0;

  while (cursor < words.length) {
    const word = words[cursor]!;
    const separator = currentWords.length > 0 ? 1 : 0;
    if (currentLength + separator + word.length <= chunkSize || currentWords.length === 0) {
      currentWords.push(word);
      currentLength += separator + word.length;
      cursor += 1;
      continue;
    }

    chunks.push({
      index: chunks.length,
      text: currentWords.join(' '),
    });

    const overlapWords: string[] = [];
    let overlapLength = 0;
    for (let index = currentWords.length - 1; index >= 0; index -= 1) {
      const candidate = currentWords[index]!;
      const nextLength = overlapLength + candidate.length + (overlapWords.length > 0 ? 1 : 0);
      if (nextLength > overlap) {
        break;
      }
      overlapWords.unshift(candidate);
      overlapLength = nextLength;
    }

    currentWords = overlapWords;
    currentLength = overlapWords.join(' ').length;
  }

  if (currentWords.length > 0) {
    chunks.push({
      index: chunks.length,
      text: currentWords.join(' '),
    });
  }

  return chunks;
}
