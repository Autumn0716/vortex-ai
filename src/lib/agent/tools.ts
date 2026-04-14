import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  searchKnowledgeDocuments,
  type KnowledgeDocumentSearchResult,
} from '../db';
import type { AgentConfig, SearchProviderConfig } from './config';
import { runSnippetInSandbox } from '../webcontainer';
import { err, isErr, ok, type Result } from '../result';

export function formatKnowledgeBaseToolPayload(results: KnowledgeDocumentSearchResult[]) {
  const supportCounts = results.reduce(
    (counts, result) => {
      const label = result.supportLabel ?? 'unknown';
      counts[label] += 1;
      return counts;
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    } satisfies Record<'high' | 'medium' | 'low' | 'unknown', number>,
  );

  const strongestSupport =
    supportCounts.high > 0 ? 'high' : supportCounts.medium > 0 ? 'medium' : supportCounts.low > 0 ? 'low' : 'unknown';
  const recommendation =
    strongestSupport === 'high'
      ? 'answer_with_citations'
      : strongestSupport === 'medium'
        ? 'answer_carefully'
        : 'request_more_evidence';

  return {
    evidence: {
      totalResults: results.length,
      supportCounts,
      strongestSupport,
      recommendation,
    },
    results: results.map((result) => ({
      id: result.id,
      title: result.title,
      sourceType: result.sourceType,
      sourceUri: result.sourceUri,
      tags: result.tags,
      content: result.content,
      retrievalStage: result.retrievalStage ?? 'primary',
      support: {
        label: result.supportLabel ?? 'unknown',
        score: result.supportScore ?? 0,
        matchedTerms: result.matchedTerms ?? [],
      },
      graph: {
        directHints: result.graphHints ?? [],
        expansionHints: result.graphExpansionHints ?? [],
        paths: result.graphPaths ?? [],
      },
    })),
  };
}

export const searchKnowledgeBaseTool = tool(
  async ({ query }) => {
    try {
      const results = await searchKnowledgeDocuments(query, { maxResults: 5 });
      if (results.length === 0) {
        return 'No relevant documents found in the local SQLite knowledge base.';
      }
      return JSON.stringify(formatKnowledgeBaseToolPayload(results), null, 2);
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

function resolveSearchProvider(config: AgentConfig, providerId?: string) {
  const candidates = config.search.providers;
  const selected =
    candidates.find((provider) => provider.id === providerId) ??
    candidates.find((provider) => provider.id === config.search.defaultProviderId) ??
    null;

  return selected?.enabled ? selected : null;
}

async function performTavilySearch(provider: SearchProviderConfig, query: string) {
  if (!provider.apiKey.trim()) {
    throw new Error(`${provider.name} API Key 缺失。请先在 Settings -> Search 中配置。`);
  }

  const payloadResult = await requestSearchProviderPayload(
    `${provider.baseUrl?.replace(/\/+$/, '') ?? 'https://api.tavily.com'}/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: provider.apiKey.trim(),
        query,
        max_results: 5,
        search_depth: 'advanced',
        include_answer: true,
      }),
    },
    (payload, status) =>
      payload && typeof payload === 'object' && 'detail' in payload
        ? String(payload.detail)
        : `Tavily request failed with HTTP ${status}.`,
  );
  if (isErr(payloadResult)) {
    throw payloadResult.error;
  }

  const payload = payloadResult.value;
  return {
    provider: provider.name,
    answer:
      payload && typeof payload === 'object' && 'answer' in payload ? String(payload.answer ?? '') : '',
    results:
      payload && typeof payload === 'object' && Array.isArray(payload.results)
        ? payload.results.map((entry: any) => ({
            title: String(entry?.title ?? ''),
            url: String(entry?.url ?? ''),
            content: String(entry?.content ?? ''),
            score: typeof entry?.score === 'number' ? entry.score : undefined,
          }))
        : [],
  };
}

async function requestSearchProviderPayload(
  url: string,
  init: RequestInit,
  readFailureMessage: (payload: unknown, status: number) => string,
): Promise<Result<any, Error>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(new Error(detail));
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return err(new Error(readFailureMessage(payload, response.status)));
  }

  return ok(payload);
}

async function performExaSearch(provider: SearchProviderConfig, query: string) {
  if (!provider.apiKey.trim()) {
    throw new Error(`${provider.name} API Key 缺失。请先在 Settings -> Search 中配置。`);
  }

  const payloadResult = await requestSearchProviderPayload(
    `${provider.baseUrl?.replace(/\/+$/, '') ?? 'https://api.exa.ai'}/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey.trim(),
      },
      body: JSON.stringify({
        query,
        numResults: 5,
        type: 'auto',
        contents: {
          text: true,
        },
      }),
    },
    (payload, status) =>
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `Exa request failed with HTTP ${status}.`,
  );
  if (isErr(payloadResult)) {
    throw payloadResult.error;
  }

  const payload = payloadResult.value;
  return {
    provider: provider.name,
    answer: '',
    results:
      payload && typeof payload === 'object' && Array.isArray(payload.results)
        ? payload.results.map((entry: any) => ({
            title: String(entry?.title ?? ''),
            url: String(entry?.url ?? ''),
            content: String(entry?.text ?? entry?.highlights?.join(' ') ?? ''),
            score: typeof entry?.score === 'number' ? entry.score : undefined,
          }))
        : [],
  };
}

export function createWebSearchTool(config: AgentConfig, providerId?: string) {
  const provider = resolveSearchProvider(config, providerId);
  if (!provider) {
    return null;
  }

  return tool(
    async ({ query }) => {
      try {
        if (provider.type === 'tavily') {
          return JSON.stringify(await performTavilySearch(provider, query), null, 2);
        }
        if (provider.type === 'exa') {
          return JSON.stringify(await performExaSearch(provider, query), null, 2);
        }

        if (provider.category === 'local') {
          return JSON.stringify(
            {
              provider: provider.name,
              error: `${provider.name} 当前仅预留为本地搜索入口，尚未接入自动抓取。`,
              homepage: provider.homepage ?? provider.baseUrl ?? '',
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            provider: provider.name,
            error: `${provider.name} 尚未实现自动联网搜索适配。`,
          },
          null,
          2,
        );
      } catch (error: any) {
        return `Error searching the web with ${provider.name}: ${error.message}`;
      }
    },
    {
      name: 'search_web',
      description: `Search the live web with ${provider.name}. Use this when the user needs up-to-date information beyond the local knowledge base.`,
      schema: z.object({
        query: z.string().describe('The live web search query.'),
      }),
    },
  );
}

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

export function createAgentTools(config: AgentConfig, options?: { webSearchEnabled?: boolean; searchProviderId?: string }) {
  const tools: any[] = [searchKnowledgeBaseTool];
  if (options?.webSearchEnabled) {
    const webSearchTool = createWebSearchTool(config, options.searchProviderId);
    if (webSearchTool) {
      tools.push(webSearchTool);
    }
  }
  tools.push(executeCodeTool);
  return tools;
}
