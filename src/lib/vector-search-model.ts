import { buildSemanticCacheKey } from './local-rag-helpers';

export interface HybridDocumentCandidate {
  id: string;
  title: string;
  content: string;
  lexicalScore?: number;
  vectorScore?: number;
  graphScore?: number;
  graphHints?: string[];
}

export interface RankedHybridDocument extends HybridDocumentCandidate {
  hybridScore: number;
}

const RERANK_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'how',
  'what',
  'why',
  'when',
  'where',
  'help',
  'please',
]);

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function normalizeLexicalScore(score?: number) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return 0;
  }

  return 1 / (1 + Math.max(score, 0));
}

export function hybridScoreDocuments(
  documents: HybridDocumentCandidate[],
  options?: { lexicalWeight?: number; vectorWeight?: number },
): RankedHybridDocument[] {
  const lexicalWeight = options?.lexicalWeight ?? 0.45;
  const vectorWeight = options?.vectorWeight ?? 0.55;

  return documents
    .map((document) => {
      const lexical = normalizeLexicalScore(document.lexicalScore);
      const vector = typeof document.vectorScore === 'number' ? Math.max(document.vectorScore, 0) : 0;

      return {
        ...document,
        hybridScore: lexical * lexicalWeight + vector * vectorWeight,
      };
    })
    .sort((left, right) => right.hybridScore - left.hybridScore);
}

function tokenizeForRerank(value: string) {
  return buildSemanticCacheKey(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !RERANK_STOPWORDS.has(token));
}

export function rerankHybridDocuments(documents: RankedHybridDocument[], query: string) {
  const normalizedQuery = buildSemanticCacheKey(query);
  const queryTokens = tokenizeForRerank(query);

  if (!normalizedQuery || queryTokens.length === 0) {
    return documents;
  }

  return [...documents]
    .map((document) => {
      const normalizedTitle = buildSemanticCacheKey(document.title);
      const normalizedContent = buildSemanticCacheKey(document.content);
      let titleHits = 0;
      let contentHits = 0;

      queryTokens.forEach((token) => {
        if (normalizedTitle.includes(token)) {
          titleHits += 1;
        }
        if (normalizedContent.includes(token)) {
          contentHits += 1;
        }
      });

      const titleCoverage = titleHits / queryTokens.length;
      const contentCoverage = contentHits / queryTokens.length;
      const exactPhraseBonus =
        normalizedTitle.includes(normalizedQuery) || normalizedContent.includes(normalizedQuery)
          ? 1
          : 0;
      const rerankScore =
        document.hybridScore * 0.7 + contentCoverage * 0.17 + titleCoverage * 0.1 + exactPhraseBonus * 0.03;

      return {
        ...document,
        hybridScore: rerankScore,
      };
    })
    .sort((left, right) => right.hybridScore - left.hybridScore);
}

export function summarizeEmbeddingVector(vector: number[], previewSize = 3) {
  const preview = vector
    .slice(0, previewSize)
    .map((value) => value.toFixed(4))
    .join(', ');
  return `dims=${vector.length} [${preview}]`;
}
