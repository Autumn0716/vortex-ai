import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateMessageTokens,
  estimateSessionContextTokens,
  estimateTextTokens,
  splitBudgetedRecentItems,
} from '../src/lib/session-context-budget';

test('splitBudgetedRecentItems keeps window behavior when budget is large', () => {
  const items = ['old one', 'old two', 'recent three', 'recent four'];
  const result = splitBudgetedRecentItems(items, {
    maxItems: 2,
    tokenBudget: 1000,
    estimateTokens: estimateTextTokens,
  });

  assert.deepEqual(result.summarySourceItems, ['old one', 'old two']);
  assert.deepEqual(result.liveItems, ['recent three', 'recent four']);
});

test('splitBudgetedRecentItems moves overflowed live messages into summary source', () => {
  const items = ['first old message', 'second old message', 'third recent message', 'fourth recent message'];
  const result = splitBudgetedRecentItems(items, {
    maxItems: 4,
    tokenBudget: estimateTextTokens('fourth recent message') + 1,
    estimateTokens: estimateTextTokens,
  });

  assert.deepEqual(result.liveItems, ['fourth recent message']);
  assert.deepEqual(result.summarySourceItems, ['first old message', 'second old message', 'third recent message']);
});

test('estimateMessageTokens includes attachments and tools for shared context boundaries', () => {
  const items = [
    { role: 'user', content: 'first old message' },
    { role: 'assistant', content: 'second old message' },
    {
      role: 'user',
      content: 'third image message',
      attachments: [{ name: 'diagram.png', mimeType: 'image/png', dataUrl: 'x'.repeat(12_000) }],
    },
    {
      role: 'assistant',
      content: 'fourth tool message',
      tools: [{ name: 'search_knowledge_base', status: 'completed', result: 'tool result '.repeat(80) }],
    },
  ];
  const result = splitBudgetedRecentItems(items, {
    maxItems: 4,
    tokenBudget: estimateMessageTokens(items[3]) + 1,
    estimateTokens: estimateMessageTokens,
  });

  assert.deepEqual(result.liveItems, [items[3]]);
  assert.deepEqual(result.summarySourceItems, [items[0], items[1], items[2]]);
});

test('estimateSessionContextTokens reports per-section totals for context observability', () => {
  const messages = [
    { role: 'user', content: '第一条用户消息' },
    {
      role: 'assistant',
      content: '第二条助手消息',
      tools: [{ name: 'search_knowledge_base', status: 'completed', result: '检索到一条相关知识。' }],
    },
  ];
  const breakdown = estimateSessionContextTokens({
    systemPrompt: 'You are FlowAgent.',
    sessionSummary: '已完成前置总结。',
    runtimeSystemPrompt: '请优先引用证据。',
    toolContext: 'tools: search_knowledge_base, web_search',
    messages,
  });

  assert.equal(breakdown.systemPromptTokens, estimateTextTokens('You are FlowAgent.'));
  assert.equal(breakdown.sessionSummaryTokens, estimateTextTokens('已完成前置总结。'));
  assert.equal(breakdown.runtimeSystemPromptTokens, estimateTextTokens('请优先引用证据。'));
  assert.equal(
    breakdown.toolContextTokens,
    estimateTextTokens('tools: search_knowledge_base, web_search'),
  );
  assert.equal(
    breakdown.messageTokens,
    estimateMessageTokens(messages[0]) + estimateMessageTokens(messages[1]),
  );
  assert.equal(
    breakdown.totalTokens,
    breakdown.systemPromptTokens +
      breakdown.sessionSummaryTokens +
      breakdown.runtimeSystemPromptTokens +
      breakdown.toolContextTokens +
      breakdown.messageTokens,
  );
});
