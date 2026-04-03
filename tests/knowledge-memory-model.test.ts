import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKnowledgeDocument,
  normalizeKnowledgeTags,
} from '../src/lib/knowledge-document-model';
import {
  buildConversationMemoryEntry,
  extractMemoryContentLines,
  extractMemoryKeywords,
  extractOpenMemoryTasks,
  buildMemoryPromotionTitle,
  buildPromotionFingerprint,
  formatLayeredMemoryContext,
  resolveMemoryTier,
  scoreMemoryImportance,
  selectEffectiveMemoryDocuments,
  shouldPromoteMemory,
  type MemoryContextDocument,
} from '../src/lib/agent-memory-model';
import {
  buildColdMemorySurrogate,
  buildWarmMemorySurrogate,
  resolveLifecycleTier,
} from '../src/lib/agent-memory-lifecycle';

test('classifyKnowledgeDocument detects skill markdown by path and title', () => {
  const result = classifyKnowledgeDocument({
    title: 'SKILL.md',
    sourceUri: '/workspace/skills/systematic-debugging/SKILL.md',
  });

  assert.equal(result.sourceType, 'skill_doc');
  assert.deepEqual(result.tags, ['knowledge', 'skill']);
});

test('normalizeKnowledgeTags sorts and deduplicates stable tags', () => {
  assert.deepEqual(normalizeKnowledgeTags(['skill', 'knowledge', 'skill', 'memory']), [
    'knowledge',
    'memory',
    'skill',
  ]);
});

test('resolveMemoryTier applies hot warm cold windows', () => {
  const now = '2026-04-01T12:00:00.000Z';

  assert.equal(resolveMemoryTier('2026-03-31T23:00:00.000Z', now), 'hot');
  assert.equal(resolveMemoryTier('2026-03-20T12:00:00.000Z', now), 'warm');
  assert.equal(resolveMemoryTier('2026-03-01T12:00:00.000Z', now), 'cold');
});

test('shouldPromoteMemory catches explicit long-term memory cues', () => {
  assert.equal(shouldPromoteMemory('记住：我默认使用中文输出，并优先给出可执行步骤。', 'user'), true);
  assert.equal(shouldPromoteMemory('Thanks, that answers it.', 'user'), false);
});

test('scoreMemoryImportance boosts explicit preferences and decisions', () => {
  assert.equal(scoreMemoryImportance('记住：我总是先看风险和验证结果。', 'promotion'), 5);
  assert.equal(scoreMemoryImportance('普通闲聊，没有长期价值。', 'conversation_log') >= 1, true);
});

test('buildConversationMemoryEntry formats a compact daily log line', () => {
  const entry = buildConversationMemoryEntry({
    topicTitle: 'Agent RAG Upgrade',
    authorName: 'You',
    role: 'user',
    createdAt: '2026-04-01T08:30:00.000Z',
    content: '需要把技能索引和记忆分层都接起来。',
  });

  assert.match(entry, /^\- \[\d{2}:\d{2}\] Agent RAG Upgrade · User\(You\):/);
});

test('buildConversationMemoryEntry keeps attachment tool and task signals in daily logs', () => {
  const entry = buildConversationMemoryEntry({
    topicTitle: 'Image Search Debug',
    authorName: 'Quick Assistant',
    role: 'assistant',
    createdAt: '2026-04-01T08:31:00.000Z',
    content: '下一步先检查 image_search 的 tool result，再确认最终决策。',
    attachments: [{ name: 'cute_babe.jpg', sizeBytes: 73 * 1024 }],
    tools: [{ name: 'image_search', status: 'completed', result: 'Found 4 similar images from provider.' }],
  });

  assert.match(entry, /Assistant\(Quick Assistant\)/);
  assert.match(entry, /Attachments: cute_babe\.jpg \(73KB\)/);
  assert.match(entry, /Tools: image_search\[completed\]: Found 4 similar images from provider\./);
  assert.match(entry, /Signals: open_loop/);
  assert.match(entry, /Signals: decision/);
});

test('buildPromotionFingerprint is stable for semantically identical whitespace', () => {
  const left = buildPromotionFingerprint('记住：默认中文输出。');
  const right = buildPromotionFingerprint('记住： 默认中文输出。  ');

  assert.equal(left, right);
});

test('formatLayeredMemoryContext groups documents by tier', () => {
  const documents: MemoryContextDocument[] = [
    {
      id: 'global_pref',
      title: '语言偏好',
      content: '默认使用中文输出。',
      memoryScope: 'global',
      sourceType: 'promotion',
      importanceScore: 5,
      updatedAt: '2026-04-01T08:00:00.000Z',
    },
    {
      id: 'daily_log',
      title: '2026-04-01 Activity Log',
      content: '- [08:30] Agent RAG Upgrade · You: 需要接好记忆分层。',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 3,
      updatedAt: '2026-04-01T08:30:00.000Z',
    },
    {
      id: 'old_log',
      title: '2026-03-10 Activity Log',
      content: '- [09:00] Legacy Topic · You: 旧项目背景。',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 2,
      updatedAt: '2026-03-10T09:00:00.000Z',
    },
  ];

  const context = formatLayeredMemoryContext(documents, { now: '2026-04-01T12:00:00.000Z' });

  assert.match(context, /Long-term memory/);
  assert.match(context, /Recent memory snapshot/);
  assert.match(context, /Hot memory/);
  assert.match(context, /Cold memory/);
});

test('selectEffectiveMemoryDocuments keeps one daily document per date with cold warm source precedence', () => {
  const documents: MemoryContextDocument[] = [
    {
      id: 'daily_hot_source',
      title: '2026-04-19 Daily Log',
      content: 'Hot source detail',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 3,
      updatedAt: '2026-04-19T23:59:59.999Z',
      eventDate: '2026-04-19',
    },
    {
      id: 'daily_hot_warm',
      title: '2026-04-19 Warm Memory',
      content: 'Hot warm detail',
      memoryScope: 'daily',
      sourceType: 'warm_summary',
      importanceScore: 3,
      updatedAt: '2026-04-19T23:59:59.999Z',
      eventDate: '2026-04-19',
    },
    {
      id: 'daily_hot_cold',
      title: '2026-04-19 Cold Memory',
      content: 'Hot cold detail',
      memoryScope: 'daily',
      sourceType: 'cold_summary',
      importanceScore: 3,
      updatedAt: '2026-04-19T23:59:59.999Z',
      eventDate: '2026-04-19',
    },
    {
      id: 'daily_warm_source',
      title: '2026-04-10 Daily Log',
      content: 'Warm source detail',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 3,
      updatedAt: '2026-04-10T23:59:59.999Z',
      eventDate: '2026-04-10',
    },
    {
      id: 'daily_warm_warm',
      title: '2026-04-10 Warm Memory',
      content: 'Warm summary detail',
      memoryScope: 'daily',
      sourceType: 'warm_summary',
      importanceScore: 3,
      updatedAt: '2026-04-10T23:59:59.999Z',
      eventDate: '2026-04-10',
    },
    {
      id: 'daily_warm_cold',
      title: '2026-04-10 Cold Memory',
      content: 'Warm stale cold detail',
      memoryScope: 'daily',
      sourceType: 'cold_summary',
      importanceScore: 3,
      updatedAt: '2026-04-10T23:59:59.999Z',
      eventDate: '2026-04-10',
    },
    {
      id: 'daily_cold_source',
      title: '2026-03-01 Daily Log',
      content: 'Cold source detail',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 3,
      updatedAt: '2026-03-01T23:59:59.999Z',
      eventDate: '2026-03-01',
    },
    {
      id: 'daily_cold_warm',
      title: '2026-03-01 Warm Memory',
      content: 'Cold warm detail',
      memoryScope: 'daily',
      sourceType: 'warm_summary',
      importanceScore: 3,
      updatedAt: '2026-03-01T23:59:59.999Z',
      eventDate: '2026-03-01',
    },
    {
      id: 'daily_cold_cold',
      title: '2026-03-01 Cold Memory',
      content: 'Cold summary detail',
      memoryScope: 'daily',
      sourceType: 'cold_summary',
      importanceScore: 3,
      updatedAt: '2026-03-01T23:59:59.999Z',
      eventDate: '2026-03-01',
    },
    {
      id: 'daily_orphan_cold',
      title: '2026-03-05 Cold Memory',
      content: 'Orphan cold detail',
      memoryScope: 'daily',
      sourceType: 'cold_summary',
      importanceScore: 3,
      updatedAt: '2026-03-05T23:59:59.999Z',
      eventDate: '2026-03-05',
    },
    {
      id: 'global_pref',
      title: 'Language Preference',
      content: 'Default to Chinese.',
      memoryScope: 'global',
      sourceType: 'promotion',
      importanceScore: 5,
      updatedAt: '2026-04-01T07:00:00.000Z',
    },
  ];

  assert.deepEqual(
    selectEffectiveMemoryDocuments(documents, {
      now: '2026-04-20T12:00:00.000Z',
      requireSourceDocument: true,
    }).map((document) => document.id),
    ['daily_hot_source', 'daily_warm_warm', 'daily_cold_cold', 'global_pref'],
  );
});

test('buildMemoryPromotionTitle trims memory cue prefixes', () => {
  assert.equal(buildMemoryPromotionTitle('记住：我默认使用中文输出。'), '我默认使用中文输出。');
});

test('extractOpenMemoryTasks returns recent unresolved work items from hot and warm memory', () => {
  const documents: MemoryContextDocument[] = [
    {
      id: 'daily_hot',
      title: '2026-04-01 Activity Log',
      content: '- [08:30] Agent RAG Upgrade · You: TODO 修复 workspace bootstrap 并补迁移测试。',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 4,
      updatedAt: '2026-04-01T08:30:00.000Z',
    },
    {
      id: 'daily_warm',
      title: '2026-03-28 Activity Log',
      content: '- [10:00] Memory Roadmap · You: 阻塞: 还没做近期记忆快照和未完成任务提取。',
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: 4,
      updatedAt: '2026-03-28T10:00:00.000Z',
    },
    {
      id: 'global_pref',
      title: '语言偏好',
      content: '默认使用中文输出。',
      memoryScope: 'global',
      sourceType: 'promotion',
      importanceScore: 5,
      updatedAt: '2026-04-01T08:00:00.000Z',
    },
  ];

  const tasks = extractOpenMemoryTasks(documents, { now: '2026-04-01T12:00:00.000Z' });

  assert.equal(tasks.length, 2);
  assert.match(tasks[0] ?? '', /TODO 修复 workspace bootstrap/);
  assert.match(tasks[1] ?? '', /阻塞: 还没做近期记忆快照/);
});

test('extractMemoryContentLines skips fenced code blocks entirely', () => {
  const lines = extractMemoryContentLines([
    'Intro',
    '```ts',
    'const internal = "TODO should stay hidden";',
    '```',
    '- [09:00] TODO real item',
  ].join('\n'));

  assert.deepEqual(lines, ['Intro', '[09:00] TODO real item']);
  assert.doesNotMatch(lines.join('\n'), /internal|stay hidden/);
});

test('extractMemoryKeywords filters numeric and timestamp-like noise tokens', () => {
  const keywords = extractMemoryKeywords(
    '- [09:00] TODO 2026-04-01 修复 bootstrap 2 次\n- [10:30] 完成 bootstrap',
    6,
  );

  assert.ok(keywords.includes('bootstrap'));
  assert.ok(keywords.includes('todo'));
  assert.equal(keywords.some((keyword) => /^\d/.test(keyword)), false);
  assert.equal(keywords.some((keyword) => /^(09|00|2026|04|01|10|30)$/.test(keyword)), false);
});

test('resolveLifecycleTier maps dates into hot warm cold windows', () => {
  const now = '2026-04-20T12:00:00.000Z';

  assert.equal(resolveLifecycleTier('2026-04-19', now), 'hot');
  assert.equal(resolveLifecycleTier('2026-04-10', now), 'warm');
  assert.equal(resolveLifecycleTier('2026-03-01', now), 'cold');
});

test('buildWarmMemorySurrogate includes summary key fragments open loops and keywords', () => {
  const markdown = buildWarmMemorySurrogate({
    date: '2026-04-01',
    sourcePath: 'memory/agents/core/daily/2026-04-01.md',
    sourceMarkdown: '- [09:00] TODO 补齐索引\n- [10:00] 已验证 bootstrap 修复',
    now: '2026-04-20T12:00:00.000Z',
    assessment: {
      importanceScore: 5,
      promotionScore: 4.9,
      dimensionScores: {
        compression: 5,
        timeliness: 4,
        connectivity: 5,
        conflictResolution: 5,
        abstraction: 5,
        goldenLabel: 5,
        transferability: 5,
      },
      reason: 'Contains a durable project decision.',
      suggestedRetention: 'warm',
      promoteSignals: ['decision'],
      promotionDecision: {
        shouldPromote: true,
        category: 'workflow_improvements',
        entry: 'Keep durable project decisions in shared memory.',
      },
      validityHint: 'stable',
      conflictStatus: 'latest_consensus',
      knowledgeLinks: ['decisions', 'nightly archive'],
      abstractionLevel: 'principle',
      transferability: 'high',
      goldenLabel: 'validated',
      source: 'llm',
    },
  });

  assert.match(markdown, /tier: "warm"/);
  assert.match(markdown, /importance: 5/);
  assert.match(markdown, /importanceSource: "llm"/);
  assert.match(markdown, /promotionCategory: "workflow_improvements"/);
  assert.match(markdown, /promotionScore: 4.9/);
  assert.match(markdown, /shouldPromote: true/);
  assert.match(markdown, /transferability: "high"/);
  assert.match(markdown, /retentionSuggestion: "warm"/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Open Loops/);
  assert.match(markdown, /TODO 补齐索引/);
});

test('buildColdMemorySurrogate aggressively compresses the source log', () => {
  const warmMarkdown = buildWarmMemorySurrogate({
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] Legacy Topic · You: 旧项目背景。\n- [10:00] TODO 清理遗留状态。',
    now: '2026-04-20T12:00:00.000Z',
  });
  const markdown = buildColdMemorySurrogate({
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] Legacy Topic · You: 旧项目背景。\n- [10:00] TODO 清理遗留状态。',
    now: '2026-04-20T12:00:00.000Z',
    assessment: {
      importanceScore: 4,
      promotionScore: 3.4,
      dimensionScores: {
        compression: 4,
        timeliness: 3,
        connectivity: 3,
        conflictResolution: 3,
        abstraction: 2,
        goldenLabel: 1,
        transferability: 2,
      },
      reason: 'Keeps a relevant archived task.',
      suggestedRetention: 'cold',
      promoteSignals: ['project state'],
      promotionDecision: {
        shouldPromote: false,
        category: 'durable_facts',
        entry: 'Legacy project background and cleanup status.',
      },
      validityHint: 'dated note',
      conflictStatus: 'stable',
      knowledgeLinks: ['legacy project'],
      abstractionLevel: 'concrete',
      transferability: 'low',
      goldenLabel: '',
      source: 'llm',
    },
  });

  assert.match(markdown, /tier: "cold"/);
  assert.match(markdown, /importance: 4/);
  assert.match(markdown, /importanceSource: "llm"/);
  assert.match(markdown, /promotionEntry: "Legacy project background and cleanup status\."/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Keywords/);
  assert.equal(markdown.length < warmMarkdown.length, true);
  assert.doesNotMatch(markdown, /## Key Fragments/);
  assert.doesNotMatch(markdown, /## Open Loops/);
  assert.doesNotMatch(markdown, /## Index/);
});

test('buildWarmMemorySurrogate and buildColdMemorySurrogate are byte-identical for repeated inputs', () => {
  const warmInput = {
    date: '2026-04-01',
    sourcePath: 'memory/agents/core/daily/2026-04-01.md',
    sourceMarkdown: '- [09:00] TODO 补齐索引\n- [10:00] 已验证 bootstrap 修复',
    now: '2026-04-20T12:00:00.000Z',
  };
  const coldInput = {
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] Legacy Topic · You: 旧项目背景。\n- [10:00] TODO 清理遗留状态。',
    now: '2026-04-20T12:00:00.000Z',
  };

  const warmLeft = buildWarmMemorySurrogate(warmInput);
  const warmRight = buildWarmMemorySurrogate(warmInput);
  const coldLeft = buildColdMemorySurrogate(coldInput);
  const coldRight = buildColdMemorySurrogate(coldInput);

  assert.equal(warmLeft, warmRight);
  assert.equal(coldLeft, coldRight);
});
