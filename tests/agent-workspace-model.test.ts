import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentWorkspacePath,
  buildMigratedTopicTitle,
  formatTopicPreview,
} from '../src/lib/agent-workspace-model';

test('buildAgentWorkspacePath sanitizes agent names', () => {
  assert.equal(buildAgentWorkspacePath('Build Operator'), 'agents/build-operator');
  assert.equal(buildAgentWorkspacePath('  研究 Agent  '), 'agents/agent');
});

test('buildMigratedTopicTitle appends the agent name when multiple lanes existed', () => {
  assert.equal(
    buildMigratedTopicTitle('Launch Plan', 'Research Scout', true),
    'Launch Plan · Research Scout',
  );
  assert.equal(
    buildMigratedTopicTitle('Launch Plan', 'Research Scout', false),
    'Launch Plan',
  );
});

test('formatTopicPreview collapses whitespace and falls back when empty', () => {
  assert.equal(formatTopicPreview(' hello \n\n world '), 'hello world');
  assert.equal(formatTopicPreview('   '), 'No messages yet');
});
