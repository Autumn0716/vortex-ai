export interface ChunkDocumentOptions {
  chunkSize?: number;
  overlap?: number;
}

export interface DocumentChunk {
  index: number;
  text: string;
}

export interface KnowledgeGraphNode {
  entity: string;
  normalizedEntity: string;
  entityType: 'title' | 'heading' | 'code' | 'term';
  weight: number;
}

export interface KnowledgeGraphEdge {
  sourceEntity: string;
  targetEntity: string;
  relation: 'cooccurs';
  weight: number;
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
const GRAPH_ENTITY_STOPWORDS = new Set([
  ...ENGLISH_QUERY_STOPWORDS,
  'about',
  'flowagent',
  'general',
  'guide',
  'http',
  'https',
  'information',
  'notes',
  'www',
  'com',
  'org',
  'net',
  'www',
  'api',
  'process',
  'summary',
  'use',
  'using',
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

export function scoreRetrievedContextSupport(
  query: string,
  title: string,
  content: string,
): {
  score: number;
  label: 'low' | 'medium' | 'high' | 'unknown';
  matchedTerms: string[];
} {
  const queryTokens = buildSemanticCacheKey(query)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ENGLISH_QUERY_STOPWORDS.has(token));
  const normalizedQuery = buildSemanticCacheKey(query);
  const normalizedTitle = buildSemanticCacheKey(title);
  const normalizedContent = buildSemanticCacheKey(content);

  if (!normalizedQuery || queryTokens.length === 0) {
    return {
      score: 0,
      label: 'unknown' as const,
      matchedTerms: [] as string[],
    };
  }

  const matchedTerms = queryTokens.filter(
    (token) => normalizedTitle.includes(token) || normalizedContent.includes(token),
  );
  const exactPhrase =
    normalizedTitle.includes(normalizedQuery) || normalizedContent.includes(normalizedQuery) ? 1 : 0;
  const score = Math.min(
    1,
    matchedTerms.length / queryTokens.length + exactPhrase * 0.2,
  );
  const label = score >= 0.85 ? 'high' : score >= 0.5 ? 'medium' : 'low';

  return {
    score: Number(score.toFixed(3)),
    label,
    matchedTerms,
  };
}

function normalizeGraphEntity(value: string) {
  const normalized = buildSemanticCacheKey(value)
    .replace(/\b(?:md|ts|tsx|js|json|sql|sqlite)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length < 2 || GRAPH_ENTITY_STOPWORDS.has(normalized)) {
    return '';
  }
  return normalized;
}

function collectGraphEntity(
  target: Map<string, KnowledgeGraphNode>,
  entity: string,
  entityType: KnowledgeGraphNode['entityType'],
  weight: number,
) {
  const normalizedEntity = normalizeGraphEntity(entity);
  if (!normalizedEntity) {
    return;
  }

  const existing = target.get(normalizedEntity);
  if (!existing || weight > existing.weight) {
    target.set(normalizedEntity, {
      entity: entity.trim(),
      normalizedEntity,
      entityType,
      weight,
    });
  }
}

function extractLineEntities(line: string) {
  const entities = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizeGraphEntity(value);
    if (normalized) {
      entities.add(normalized);
    }
  };

  for (const match of line.matchAll(/`([^`\n]{2,80})`/g)) {
    push(match[1] ?? '');
  }
  for (const match of line.matchAll(/\b[A-Za-z0-9_/-]+\.(?:md|ts|tsx|js|json|sql|sqlite)\b/g)) {
    push(match[0] ?? '');
  }
  for (const match of line.matchAll(/\b[A-Z][A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*\b/g)) {
    push(match[0] ?? '');
  }
  for (const match of line.matchAll(/\b[a-z]+(?:[-_][a-z0-9]+){1,}\b/gi)) {
    push(match[0] ?? '');
  }

  const normalizedLine = buildSemanticCacheKey(line);
  const tokens = normalizedLine
    .split(/\s+/)
    .filter((token) => token.length > 2 && !GRAPH_ENTITY_STOPWORDS.has(token));

  tokens.forEach((token) => push(token));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...entities];
}

export function extractKnowledgeGraphEntities(input: string, maxEntities = 12) {
  const lines = input.split('\n').map((line) => line.trim()).filter(Boolean);
  const nodes = new Map<string, KnowledgeGraphNode>();

  lines.forEach((line, index) => {
    const isHeading = /^#{1,6}\s+/.test(line);
    const headingText = isHeading ? line.replace(/^#{1,6}\s+/, '') : line;
    if (index === 0) {
      collectGraphEntity(nodes, headingText, 'title', 1);
    }
    if (isHeading) {
      collectGraphEntity(nodes, headingText, 'heading', 0.9);
    }
    for (const match of line.matchAll(/`([^`\n]{2,80})`/g)) {
      collectGraphEntity(nodes, match[1] ?? '', 'code', 0.95);
    }
    extractLineEntities(line).forEach((entity) => {
      collectGraphEntity(nodes, entity, 'term', isHeading ? 0.8 : 0.65);
    });
  });

  return [...nodes.values()]
    .sort((left, right) => right.weight - left.weight || left.normalizedEntity.localeCompare(right.normalizedEntity))
    .slice(0, maxEntities);
}

export function buildDocumentKnowledgeGraph(title: string, content: string, maxNodes = 20) {
  const nodeMap = new Map<string, KnowledgeGraphNode>();
  extractKnowledgeGraphEntities(title, Math.min(6, maxNodes)).forEach((node) => {
    nodeMap.set(node.normalizedEntity, {
      ...node,
      entityType: 'title',
      weight: Math.max(node.weight, 1),
    });
  });

  const candidateLines = content.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 80);
  candidateLines.forEach((line) => {
    const entityType = /^#{1,6}\s+/.test(line) ? 'heading' : 'term';
    extractKnowledgeGraphEntities(line, 6).forEach((node) => {
      collectGraphEntity(nodeMap, node.entity, entityType, node.weight);
    });
  });

  const nodes = [...nodeMap.values()]
    .sort((left, right) => right.weight - left.weight || left.normalizedEntity.localeCompare(right.normalizedEntity))
    .slice(0, maxNodes);

  const edgeMap = new Map<string, KnowledgeGraphEdge>();
  const addEdge = (sourceEntity: string, targetEntity: string, weight: number) => {
    if (sourceEntity === targetEntity) {
      return;
    }
    const [left, right] = [sourceEntity, targetEntity].sort((a, b) => a.localeCompare(b));
    const key = `${left}::${right}`;
    const existing = edgeMap.get(key);
    edgeMap.set(key, {
      sourceEntity: left,
      targetEntity: right,
      relation: 'cooccurs',
      weight: Math.max(weight, existing?.weight ?? 0),
    });
  };

  candidateLines.forEach((line) => {
    const entities = extractLineEntities(line).filter((entity) => nodeMap.has(entity)).slice(0, 6);
    for (let index = 0; index < entities.length; index += 1) {
      for (let next = index + 1; next < entities.length; next += 1) {
        addEdge(entities[index]!, entities[next]!, 0.6);
      }
    }
  });

  return {
    nodes,
    edges: [...edgeMap.values()].slice(0, 48),
  };
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
