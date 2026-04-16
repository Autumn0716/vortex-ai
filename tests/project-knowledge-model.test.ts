import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodeKnowledgeContent,
  createProjectKnowledgeRecord,
  isProjectKnowledgePath,
} from '../src/lib/project-knowledge-model';

test('project knowledge accepts src code files as managed knowledge paths', () => {
  assert.equal(isProjectKnowledgePath('src/lib/example.ts'), true);
  assert.equal(isProjectKnowledgePath('src/components/View.tsx'), true);
  assert.equal(isProjectKnowledgePath('src/tools/parser.py'), true);
  assert.equal(isProjectKnowledgePath('src/server/worker.go'), true);
  assert.equal(isProjectKnowledgePath('server/api-server.ts'), false);
  assert.equal(isProjectKnowledgePath('src/styles.css'), false);
});

test('buildCodeKnowledgeContent extracts symbols imports and preview', () => {
  const content = [
    "import { readFile } from 'node:fs/promises';",
    'export interface UserRecord { id: string }',
    'export async function loadUser(id: string) {',
    '  return readFile(id, "utf8");',
    '}',
    'const localOnly = true;',
  ].join('\n');

  const indexed = buildCodeKnowledgeContent('src/lib/users.ts', content);

  assert.match(indexed, /# Code Index: src\/lib\/users\.ts/);
  assert.match(indexed, /Language: TypeScript/);
  assert.match(indexed, /L1: import \{ readFile \}/);
  assert.match(indexed, /L2: export interface UserRecord/);
  assert.match(indexed, /L3: export async function loadUser/);
});

test('createProjectKnowledgeRecord classifies src code as code_doc', () => {
  const record = createProjectKnowledgeRecord(
    'src/lib/users.ts',
    'export function loadUser(id: string) { return id; }',
    { syncedAt: '2026-04-16T00:00:00.000Z' },
  );

  assert.equal(record.sourceType, 'code_doc');
  assert.equal(record.sourceUri, 'src/lib/users.ts');
  assert.deepEqual(record.tags, ['code', 'knowledge', 'typescript', 'workspace']);
  assert.match(record.content, /Code Index/);
  assert.match(record.content, /loadUser/);
});
