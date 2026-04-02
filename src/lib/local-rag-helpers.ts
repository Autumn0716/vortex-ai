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
const ENGLISH_QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'do',
  'i',
  'me',
  'my',
  'please',
  'can',
  'could',
  'would',
  'should',
  'to',
  'for',
  'of',
  'with',
  'and',
  'or',
  'in',
  'on',
  'at',
  'is',
  'are',
  'be',
  'it',
  'this',
  'that',
  'how',
  'what',
  'when',
  'where',
  'why',
  'help',
]);

const CROSS_LINGUAL_ALIASES: Array<[RegExp, string]> = [
  [/知识库/g, 'knowledge base retrieval'],
  [/技能|skill\.?md/gi, 'skill skill md'],
  [/分支/g, 'branch subtask'],
  [/父会话|主会话/g, 'parent topic main thread'],
  [/回传|回退|返回|同步回来/g, 'handoff send back return'],
  [/报错|错误/g, 'error failure issue'],
  [/配置/g, 'config configuration'],
  [/部署/g, 'deploy deployment'],
  [/数据库/g, 'database sqlite'],
  [/调试/g, 'debug troubleshoot diagnose'],
  [/文档/g, 'document docs'],
];

const TOKEN_SYNONYMS = new Map<string, string[]>([
  ['debug', ['troubleshoot', 'diagnose']],
  ['error', ['failure', 'issue']],
  ['config', ['configuration']],
  ['deploy', ['deployment']],
  ['branch', ['subtask', 'child']],
  ['parent', ['main']],
  ['handoff', ['return', 'summary']],
  ['skills', ['skill']],
  ['docs', ['documentation', 'document']],
  ['sqlite', ['database']],
  ['search', ['retrieval']],
]);

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

function injectCrossLingualAliases(query: string): string {
  return CROSS_LINGUAL_ALIASES.reduce((current, [pattern, replacement]) => {
    pattern.lastIndex = 0;
    if (!pattern.test(current)) {
      return current;
    }
    pattern.lastIndex = 0;
    return `${current} ${replacement}`.trim();
  }, query);
}

function stripConversationalFiller(query: string): string {
  return query
    .replace(/^(?:please|can you|could you|would you|help me|show me|tell me|i need to|i want to)\s+/i, '')
    .replace(/^(?:怎么|如何|请|请问|帮我|麻烦|我想|我需要|能不能|可以)\s*/u, '')
    .trim();
}

function buildKeywordFocusQuery(query: string): string {
  return buildSemanticCacheKey(query)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ENGLISH_QUERY_STOPWORDS.has(token))
    .join(' ');
}

function buildSynonymExpansionQuery(query: string): string {
  const normalized = buildSemanticCacheKey(query);
  if (!normalized) {
    return '';
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const expansions = new Set<string>(tokens);
  tokens.forEach((token) => {
    TOKEN_SYNONYMS.get(token)?.forEach((alias) => expansions.add(alias));
  });
  return [...expansions].join(' ');
}

export function expandKnowledgeSearchQueries(query: string, maxVariants = 8): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (value: string) => {
    const normalized = buildSemanticCacheKey(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const seeded = injectCrossLingualAliases(stripConversationalFiller(query));
  [query, seeded, ...decomposeTaskQuery(seeded)].forEach((candidate) => {
    pushCandidate(candidate);
    pushCandidate(buildKeywordFocusQuery(candidate));
    pushCandidate(buildSynonymExpansionQuery(candidate));
  });

  return candidates.slice(0, maxVariants);
}

export function compressRetrievedContext(
  query: string,
  content: string,
  options: { maxChars?: number; windowChars?: number } = {},
) {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return '';
  }

  const maxChars = Math.max(120, options.maxChars ?? 420);
  if (normalizedContent.length <= maxChars) {
    return normalizedContent;
  }

  const queryTokens = buildSemanticCacheKey(query)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ENGLISH_QUERY_STOPWORDS.has(token));
  const loweredContent = normalizedContent.toLowerCase();
  const windowChars = Math.max(60, options.windowChars ?? Math.floor(maxChars / 2));

  let anchor = -1;
  for (const token of queryTokens) {
    anchor = loweredContent.indexOf(token.toLowerCase());
    if (anchor >= 0) {
      break;
    }
  }

  if (anchor < 0) {
    return `${normalizedContent.slice(0, maxChars - 1).trim()}…`;
  }

  const start = Math.max(0, anchor - windowChars);
  const end = Math.min(normalizedContent.length, anchor + windowChars);
  const excerpt = normalizedContent.slice(start, end).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedContent.length ? '…' : '';
  const compressed = `${prefix}${excerpt}${suffix}`;

  if (compressed.length <= maxChars) {
    return compressed;
  }

  return `${compressed.slice(0, maxChars - 1).trim()}…`;
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
