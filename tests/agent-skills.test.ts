import assert from 'node:assert/strict';
import test from 'node:test';

import localforage from 'localforage';

import { searchKnowledgeDocuments, searchKnowledgeDocumentsWithMetrics, syncKnowledgeDocuments } from '../src/lib/db';
import { getRelevantSkillContext } from '../src/lib/agent-skills';
import { createPathScopedKnowledgeRecord } from '../src/lib/project-knowledge-model';

const localforageState = new Map<string, unknown>();

localforage.getItem = async <T>(key: string) => (localforageState.has(key) ? (localforageState.get(key) as T) : null);
localforage.setItem = async <T>(key: string, value: T) => {
  localforageState.set(key, value);
  return value;
};
localforage.removeItem = async (key: string) => {
  localforageState.delete(key);
};

test('skill search prefers shared and agent-scoped SKILL.md documents within the current agent boundary', async () => {
  localforageState.clear();

  await syncKnowledgeDocuments(
    [
      createPathScopedKnowledgeRecord(
        'project',
        'skills/systematic-debugging/SKILL.md',
        '# Shared Skill\n\nWhen debugging sqlite bootstrap issues, reproduce first.',
      ),
      createPathScopedKnowledgeRecord(
        'agent_skill',
        'memory/agents/core/skills/sqlite-triage/SKILL.md',
        '# Agent Skill\n\nFor core agent sqlite triage, inspect legacy schema columns.',
      ),
      createPathScopedKnowledgeRecord(
        'agent_skill',
        'memory/agents/other/skills/deploy/SKILL.md',
        '# Other Agent Skill\n\nDeploy production builds with a release checklist.',
      ),
      createPathScopedKnowledgeRecord('project', 'docs/notes.md', '# Note\n\nGeneral workspace note.'),
    ],
    { skipEmbeddings: true },
  );

  const filtered = await searchKnowledgeDocuments('sqlite schema debugging', {
    maxResults: 5,
    sourceTypes: ['skill_doc'],
    sourceUriPrefixes: ['memory/agents/core/skills', 'skills/'],
  });
  assert.deepEqual(new Set(filtered.map((record) => record.sourceUri)), new Set([
    'memory/agents/core/skills/sqlite-triage/SKILL.md',
    'skills/systematic-debugging/SKILL.md',
  ]));

  const context = await getRelevantSkillContext('core', 'sqlite schema debugging');
  assert.ok(
    context.indexOf('memory/agents/core/skills/sqlite-triage/SKILL.md') <
      context.indexOf('skills/systematic-debugging/SKILL.md'),
  );
  assert.match(context, /\[agent\] memory\/agents\/core\/skills\/sqlite-triage\/SKILL\.md/);
  assert.match(context, /\[shared\] skills\/systematic-debugging\/SKILL\.md/);
  assert.doesNotMatch(context, /memory\/agents\/other\/skills\/deploy\/SKILL\.md/);
  assert.doesNotMatch(context, /docs\/notes\.md/);
});

test('searchKnowledgeDocumentsWithMetrics reports cache hits on repeated agent skill queries', async () => {
  localforageState.clear();

  await syncKnowledgeDocuments(
    [
      createPathScopedKnowledgeRecord(
        'project',
        'skills/systematic-debugging/SKILL.md',
        '# Shared Skill\n\nWhen debugging sqlite bootstrap issues, reproduce first.',
      ),
      createPathScopedKnowledgeRecord(
        'agent_skill',
        'memory/agents/core/skills/sqlite-triage/SKILL.md',
        '# Agent Skill\n\nFor core agent sqlite triage, inspect legacy schema columns.',
      ),
    ],
    { skipEmbeddings: true },
  );

  const first = await searchKnowledgeDocumentsWithMetrics('sqlite schema debugging', {
    maxResults: 5,
    sourceTypes: ['skill_doc'],
    sourceUriPrefixes: ['memory/agents/core/skills', 'skills/'],
  });
  const second = await searchKnowledgeDocumentsWithMetrics('sqlite schema debugging', {
    maxResults: 5,
    sourceTypes: ['skill_doc'],
    sourceUriPrefixes: ['memory/agents/core/skills', 'skills/'],
  });

  assert.equal(first.metrics.cacheHit, false);
  assert.equal(first.results.length > 0, true);
  assert.equal(first.metrics.subqueryCount > 0, true);
  assert.equal(first.metrics.totalDurationMs >= 0, true);
  assert.equal(second.metrics.cacheHit, true);
  assert.deepEqual(
    second.results.map((record) => record.sourceUri),
    first.results.map((record) => record.sourceUri),
  );
});
