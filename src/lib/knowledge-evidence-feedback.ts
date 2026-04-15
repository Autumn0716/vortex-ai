import type { StoredToolRun } from './db';

export type KnowledgeEvidenceSupportLabel = 'low' | 'medium' | 'high' | 'unknown';
export type KnowledgeEvidenceFeedbackValue = 'helpful' | 'not_helpful';

export interface KnowledgeEvidenceResult {
  id: string;
  title: string;
  sourceType?: string;
  sourceUri?: string;
  retrievalStage?: string;
  supportLabel: KnowledgeEvidenceSupportLabel;
  supportScore: number;
  matchedTerms: string[];
}

export interface KnowledgeEvidencePanel {
  totalResults: number;
  strongestSupport: KnowledgeEvidenceSupportLabel;
  recommendation?: string;
  results: KnowledgeEvidenceResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readSupportLabel(value: unknown): KnowledgeEvidenceSupportLabel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'unknown' ? value : 'unknown';
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)) : [];
}

export function parseKnowledgeEvidenceToolResult(tool: StoredToolRun): KnowledgeEvidencePanel | null {
  if (tool.name !== 'search_knowledge_base' || !tool.result?.trim()) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(tool.result);
  } catch {
    return null;
  }

  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return null;
  }

  const evidence = isRecord(payload.evidence) ? payload.evidence : {};
  const results = payload.results
    .filter(isRecord)
    .map((result): KnowledgeEvidenceResult | null => {
      const id = readString(result.id);
      const title = readString(result.title);
      if (!id || !title) {
        return null;
      }

      const support = isRecord(result.support) ? result.support : {};
      const supportScore = typeof support.score === 'number' && Number.isFinite(support.score) ? support.score : 0;

      return {
        id,
        title,
        sourceType: readString(result.sourceType),
        sourceUri: readString(result.sourceUri),
        retrievalStage: readString(result.retrievalStage),
        supportLabel: readSupportLabel(support.label),
        supportScore,
        matchedTerms: readStringList(support.matchedTerms),
      };
    })
    .filter((result): result is KnowledgeEvidenceResult => Boolean(result));

  if (results.length === 0) {
    return null;
  }

  return {
    totalResults:
      typeof evidence.totalResults === 'number' && Number.isFinite(evidence.totalResults)
        ? evidence.totalResults
        : results.length,
    strongestSupport: readSupportLabel(evidence.strongestSupport),
    recommendation: readString(evidence.recommendation),
    results,
  };
}

export function parseKnowledgeEvidencePanels(tools?: StoredToolRun[]): KnowledgeEvidencePanel[] {
  return tools?.map(parseKnowledgeEvidenceToolResult).filter((panel): panel is KnowledgeEvidencePanel => Boolean(panel)) ?? [];
}
