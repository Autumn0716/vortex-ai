import React, { useEffect, useState } from 'react';
import { X, Search, FileText, Trash2, Plus, Database } from 'lucide-react';
import {
  addDocument,
  deleteDocument,
  getDocuments,
  searchKnowledgeDocumentsWithMetrics,
  type KnowledgeDocumentSearchMetrics,
  type KnowledgeDocumentSearchResult,
} from '../lib/db';

function formatDuration(durationMs: number) {
  if (durationMs <= 0) {
    return '0 ms';
  }
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function formatSourceType(sourceType?: string) {
  if (!sourceType) {
    return '';
  }
  return sourceType === 'skill_doc' ? 'skill' : sourceType.replace(/_/g, ' ');
}

function formatRetrievalStage(stage?: string) {
  if (!stage) {
    return 'primary';
  }
  return stage;
}

function supportTone(label?: string) {
  if (label === 'high') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/85';
  }
  if (label === 'medium') {
    return 'border-sky-400/20 bg-sky-400/10 text-sky-100/85';
  }
  if (label === 'low') {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-100/85';
  }
  return 'border-white/10 bg-white/5 text-white/45';
}

export const KnowledgePanel = ({ onClose }: { onClose: () => void }) => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeDocumentSearchResult[]>([]);
  const [searchMetrics, setSearchMetrics] = useState<KnowledgeDocumentSearchMetrics | null>(null);
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const loadDocs = async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments();
      setDocuments(docs);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs().catch(console.error);
  }, []);

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) {
      return;
    }

    const id = Date.now().toString();
    await addDocument(id, title, content);

    setTitle('');
    setContent('');
    setIsAdding(false);
    await loadDocs();
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    await loadDocs();
  };

  const handleSearch = async () => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setSearchResults([]);
      setSearchMetrics(null);
      setSearchError('');
      return;
    }

    setIsSearching(true);
    setSearchError('');
    try {
      const response = await searchKnowledgeDocumentsWithMetrics(normalizedQuery, { maxResults: 6 });
      setSearchResults(response.results);
      setSearchMetrics(response.metrics);
    } catch (error) {
      setSearchResults([]);
      setSearchMetrics(null);
      setSearchError(error instanceof Error ? error.message : 'Knowledge search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="z-20 flex h-full w-80 flex-shrink-0 flex-col border-l border-white/10 bg-[#05050A] shadow-2xl md:w-[440px]">
      <div className="flex h-14 items-center justify-between border-b border-white/10 bg-white/[0.02] px-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-emerald-400" />
          <span className="text-sm font-semibold tracking-tight">SQLite Knowledge Base</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <Search size={15} className="text-sky-300/75" />
            <div className="text-sm font-medium text-white/90">Search Local RAG</div>
          </div>
          <div className="mt-1 text-xs leading-5 text-white/45">
            检查当前知识库的召回结果、支持度与各阶段耗时。
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder="例如：sqlite bootstrap schema"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-sky-400/35"
            />
            <button
              onClick={() => void handleSearch()}
              disabled={isSearching}
              className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100 transition-colors hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? 'Searching' : 'Search'}
            </button>
          </div>

          {searchMetrics ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
                <span>Retrieval Metrics</span>
                {searchMetrics.cacheHit ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-emerald-100/80">
                    cache hit
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 text-[11px] text-white/55 md:grid-cols-2">
                <div>总耗时 {formatDuration(searchMetrics.totalDurationMs)}</div>
                <div>检索改写 {searchMetrics.expandedQueryCount} 条</div>
                <div>Lexical {formatDuration(searchMetrics.lexicalDurationMs)}</div>
                <div>Vector {formatDuration(searchMetrics.vectorDurationMs)}</div>
                <div>Graph {formatDuration(searchMetrics.graphDurationMs)}</div>
                <div>Rerank {formatDuration(searchMetrics.rerankDurationMs)}</div>
                <div>Corrective {formatDuration(searchMetrics.correctiveDurationMs)}</div>
                <div>
                  Candidate {searchMetrics.primaryCandidateCount}
                  {searchMetrics.correctiveCandidateCount > 0
                    ? ` + ${searchMetrics.correctiveCandidateCount}`
                    : ''}
                </div>
              </div>
            </div>
          ) : null}

          {searchError ? (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100/80">
              {searchError}
            </div>
          ) : null}

          {searchQuery.trim() ? (
            <div className="mt-3 space-y-2">
              {isSearching ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-4 text-xs text-white/45">
                  正在执行混合检索…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/45">
                  当前查询没有命中文档。
                </div>
              ) : (
                searchResults.map((result) => (
                  <div
                    key={result.id}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium text-white/90">{result.title}</div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                        {formatSourceType(result.sourceType)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${supportTone(result.supportLabel)}`}
                      >
                        support {result.supportLabel ?? 'unknown'}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                        {formatRetrievalStage(result.retrievalStage)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-white/58">{result.content}</p>
                    {result.matchedTerms?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {result.matchedTerms.slice(0, 6).map((term) => (
                          <span
                            key={`${result.id}_${term}`}
                            className="rounded-full border border-sky-400/15 bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-100/75"
                          >
                            {term}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {isAdding ? (
          <div className="mt-6 space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-medium text-white/90">Add New Document</h3>
            <input
              type="text"
              placeholder="Document Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
            />
            <textarea
              placeholder="Document Content (for RAG search)"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-[120px] w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={!title.trim() || !content.trim()}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Save to SQLite
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="mb-6 mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Plus size={16} />
            Add Document to RAG
          </button>
        )}

        <div className="mt-6 space-y-3">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Stored Documents</h3>
          <p className="mb-3 text-xs text-white/35">
            Project markdown, shared <code className="rounded bg-white/5 px-1 py-0.5">skills/**/SKILL.md</code>，
            以及当前 agent 的私有 skills 文档都会同步到本地索引。
          </p>

          {isLoading ? (
            <div className="py-8 text-center text-sm text-white/40">Loading database...</div>
          ) : documents.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">No documents found. Add some to test RAG!</div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="group rounded-xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0 rounded-lg bg-emerald-500/10 p-1.5">
                      <FileText size={14} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium text-white/90">{doc.title}</h4>
                        {doc.sourceType ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                            {formatSourceType(doc.sourceType)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-white/50">{doc.content}</p>
                      {Array.isArray(doc.tags) && doc.tags.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {doc.tags.slice(0, 3).map((tag: string) => (
                            <span
                              key={`${doc.id}_${tag}`}
                              className="rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300/80"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleDelete(doc.id)}
                    className="rounded-lg p-1.5 text-white/30 opacity-0 transition-colors hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100 flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
