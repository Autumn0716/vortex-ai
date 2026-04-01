export interface MemorySummaryProxy {
  id: string;
  originalMemoryId: string;
  summary: string;
  keywords: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  originalContentPreview: string;
}

export interface MemoryCompressionResult {
  originalMemoryId: string;
  compressedSummary: string;
  keywords: string[];
  importanceScore: number;
  compressedAt: string;
}

export interface MemoryArchivalPlan {
  memoryId: string;
  originalContent: string;
  summary: string;
  keywords: string[];
  importanceScore: number;
  archiveDate: string;
  retentionTier: 'warm' | 'cold';
}

export interface QueryRouterIntent {
  query: string;
  hasTemporalReference: boolean;
  temporalKeywords: string[];
  suggestedRetrievalLayers: ('hot' | 'warm' | 'cold' | 'global')[];
  estimatedRelevance: number;
}

export type MemoryRetrievalLayer = 'hot' | 'warm' | 'cold' | 'global';

export type MemoryQueryRouteMode = 'explicit_cold' | 'default';

export interface MemoryQueryRoute {
  mode: MemoryQueryRouteMode;
  preferredLayers: MemoryRetrievalLayer[];
  fallbackLayers: MemoryRetrievalLayer[];
  matchedTimeExpression?: string;
}

export interface MemoryQueryRouterOptions {
  now?: string;
}
