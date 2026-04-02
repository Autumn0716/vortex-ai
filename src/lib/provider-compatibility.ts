import type { ProviderType, ModelProvider } from './agent/config';

export type ProviderProtocol =
  | 'openai_chat_compatible'
  | 'openai_responses_compatible'
  | 'anthropic_native';

export type ProviderRequestMode = 'chat_completions' | 'responses';

export function getDefaultProviderProtocol(type: ProviderType): ProviderProtocol {
  if (type === 'anthropic') {
    return 'anthropic_native';
  }
  return 'openai_chat_compatible';
}

export function getProviderRequestMode(protocol: ProviderProtocol): ProviderRequestMode {
  return protocol === 'openai_responses_compatible' ? 'responses' : 'chat_completions';
}

export function normalizeBaseUrl(value?: string) {
  return (value || '').trim().replace(/\/+$/, '');
}

export function getProviderBaseUrlPlaceholder(protocol: ProviderProtocol) {
  switch (protocol) {
    case 'openai_responses_compatible':
      return 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1';
    case 'anthropic_native':
      return 'https://api.anthropic.com';
    case 'openai_chat_compatible':
    default:
      return 'https://api.example.com/v1';
  }
}

export function getProviderRequestPreview(baseUrl: string | undefined, protocol: ProviderProtocol) {
  const normalized = normalizeBaseUrl(baseUrl);
  const fallback = normalized || '默认地址';
  if (protocol === 'openai_responses_compatible') {
    return `${fallback}/responses`;
  }
  if (protocol === 'anthropic_native') {
    return `${fallback}/v1/messages`;
  }
  return `${fallback}/chat/completions`;
}

export function buildProviderModelListCandidates(provider: Pick<ModelProvider, 'baseUrl' | 'protocol'>) {
  const normalized = normalizeBaseUrl(provider.baseUrl);
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(`${normalized}/models`);
  if (!/\/v1$/i.test(normalized)) {
    candidates.add(`${normalized}/v1/models`);
  }

  if (provider.protocol === 'openai_responses_compatible') {
    const chatCompatibleBase = normalized.replace(
      /\/api\/v2\/apps\/protocols\/compatible-mode\/v1$/i,
      '/compatible-mode/v1',
    );
    if (chatCompatibleBase !== normalized) {
      candidates.add(`${chatCompatibleBase}/models`);
    }
  }

  return Array.from(candidates);
}
