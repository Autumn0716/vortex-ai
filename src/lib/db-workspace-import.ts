import { getDocumentFtsEnabled, indexDocumentChunks } from './db-document-indexing';
import { seedAssistants, seedPromptSnippets } from './db-bootstrap';
import { Database } from './db-core';
import { getScalar } from './db-row-helpers';
import { runDatabaseTransaction } from './db-transaction';
import type {
  AssistantProfile,
  ConversationSummary,
  ConversationWorkspace,
  GlobalMemoryDocument,
  PromptSnippet,
} from './db-types';

export async function importWorkspaceDataIntoDatabase(
  database: Database,
  payload: {
    conversations?: ConversationSummary[];
    assistants?: AssistantProfile[];
    snippets?: PromptSnippet[];
    documents?: { id: string; title: string; content: string }[];
    globalMemoryDocuments?: GlobalMemoryDocument[];
    workspaces?: ConversationWorkspace[];
  },
): Promise<{ preferredConversationId: string | null; shouldSeedConversation: boolean }> {
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces.filter(Boolean) : [];
  const assistants = Array.isArray(payload.assistants) ? payload.assistants : [];
  const snippets = Array.isArray(payload.snippets) ? payload.snippets : [];
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const globalMemoryDocuments = Array.isArray(payload.globalMemoryDocuments)
    ? payload.globalMemoryDocuments
    : [];
  let shouldSeedConversation = false;

  await runDatabaseTransaction(database, async () => {
    [
      'messages',
      'chat_messages',
      'agent_lanes',
      'conversations',
      'assistants',
      'prompt_snippets',
      'documents',
      'document_chunks',
      'document_chunk_embeddings',
      'document_search_cache',
      'document_metadata',
      'global_memory_documents',
    ].forEach((table) => {
      database.run(`DELETE FROM ${table}`);
    });

    if (getDocumentFtsEnabled(database)) {
      database.run('DELETE FROM document_chunks_fts');
    }

    assistants.forEach((assistant) => {
      database.run(
        `
          INSERT INTO assistants (
            id,
            name,
            description,
            system_prompt,
            provider_id,
            model,
            accent_color,
            is_default,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          assistant.id,
          assistant.name,
          assistant.description,
          assistant.systemPrompt,
          assistant.providerId ?? null,
          assistant.model ?? null,
          assistant.accentColor,
          assistant.isDefault ? 1 : 0,
          assistant.createdAt,
          assistant.updatedAt,
        ],
      );
    });

    snippets.forEach((snippet) => {
      database.run(
        `
          INSERT INTO prompt_snippets (
            id,
            title,
            content,
            category,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          snippet.id,
          snippet.title,
          snippet.content,
          snippet.category,
          snippet.createdAt,
          snippet.updatedAt,
        ],
      );
    });

    documents.forEach((document) => {
      database.run('INSERT INTO documents (id, title, content) VALUES (?, ?, ?)', [
        document.id,
        document.title,
        document.content,
      ]);
      indexDocumentChunks(database, document);
    });

    globalMemoryDocuments.forEach((document) => {
      database.run(
        `
          INSERT INTO global_memory_documents (
            id,
            title,
            content,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [document.id, document.title, document.content, document.createdAt, document.updatedAt],
      );
    });

    workspaces.forEach((workspace) => {
      database.run(
        `
          INSERT INTO conversations (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        [
          workspace.conversation.id,
          workspace.conversation.title,
          workspace.conversation.createdAt,
          workspace.conversation.updatedAt,
        ],
      );

      workspace.lanes.forEach((lane) => {
        database.run(
          `
            INSERT INTO agent_lanes (
              id,
              conversation_id,
              assistant_id,
              name,
              description,
              system_prompt,
              provider_id,
              model,
              accent_color,
              position,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            lane.id,
            lane.conversationId,
            lane.assistantId,
            lane.name,
            lane.description,
            lane.systemPrompt,
            lane.providerId ?? null,
            lane.model ?? null,
            lane.accentColor,
            lane.position,
            lane.createdAt,
            lane.updatedAt,
          ],
        );
      });

      Object.values(workspace.messagesByLane)
        .flat()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .forEach((message) => {
          database.run(
            `
              INSERT INTO chat_messages (
                id,
                conversation_id,
                lane_id,
                role,
                author_name,
                content,
                tools_json,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              message.id,
              message.conversationId,
              message.laneId,
              message.role,
              message.authorName,
              message.content,
              message.tools ? JSON.stringify(message.tools) : null,
              message.createdAt,
            ],
          );
        });
    });

    if (assistants.length === 0) {
      await seedAssistants(database);
    }

    if (snippets.length === 0) {
      await seedPromptSnippets(database);
    }

    const conversationCount = Number(getScalar(database, 'SELECT COUNT(*) FROM conversations') ?? 0);
    shouldSeedConversation = conversationCount === 0;
  });

  return {
    preferredConversationId:
      workspaces[0]?.conversation.id ??
      (payload.conversations?.[0] ? payload.conversations[0].id : null),
    shouldSeedConversation,
  };
}
