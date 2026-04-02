import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchKnowledgeDocuments } from '../db';
import { runSnippetInSandbox } from '../webcontainer';

export const searchKnowledgeBaseTool = tool(
  async ({ query }) => {
    try {
      const results = await searchKnowledgeDocuments(query, { maxResults: 5 });
      if (results.length === 0) {
        return 'No relevant documents found in the local SQLite knowledge base.';
      }
      return JSON.stringify(results, null, 2);
    } catch (error: any) {
      return `Error searching database: ${error.message}`;
    }
  },
  {
    name: 'search_knowledge_base',
    description:
      'Search the local SQLite knowledge base for information, including project docs and SKILL.md-based local skills.',
    schema: z.object({
      query: z.string().describe('The search query to look up in the database.'),
    }),
  },
);

export const executeCodeTool = tool(
  async ({ code, language }) => {
    try {
      const result = await runSnippetInSandbox({ code, language });
      return JSON.stringify(
        {
          command: result.command,
          exitCode: result.exitCode,
          output: result.output || '(no output)',
        },
        null,
        2,
      );
    } catch (error: any) {
      return `Sandbox execution failed: ${error.message}`;
    }
  },
  {
    name: 'execute_code',
    description:
      'Execute javascript/typescript or bash/sh code in the WebContainer sandbox. Use this to run quick scripts, inspect output, or verify implementation ideas.',
    schema: z.object({
      code: z.string().describe('The code to execute.'),
      language: z
        .string()
        .describe("The execution language. Supported values include 'javascript', 'typescript', 'bash', and 'sh'."),
    }),
  },
);

export const agentTools = [searchKnowledgeBaseTool, executeCodeTool];
