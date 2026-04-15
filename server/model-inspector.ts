export interface ModelInspectorSource {
  label: string;
  url: string;
}

export interface ModelInspectorResult {
  providerName: string;
  model: string;
  resolverVersion?: number;
  versionLabel?: string;
  modeLabel?: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxInputCharacters?: number;
  longestReasoningTokens?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  pricingNote?: string;
  excerpt?: string;
  sources: ModelInspectorSource[];
  fetchedAt: string;
}

type ExtractedModelMetadata = Pick<
  ModelInspectorResult,
  | 'resolverVersion'
  | 'versionLabel'
  | 'modeLabel'
  | 'contextWindow'
  | 'maxInputTokens'
  | 'maxInputCharacters'
  | 'longestReasoningTokens'
  | 'maxOutputTokens'
  | 'inputCostPerMillion'
  | 'outputCostPerMillion'
  | 'pricingNote'
>;

export const MODEL_INSPECTOR_RESOLVER_VERSION = 3;

function normalizeModelName(model: string) {
  return model.trim().toLowerCase();
}

function stripHtml(input: string) {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&le;/g, '≤')
    .replace(/&ge;/g, '≥')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberToken(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/,/g, '').trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function parseCurrencyToken(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/[$元人民币\/\s,]/g, '').trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQwenTieredPricingNote(text: string) {
  const tier256k = text.match(/0<Token≤256K\s+([\d.]+)\s*元\s+([\d.]+)\s*元/i);
  const tier1m = text.match(/256K<Token≤1M\s+([\d.]+)\s*元\s+([\d.]+)\s*元/i);
  const lines: string[] = [];

  if (tier256k) {
    lines.push(`0<Token≤256K：输入 ${tier256k[1]} 元 / 输出 ${tier256k[2]} 元`);
  }
  if (tier1m) {
    lines.push(`256K<Token≤1M：输入 ${tier1m[1]} 元 / 输出 ${tier1m[2]} 元`);
  }

  return lines.length ? lines.join('；') : undefined;
}

function normalizeComparableToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractAliyunEmbeddedContent(html: string) {
  const match = html.match(/window\.__ICE_PAGE_PROPS__=(\{[\s\S]*?\});/);
  if (!match?.[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(match[1]);
    const content =
      payload?.docDetailData?.storeData?.data?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    console.warn('Failed to parse Aliyun embedded model metadata payload; falling back to raw HTML.');
    return null;
  }
}

function pickExcerpt(text: string, model: string) {
  const normalizedModel = normalizeModelName(model);
  const index = text.toLowerCase().indexOf(normalizedModel);
  if (index < 0) {
    return text.slice(0, 420);
  }
  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + 420);
  return text.slice(start, end).trim();
}

function extractOpenAiMetadata(text: string): ExtractedModelMetadata {
  return {
    contextWindow: parseNumberToken(text.match(/([\d,]+)\s+context window/i)?.[1]),
    maxOutputTokens: parseNumberToken(text.match(/([\d,]+)\s+max output tokens/i)?.[1]),
    inputCostPerMillion: parseCurrencyToken(text.match(/Input\s+\$([\d.]+)/i)?.[1]),
    outputCostPerMillion: parseCurrencyToken(text.match(/Output\s+\$([\d.]+)/i)?.[1]),
  };
}

function extractAnthropicMetadata(text: string): ExtractedModelMetadata {
  return {
    contextWindow: parseNumberToken(text.match(/([\d,]+K?|[\d,]+M?)\s+token context window/i)?.[1]?.replace(/k/i, '000').replace(/m/i, '000000')),
    inputCostPerMillion: parseCurrencyToken(text.match(/Input:\s*\$([\d.]+)/i)?.[1]),
    outputCostPerMillion: parseCurrencyToken(text.match(/Output:\s*\$([\d.]+)/i)?.[1]),
  };
}

function extractQwenMetadata(text: string, model: string): ExtractedModelMetadata {
  const normalizedTarget = normalizeComparableToken(model);
  if (normalizedTarget.startsWith('qwenimage')) {
    return extractQwenImageMetadata(text, model);
  }
  if (normalizedTarget.startsWith('qwen3tts') || normalizedTarget.startsWith('qwentts')) {
    return extractQwenTtsMetadata(text, model);
  }
  const modelMatches = [...text.matchAll(/Qwen[\w.+-]+/gi)].map((entry) => ({
    label: entry[0],
    index: entry.index ?? 0,
  }));
  const targetMatches = modelMatches.filter(
    (entry) => normalizeComparableToken(entry.label) === normalizedTarget,
  );
  const targetMatch =
    targetMatches.find((entry) =>
      /(稳定版|快照版|最新版)\s+思考/.test(text.slice(entry.index, Math.min(text.length, entry.index + 2200))),
    ) ??
    targetMatches[targetMatches.length - 1];
  const marker = targetMatch?.index ?? -1;
  const detailedChunk =
    marker >= 0 ? text.slice(marker, Math.min(text.length, marker + 1800)) : '';

  const stableThinkingRow = detailedChunk.match(
    /(稳定版|快照版|最新版)\s+思考\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)([\s\S]*?)(?=\s+非思考\s|\s+qwen[\w.+-]+\b|\s+以上模型根据本次请求输入的 Token数)/i,
  );
  if (stableThinkingRow) {
    const pricingNoteChunk = stableThinkingRow[6]?.trim() ?? '';
    const tieredPricingNote = buildQwenTieredPricingNote(text);
    const directInputPrice = parseCurrencyToken(pricingNoteChunk.match(/([\d.]+)\s*元/)?.[1]);
    const directOutputPrice = parseCurrencyToken(
      pricingNoteChunk.match(/([\d.]+)\s*元[\s/，,]+([\d.]+)\s*元/i)?.[2],
    );
    return {
      versionLabel: stableThinkingRow[1],
      modeLabel: '思考',
      contextWindow: parseNumberToken(stableThinkingRow[2]),
      maxInputTokens: parseNumberToken(stableThinkingRow[3]),
      longestReasoningTokens: parseNumberToken(stableThinkingRow[4]),
      maxOutputTokens: parseNumberToken(stableThinkingRow[5]),
      inputCostPerMillion: directInputPrice,
      outputCostPerMillion: directOutputPrice,
      pricingNote: tieredPricingNote ?? pricingNoteChunk ?? undefined,
    };
  }

  if (
    normalizedTarget.includes('qwen3max') ||
    normalizedTarget.includes('qwen36plus') ||
    normalizedTarget.includes('qwen35plus') ||
    normalizedTarget.includes('qwenplus') ||
    normalizedTarget.includes('qwenmax') ||
    normalizedTarget.includes('qwenflash')
  ) {
    const explicitRowPattern = new RegExp(
      `${escapeRegExp(model)}([\\s\\S]{0,260}?)(稳定版|快照版|最新版)([\\s\\S]{0,220}?)(思考|思考模式)([\\s\\S]{0,80}?)([\\d,]+)([\\s\\S]{0,80}?)([\\d,]+)([\\s\\S]{0,80}?)([\\d,]+)([\\s\\S]{0,120}?)(?:思维链最长\\s*([\\d,]+)|([\\d,]+))?`,
      'i',
    );
    const explicitRow = text.match(explicitRowPattern);
    if (explicitRow) {
      return {
        versionLabel: explicitRow[2],
        modeLabel: explicitRow[4].includes('模式') ? explicitRow[4] : '思考',
        contextWindow: parseNumberToken(explicitRow[6]),
        maxInputTokens: parseNumberToken(explicitRow[8]),
        maxOutputTokens: parseNumberToken(explicitRow[10]),
        longestReasoningTokens: parseNumberToken(explicitRow[12] ?? explicitRow[13]),
        pricingNote: buildQwenTieredPricingNote(text),
      };
    }
  }

  const metricsIndex = marker >= 0 ? text.indexOf('最大上下文长度', marker) : -1;
  const sectionStart = metricsIndex >= 0 ? text.lastIndexOf('旗舰模型', metricsIndex) : -1;
  const headerSection =
    sectionStart >= 0 && metricsIndex > sectionStart
      ? text.slice(sectionStart, metricsIndex)
      : marker >= 0 && metricsIndex > marker
        ? text.slice(Math.max(0, marker - 240), metricsIndex)
        : text;
  const metricsSection =
    metricsIndex >= 0
      ? text.slice(metricsIndex, Math.min(text.length, metricsIndex + 420))
      : text;
  const recentModelHeaders = [...headerSection.matchAll(/Qwen[\w.+-]+/gi)]
    .map((entry) => entry[0])
    .filter((value, index, values) => values.indexOf(value) === index);
  const contextMatches = [...metricsSection.matchAll(/(?:最大上下文长度|上下文长度)[^0-9]*([\d,]+)/gi)].map((entry) =>
    parseNumberToken(entry[1]),
  );
  const inputSection = metricsSection.match(/最低输入价格[^0-9]*([\d.]+)\s*元\s+([\d.]+)\s*元\s+([\d.]+)\s*元/i);
  const outputSection = metricsSection.match(/最低输出价格[^0-9]*([\d.]+)\s*元\s+([\d.]+)\s*元\s+([\d.]+)\s*元/i);
  const contextValues = metricsSection.match(/最大上下文长度[^0-9]*([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);

  if (recentModelHeaders.length >= 3) {
    const targetHeaders = recentModelHeaders.slice(-3);
    const targetIndex = targetHeaders.findIndex((entry) => normalizeComparableToken(entry) === normalizedTarget);
    if (targetIndex >= 0) {
      return {
        versionLabel: undefined,
        modeLabel: undefined,
        contextWindow: contextValues ? parseNumberToken(contextValues[1 + targetIndex]) : contextMatches[0],
        inputCostPerMillion: inputSection ? parseCurrencyToken(inputSection[1 + targetIndex]) : undefined,
        outputCostPerMillion: outputSection ? parseCurrencyToken(outputSection[1 + targetIndex]) : undefined,
      };
    }
  }

  const rowWindowMatch = text.match(
    new RegExp(`${escapeRegExp(model)}([\\s\\S]{0,260}?)((?=qwen[\\w.+-]+\\b)|$)`, 'i'),
  );
  const rowWindow = rowWindowMatch?.[0] ?? '';
  if (rowWindow) {
    const genericRow = {
      contextWindow: parseNumberToken(rowWindow.match(/(?:上下文长度|最大上下文长度)[^0-9]*([\d,]+)/i)?.[1]),
      maxInputTokens: parseNumberToken(rowWindow.match(/最大输入[^0-9]*([\d,]+)/i)?.[1]),
      longestReasoningTokens: parseNumberToken(rowWindow.match(/最长思维链[^0-9]*([\d,]+)/i)?.[1]),
      maxOutputTokens: parseNumberToken(rowWindow.match(/最大输出[^0-9]*([\d,]+)/i)?.[1]),
      inputCostPerMillion: parseCurrencyToken(rowWindow.match(/(?:最低输入价格|输入成本)[^0-9]*([\d.]+)\s*元/i)?.[1]),
      outputCostPerMillion: parseCurrencyToken(rowWindow.match(/(?:最低输出价格|输出成本)[^0-9]*([\d.]+)\s*元/i)?.[1]),
    };
    if (
      genericRow.contextWindow ||
      genericRow.maxInputTokens ||
      genericRow.longestReasoningTokens ||
      genericRow.maxOutputTokens ||
      genericRow.inputCostPerMillion != null ||
      genericRow.outputCostPerMillion != null
    ) {
      return genericRow;
    }
  }

  return {};
}

function extractQwenImageMetadata(text: string, model: string): ExtractedModelMetadata {
  const match = text.match(
    new RegExp(`${escapeRegExp(model)}([\\s\\S]{0,120}?)(稳定版|快照版|最新版)?([\\s\\S]{0,120}?)([\\d.]+)\\s*元/张`, 'i'),
  );
  if (!match) {
    return {};
  }
  return {
    versionLabel: match[2] ?? undefined,
    pricingNote: `单价 ${match[4]} 元/张`,
  };
}

function extractQwenTtsMetadata(text: string, model: string): ExtractedModelMetadata {
  const versionLabel = text.match(
    new RegExp(`${escapeRegExp(model)}([\\s\\S]{0,80}?)(稳定版|快照版|最新版)`, 'i'),
  )?.[2];
  const unitPrice = text.match(
    new RegExp(`${escapeRegExp(model)}([\\s\\S]{0,180}?)([\\d.]+)\\s*元\\/万字符`, 'i'),
  )?.[2];
  const maxInputCharacters = parseNumberToken(
    text.match(
      new RegExp(`${escapeRegExp(model)}([\\s\\S]{0,220}?)(?:最大输入字符数|输入字符数上限)[^0-9]*([\\d,]+)`, 'i'),
    )?.[2],
  );
  if (!unitPrice && !maxInputCharacters) {
    return {};
  }
  return {
    versionLabel,
    maxInputCharacters,
    pricingNote: `${unitPrice ? `单价 ${unitPrice} 元/万字符` : '语音按字符计费'}${maxInputCharacters ? `；最大输入字符数 ${maxInputCharacters}` : ''}`,
  };
}

export function getOfficialModelInspectorSources(providerName: string, model: string): ModelInspectorSource[] {
  const normalizedProvider = providerName.toLowerCase();
  const normalizedModel = normalizeModelName(model);

  if (
    normalizedProvider.includes('openai') ||
    normalizedModel.startsWith('gpt') ||
    normalizedModel.startsWith('o1') ||
    normalizedModel.startsWith('o3') ||
    normalizedModel.startsWith('o4')
  ) {
    return [
      { label: '官方模型页', url: `https://platform.openai.com/docs/models/${encodeURIComponent(model)}` },
      { label: '官方价格页', url: 'https://platform.openai.com/docs/pricing/' },
      { label: '模型总览', url: 'https://platform.openai.com/docs/models' },
    ];
  }

  if (normalizedProvider.includes('anthropic') || normalizedModel.startsWith('claude')) {
    return [
      { label: '官方模型页', url: 'https://docs.anthropic.com/en/docs/about-claude/models' },
      { label: '官方价格页', url: 'https://docs.anthropic.com/en/docs/about-claude/pricing' },
      { label: 'Token 统计说明', url: 'https://docs.anthropic.com/en/docs/build-with-claude/token-counting' },
    ];
  }

  if (normalizedProvider.includes('qwen') || normalizedProvider.includes('dashscope') || normalizedModel.startsWith('qwen')) {
    return [
      { label: '官方模型页', url: 'https://help.aliyun.com/zh/model-studio/models' },
      { label: 'Responses 兼容说明', url: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api' },
    ];
  }

  return [];
}

export function extractModelInspectorResult(providerName: string, model: string, htmlBySource: Array<{ url: string; html: string }>): ModelInspectorResult {
  const sources = getOfficialModelInspectorSources(providerName, model);
  const normalizedProvider = providerName.toLowerCase();
  const normalizedModel = normalizeModelName(model);
  let merged: Partial<ModelInspectorResult> = {};
  let excerpt = '';

  htmlBySource.forEach(({ html }) => {
    const sourceHtml =
      normalizedProvider.includes('qwen') || normalizedProvider.includes('dashscope') || normalizedModel.startsWith('qwen')
        ? extractAliyunEmbeddedContent(html) ?? html
        : html;
    const text = stripHtml(sourceHtml);
    if (!excerpt && text) {
      excerpt = pickExcerpt(text, model);
    }
    const next =
      normalizedProvider.includes('openai') || normalizedModel.startsWith('gpt') || normalizedModel.startsWith('o')
        ? extractOpenAiMetadata(text)
        : normalizedProvider.includes('anthropic') || normalizedModel.startsWith('claude')
          ? extractAnthropicMetadata(text)
          : extractQwenMetadata(text, model);

    merged = {
      resolverVersion: merged.resolverVersion ?? next.resolverVersion,
      versionLabel: merged.versionLabel ?? next.versionLabel,
      modeLabel: merged.modeLabel ?? next.modeLabel,
      contextWindow: merged.contextWindow ?? next.contextWindow,
      maxInputTokens: merged.maxInputTokens ?? next.maxInputTokens,
      maxInputCharacters: merged.maxInputCharacters ?? next.maxInputCharacters,
      longestReasoningTokens: merged.longestReasoningTokens ?? next.longestReasoningTokens,
      maxOutputTokens: merged.maxOutputTokens ?? next.maxOutputTokens,
      inputCostPerMillion: merged.inputCostPerMillion ?? next.inputCostPerMillion,
      outputCostPerMillion: merged.outputCostPerMillion ?? next.outputCostPerMillion,
      pricingNote: merged.pricingNote ?? next.pricingNote,
    };
  });

  return {
    providerName,
    model,
    resolverVersion: MODEL_INSPECTOR_RESOLVER_VERSION,
    ...merged,
    excerpt,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}

export async function inspectOfficialModelMetadata(
  providerName: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInspectorResult> {
  const sources = getOfficialModelInspectorSources(providerName, model);
  if (!sources.length) {
    return {
      providerName,
      model,
      sources: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const htmlBySource: Array<{ url: string; html: string }> = [];
  for (const source of sources) {
    try {
      const response = await fetchImpl(source.url, {
        headers: {
          'User-Agent': 'FlowAgent-Inspector/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        continue;
      }
      htmlBySource.push({
        url: source.url,
        html: await response.text(),
      });
    } catch {
      // Keep going; partial sources are acceptable.
    }
  }

  return extractModelInspectorResult(providerName, model, htmlBySource);
}
