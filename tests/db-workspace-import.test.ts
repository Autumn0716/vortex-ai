import assert from 'node:assert/strict';
import test from 'node:test';
import localforage from 'localforage';

import { getConversationWorkspace, importWorkspaceData, listAssistants } from '../src/lib/db';

const localforageState = new Map<string, unknown>();

localforage.getItem = async <T>(key: string) => (localforageState.has(key) ? (localforageState.get(key) as T) : null);
localforage.setItem = async <T>(key: string, value: T) => {
  localforageState.set(key, value);
  return value;
};
localforage.removeItem = async (key: string) => {
  localforageState.delete(key);
};
localforage.clear = async () => {
  localforageState.clear();
};

test('importWorkspaceData preserves imported assistants and conversation messages', async () => {
  localforageState.clear();

  await importWorkspaceData({
    assistants: [
      {
        id: 'assistant_imported',
        name: 'Imported Assistant',
        description: 'Imported from test payload.',
        systemPrompt: 'Answer precisely.',
        providerId: 'openai',
        model: 'gpt-4.1',
        accentColor: 'from-sky-500/20 to-cyan-500/20',
        isDefault: true,
        createdAt: '2026-04-14T10:00:00.000Z',
        updatedAt: '2026-04-14T10:00:00.000Z',
      },
    ],
    workspaces: [
      {
        conversation: {
          id: 'conversation_imported',
          title: 'Imported Conversation',
          createdAt: '2026-04-14T10:00:00.000Z',
          updatedAt: '2026-04-14T10:05:00.000Z',
          lastMessageAt: '2026-04-14T10:05:00.000Z',
          preview: 'Imported assistant reply.',
          laneCount: 1,
        },
        lanes: [
          {
            id: 'lane_imported',
            conversationId: 'conversation_imported',
            assistantId: 'assistant_imported',
            name: 'Imported Assistant',
            description: 'Imported from test payload.',
            systemPrompt: 'Answer precisely.',
            providerId: 'openai',
            model: 'gpt-4.1',
            accentColor: 'from-sky-500/20 to-cyan-500/20',
            position: 0,
            createdAt: '2026-04-14T10:00:00.000Z',
            updatedAt: '2026-04-14T10:00:00.000Z',
          },
        ],
        messagesByLane: {
          lane_imported: [
            {
              id: 'message_imported_user',
              conversationId: 'conversation_imported',
              laneId: 'lane_imported',
              role: 'user',
              authorName: 'You',
              content: 'Imported question.',
              createdAt: '2026-04-14T10:01:00.000Z',
            },
            {
              id: 'message_imported_assistant',
              conversationId: 'conversation_imported',
              laneId: 'lane_imported',
              role: 'assistant',
              authorName: 'Imported Assistant',
              content: 'Imported assistant reply.',
              createdAt: '2026-04-14T10:05:00.000Z',
            },
          ],
        },
      },
    ],
  });

  const assistants = await listAssistants();
  const workspace = await getConversationWorkspace('conversation_imported');

  assert.equal(assistants.some((assistant) => assistant.id === 'assistant_imported'), true);
  assert.equal(workspace?.conversation.title, 'Imported Conversation');
  assert.equal(workspace?.lanes[0]?.assistantId, 'assistant_imported');
  assert.deepEqual(
    workspace?.messagesByLane.lane_imported.map((message) => message.content),
    ['Imported question.', 'Imported assistant reply.'],
  );
});
