export function estimateTextTokens(input: string) {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 0;
  }

  const cjkCount = (normalized.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinWordCount = normalized
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean).length;
  const punctuationCount = (normalized.match(/[^\w\s\u4e00-\u9fff]/g) ?? []).length;
  return Math.max(1, Math.round(cjkCount + latinWordCount + punctuationCount * 0.35));
}

export interface TokenEstimateMessage {
  role: string;
  content: string;
  attachments?: Array<{
    name?: string;
    mimeType?: string;
    dataUrl?: string;
  }>;
  tools?: Array<{
    name: string;
    status?: string;
    result?: string;
  }>;
}

export function estimateAttachmentTokens(attachment: { dataUrl?: string }) {
  return Math.max(256, Math.min(2000, Math.round((attachment.dataUrl?.length ?? 0) / 24)));
}

export function stringifyMessageForTokenEstimate(message: TokenEstimateMessage) {
  const attachmentSummary = message.attachments?.length
    ? message.attachments
        .map((attachment) => {
          const estimatedImageTokens = estimateAttachmentTokens(attachment);
          return `[image:${attachment.name || attachment.mimeType || 'attachment'} ~${estimatedImageTokens} tokens]`;
        })
        .join(' ')
    : '';
  const toolSummary = message.tools?.length
    ? message.tools
        .map((tool) => {
          const resultPreview = tool.result ? ` ${tool.result.replace(/\s+/g, ' ').slice(0, 240)}` : '';
          return `[tool:${tool.name}${tool.status ? ` ${tool.status}` : ''}${resultPreview}]`;
        })
        .join(' ')
    : '';
  return [message.role.toUpperCase(), message.content, attachmentSummary, toolSummary]
    .filter(Boolean)
    .join(' ');
}

export function estimateMessageTokens(message: TokenEstimateMessage) {
  return estimateTextTokens(stringifyMessageForTokenEstimate(message));
}

export interface SessionContextTokenBreakdown {
  systemPromptTokens: number;
  sessionSummaryTokens: number;
  runtimeSystemPromptTokens: number;
  toolContextTokens: number;
  messageTokens: number;
  totalTokens: number;
}

export function estimateSessionContextTokens(input: {
  systemPrompt?: string;
  sessionSummary?: string;
  runtimeSystemPrompt?: string;
  toolContext?: string;
  messages?: TokenEstimateMessage[];
}): SessionContextTokenBreakdown {
  const systemPromptTokens = estimateTextTokens(input.systemPrompt ?? '');
  const sessionSummaryTokens = estimateTextTokens(input.sessionSummary ?? '');
  const runtimeSystemPromptTokens = estimateTextTokens(input.runtimeSystemPrompt ?? '');
  const toolContextTokens = estimateTextTokens(input.toolContext ?? '');
  const messageTokens = (input.messages ?? []).reduce((total, message) => total + estimateMessageTokens(message), 0);
  return {
    systemPromptTokens,
    sessionSummaryTokens,
    runtimeSystemPromptTokens,
    toolContextTokens,
    messageTokens,
    totalTokens:
      systemPromptTokens +
      sessionSummaryTokens +
      runtimeSystemPromptTokens +
      toolContextTokens +
      messageTokens,
  };
}

export function selectBudgetedRecentItems<T>(
  items: T[],
  options: {
    maxItems: number;
    tokenBudget?: number;
    estimateTokens: (item: T) => number;
  },
) {
  const windowedItems = items.slice(-Math.max(0, options.maxItems));
  if (!options.tokenBudget || options.tokenBudget <= 0) {
    return windowedItems;
  }

  const selected: T[] = [];
  let usedTokens = 0;
  for (const item of [...windowedItems].reverse()) {
    const itemTokens = Math.max(0, options.estimateTokens(item));
    if (selected.length > 0 && usedTokens + itemTokens > options.tokenBudget) {
      break;
    }
    selected.push(item);
    usedTokens += itemTokens;
  }

  return selected.reverse();
}

export function splitBudgetedRecentItems<T>(
  items: T[],
  options: {
    maxItems: number;
    tokenBudget?: number;
    estimateTokens: (item: T) => number;
  },
) {
  const liveItems = selectBudgetedRecentItems(items, options);
  return {
    summarySourceItems: items.slice(0, Math.max(0, items.length - liveItems.length)),
    liveItems,
  };
}
