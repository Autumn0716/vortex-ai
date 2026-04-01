export interface HybridDocumentCandidate {
  id: string;
  title: string;
  content: string;
  lexicalScore?: number;
  vectorScore?: number;
}

export interface RankedHybridDocument extends HybridDocumentCandidate {
  hybridScore: number;
}

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

export function summarizeEmbeddingVector(vector: number[], previewSize = 3) {
  const preview = vector
    .slice(0, previewSize)
    .map((value) => value.toFixed(4))
    .join(', ');
  return `dims=${vector.length} [${preview}]`;
}
