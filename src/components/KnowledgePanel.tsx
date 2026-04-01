import React, { useEffect, useState } from 'react';
import { X, Search, FileText, Trash2, Plus, Database } from 'lucide-react';
import { addDocument, getDocuments, deleteDocument } from '../lib/db';

export const KnowledgePanel = ({ onClose }: { onClose: () => void }) => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadDocs = async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments();
      setDocuments(docs);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) return;
    
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

  return (
    <div className="flex flex-col h-full bg-[#05050A] border-l border-white/10 w-80 md:w-[400px] flex-shrink-0 shadow-2xl z-20">
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-4 bg-white/[0.02]">
          <div className="flex items-center gap-2">
          <Database size={16} className="text-emerald-400" />
          <span className="text-sm font-semibold tracking-tight">SQLite Knowledge Base</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {isAdding ? (
          <div className="space-y-4 bg-white/5 p-4 rounded-xl border border-white/10">
            <h3 className="text-sm font-medium text-white/90">Add New Document</h3>
            <input
              type="text"
              placeholder="Document Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
            <textarea
              placeholder="Document Content (for RAG search)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 min-h-[120px] resize-y"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button 
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleAdd}
                disabled={!title.trim() || !content.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
              >
                Save to SQLite
              </button>
            </div>
          </div>
        ) : (
          <button 
            onClick={() => setIsAdding(true)}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 border-dashed rounded-xl p-4 text-sm font-medium text-white/60 hover:text-white transition-colors mb-6"
          >
            <Plus size={16} />
            Add Document to RAG
          </button>
        )}

        <div className="mt-6 space-y-3">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Stored Documents</h3>
          <p className="mb-3 text-xs text-white/35">
            Project markdown and future <code className="rounded bg-white/5 px-1 py-0.5">skills</code> docs are synced into the local index automatically on app startup.
          </p>
          
          {isLoading ? (
            <div className="text-center py-8 text-white/40 text-sm">Loading database...</div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-white/40 text-sm">No documents found. Add some to test RAG!</div>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="group bg-white/5 border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 p-1.5 bg-emerald-500/10 rounded-lg flex-shrink-0">
                      <FileText size={14} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-white/90 truncate">{doc.title}</h4>
                        {doc.sourceType ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                            {doc.sourceType === 'skill_doc' ? 'skill' : doc.sourceType.replace(/_/g, ' ')}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-white/50 line-clamp-2 mt-1">{doc.content}</p>
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
                    onClick={() => handleDelete(doc.id)}
                    className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
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
