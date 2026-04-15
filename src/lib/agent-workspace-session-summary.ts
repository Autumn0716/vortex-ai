import { estimateMessageTokens, splitBudgetedRecentItems } from './session-context-budget';
import type { TopicMessage } from './agent-workspace-types';

function formatSessionSummaryLine(message: TopicMessage) {
  const label = message.role === 'user' ? 'User' : 'Assistant';
  const attachmentSuffix =
    message.attachments && message.attachments.length > 0
      ? ` [attachments:${message.attachments.length}]`
      : '';
  const toolSuffix =
    message.tools && message.tools.length > 0
      ? ` [tools:${message.tools
          .map((tool) => tool.name)
          .filter(Boolean)
          .join(', ')
          .slice(0, 80)}]`
      : '';
  return `- ${label}${attachmentSuffix}${toolSuffix}: ${message.content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)}`;
}

function extractSessionOpenLoops(messages: TopicMessage[]) {
  const loopPattern = /(todo|待办|next step|follow up|继续|阻塞|blocked|需要|remember|记住|后续)/i;
  return messages
    .filter((message) => loopPattern.test(message.content))
    .slice(-4)
    .map((message) => `- ${message.content.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
}

export function buildTopicSessionSummary(messages: TopicMessage[], historyWindow: number, tokenBudget?: number) {
  const dialogueMessages = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant',
  );
  const { summarySourceItems: olderMessages } = splitBudgetedRecentItems<TopicMessage>(dialogueMessages, {
    maxItems: Math.max(0, historyWindow),
    tokenBudget,
    estimateTokens: estimateMessageTokens,
  });

  if (olderMessages.length <= 6) {
    return null;
  }

  const userHighlights = olderMessages.filter((message) => message.role === 'user').slice(-4);
  const assistantHighlights = olderMessages.filter((message) => message.role === 'assistant').slice(-4);
  const openLoops = extractSessionOpenLoops(olderMessages);

  const content = [
    `Compressed summary from ${olderMessages.length} earlier turns. Keep this as background context and rely on the recent raw messages for exact wording.`,
    userHighlights.length
      ? `Earlier user requests:\n${userHighlights.map(formatSessionSummaryLine).join('\n')}`
      : '',
    assistantHighlights.length
      ? `Earlier assistant outputs:\n${assistantHighlights.map(formatSessionSummaryLine).join('\n')}`
      : '',
    openLoops.length ? `Open loops:\n${openLoops.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2200);

  return {
    content,
    sourceMessageCount: dialogueMessages.length,
  };
}
