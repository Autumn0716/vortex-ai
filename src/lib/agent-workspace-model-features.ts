import type { TopicModelFeatures } from './agent-workspace-types';

export function getDefaultTopicModelFeatures(): TopicModelFeatures {
  return {
    enableThinking: false,
    enableCustomFunctionCalling: false,
    responsesTools: {
      webSearch: false,
      webSearchImage: false,
      webExtractor: false,
      codeInterpreter: false,
      imageSearch: false,
      mcp: false,
    },
    structuredOutput: {
      mode: 'text',
      schema:
        '{\n  "name": "answer_payload",\n  "schema": {\n    "type": "object",\n    "properties": {\n      "answer": { "type": "string" }\n    },\n    "required": ["answer"]\n  }\n}',
    },
  };
}

export function normalizeTopicModelFeatures(value?: Partial<TopicModelFeatures> | null): TopicModelFeatures {
  const defaults = getDefaultTopicModelFeatures();
  return {
    enableThinking: Boolean(value?.enableThinking),
    enableCustomFunctionCalling: Boolean(value?.enableCustomFunctionCalling),
    responsesTools: {
      webSearch: Boolean(value?.responsesTools?.webSearch),
      webSearchImage: Boolean(value?.responsesTools?.webSearchImage),
      webExtractor: Boolean(value?.responsesTools?.webExtractor),
      codeInterpreter: Boolean(value?.responsesTools?.codeInterpreter),
      imageSearch: Boolean(value?.responsesTools?.imageSearch),
      mcp: Boolean(value?.responsesTools?.mcp),
    },
    structuredOutput: {
      mode:
        value?.structuredOutput?.mode === 'json_object' || value?.structuredOutput?.mode === 'json_schema'
          ? value.structuredOutput.mode
          : defaults.structuredOutput.mode,
      schema:
        typeof value?.structuredOutput?.schema === 'string' && value.structuredOutput.schema.trim()
          ? value.structuredOutput.schema
          : defaults.structuredOutput.schema,
    },
  };
}

export function formatJsonPreview(raw: unknown) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function warnJsonFallback(context: string, raw: unknown, error: unknown) {
  console.warn(`Failed to parse ${context}; falling back to defaults: ${formatJsonPreview(raw)}`, error);
}

export function parseTopicModelFeatures(raw: unknown): TopicModelFeatures {
  if (typeof raw !== 'string' || !raw.trim()) {
    return getDefaultTopicModelFeatures();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TopicModelFeatures>;
    return normalizeTopicModelFeatures(parsed);
  } catch (error) {
    warnJsonFallback('topic model features', raw, error);
    return getDefaultTopicModelFeatures();
  }
}
