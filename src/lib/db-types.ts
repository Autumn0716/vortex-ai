import type { EmbeddingProviderConfig } from './embedding-client';
import type { KnowledgeDocumentSourceType } from './knowledge-document-model';

export interface StoredToolRun {
  name: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  preview: string;
  laneCount: number;
}

export interface AssistantProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptSnippet {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLane {
  id: string;
  conversationId: string;
  assistantId: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  laneId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName: string;
  content: string;
  createdAt: string;
  tools?: StoredToolRun[];
}

export interface ChatMessageInput {
  id?: string;
  conversationId: string;
  laneId: string;
  role: ChatMessage['role'];
  authorName: string;
  content: string;
  createdAt?: string;
  tools?: StoredToolRun[];
}

export interface ConversationWorkspace {
  conversation: ConversationSummary;
  lanes: AgentLane[];
  messagesByLane: Record<string, ChatMessage[]>;
}

export interface DataStats {
  conversations: number;
  lanes: number;
  messages: number;
  documents: number;
  memoryDocuments: number;
  assistants: number;
  snippets: number;
}

export interface GlobalMemoryDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentRecord {
  id: string;
  title: string;
  content: string;
  sourceType: KnowledgeDocumentSourceType;
  sourceUri?: string;
  tags: string[];
  syncedAt?: string;
  updatedAt?: string;
}

export interface KnowledgeDocumentSupportMetadata {
  supportScore?: number;
  supportLabel?: 'low' | 'medium' | 'high' | 'unknown';
  matchedTerms?: string[];
  graphHints?: string[];
  graphExpansionHints?: string[];
  graphPaths?: string[];
  retrievalStage?: 'primary' | 'corrective' | 'hybrid';
}

export interface KnowledgeDocumentSearchResult
  extends KnowledgeDocumentRecord,
    KnowledgeDocumentSupportMetadata {}

export interface KnowledgeDocumentSearchMetrics {
  cacheHit: boolean;
  expandedQueryCount: number;
  subqueryCount: number;
  primaryCandidateCount: number;
  correctiveQueryCount: number;
  correctiveCandidateCount: number;
  lexicalDurationMs: number;
  vectorDurationMs: number;
  graphDurationMs: number;
  rerankDurationMs: number;
  correctiveDurationMs: number;
  totalDurationMs: number;
}

export type KnowledgeEvidenceFeedbackValue = 'helpful' | 'not_helpful';

export interface KnowledgeEvidenceFeedbackInput {
  messageId: string;
  documentId: string;
  value: KnowledgeEvidenceFeedbackValue;
  sourceType?: string;
  supportLabel?: string;
  matchedTerms?: string[];
}

export interface KnowledgeDocumentSearchResponse {
  results: KnowledgeDocumentSearchResult[];
  metrics: KnowledgeDocumentSearchMetrics;
}

export interface RetrievedDocumentResult extends KnowledgeDocumentSupportMetadata {
  id: string;
  title: string;
  content: string;
  graphHints?: string[];
  graphExpansionHints?: string[];
  graphPaths?: string[];
}

export interface DocumentSearchCandidate {
  id: string;
  title: string;
  content: string;
  lexicalScore?: number;
  vectorScore?: number;
  graphScore?: number;
  sourceType?: KnowledgeDocumentSourceType;
  graphHints?: string[];
  graphExpansionHints?: string[];
  graphPaths?: string[];
}

export interface CandidateCollectionMetrics {
  lexicalDurationMs: number;
  vectorDurationMs: number;
  graphDurationMs: number;
}

export interface KnowledgeDocumentSearchOptions {
  embeddingConfig?: EmbeddingProviderConfig | null;
  maxResults?: number;
  sourceTypes?: KnowledgeDocumentSourceType[];
  sourceUriPrefixes?: string[];
  searchWeights?: {
    lexicalWeight?: number;
    vectorWeight?: number;
    graphWeight?: number;
    sourceTypeWeights?: Partial<Record<KnowledgeDocumentSourceType, number>>;
  };
}

export interface AssistantSeed {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  accentColor: string;
  providerId?: string;
  model?: string;
  isDefault?: boolean;
}

export interface PromptSeed {
  id: string;
  title: string;
  content: string;
  category: string;
}

export interface DocumentSearchRow {
  id: string;
  title: string;
  content: string;
  score: number;
}

export interface DocumentChunkEmbeddingRow {
  chunk_id: string;
  document_id: string;
  content: string;
  embedding_json: string;
}
