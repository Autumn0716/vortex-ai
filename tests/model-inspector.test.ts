import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractModelInspectorResult,
  getOfficialModelInspectorSources,
} from '../server/model-inspector';

test('extractModelInspectorResult parses OpenAI model page snippets', () => {
  const result = extractModelInspectorResult('OpenAI', 'gpt-4.1-mini', [
    {
      url: 'https://platform.openai.com/docs/models/gpt-4.1-mini',
      html: `
        <html><body>
          <h1>gpt-4.1-mini</h1>
          <div>1,047,576 context window</div>
          <div>32,768 max output tokens</div>
          <div>Input $0.40</div>
          <div>Output $1.60</div>
        </body></html>
      `,
    },
  ]);

  assert.equal(result.contextWindow, 1047576);
  assert.equal(result.maxOutputTokens, 32768);
  assert.equal(result.inputCostPerMillion, 0.4);
  assert.equal(result.outputCostPerMillion, 1.6);
});

test('extractModelInspectorResult parses Qwen model table snippets', () => {
  const result = extractModelInspectorResult('Qwen · Responses', 'qwen-vl-plus', [
    {
      url: 'https://help.aliyun.com/zh/model-studio/models',
      html: `
        <html><body>
          qwen-vl-plus 稳定版 上下文长度 131,072 最大输入 129,024 最大输出 8,192 输入成本 0.0008元 输出成本 0.002元
        </body></html>
      `,
    },
  ]);

  assert.equal(result.contextWindow, 131072);
  assert.equal(result.maxInputTokens, 129024);
  assert.equal(result.maxOutputTokens, 8192);
  assert.equal(result.inputCostPerMillion, 0.0008);
  assert.equal(result.outputCostPerMillion, 0.002);
});

test('extractModelInspectorResult parses Qwen three-column pricing cards', () => {
  const result = extractModelInspectorResult('Aliyun', 'qwen3.6plus', [
    {
      url: 'https://help.aliyun.com/zh/model-studio/models',
      html: `
        <html><body>
          Qwen3-Max 能力最强
          Qwen3.6-Plus 效果、速度、成本均衡
          Qwen3.5-Flash 适合简单任务，速度快、成本低
          最大上下文长度（Token 数） 262,144 1,000,000 1,000,000
          最低输入价格（每百万 Token） 2.5 元 2 元 0.2 元
          最低输出价格（每百万 Token） 10 元 12 元 2 元
        </body></html>
      `,
    },
  ]);

  assert.equal(result.contextWindow, 1000000);
  assert.equal(result.inputCostPerMillion, 2);
  assert.equal(result.outputCostPerMillion, 12);
});

test('extractModelInspectorResult prioritizes Qwen detailed table rows', () => {
  const result = extractModelInspectorResult('Aliyun', 'qwen3.6plus', [
    {
      url: 'https://help.aliyun.com/zh/model-studio/models',
      html: `
        <html><body>
          qwen3.6-plus 当前与qwen3.6-plus-2026-04-02能力相同 默认开启思考模式 Batch调用半价
          稳定版 思考 1,000,000 983,616 81,920 65,536 阶梯计价，请参见表格下方说明。
          各100万Token 有效期：百炼开通后90天内
          非思考 991,808 -
          qwen3.6-plus-2026-04-02 快照版 思考 983,616 81,920 非思考 991,808 -
          以上模型根据本次请求输入的 Token数，采取阶梯计费。
          Qwen3.6-Plus Qwen3.5-Plus Qwen-Plus
          单次请求的输入Token数 输入价格（每百万Token） 输出价格（每百万Token）
          0&lt;Token≤256K 2元 12元
          256K&lt;Token≤1M 8元 48元
        </body></html>
      `,
    },
  ]);

  assert.equal(result.versionLabel, '稳定版');
  assert.equal(result.modeLabel, '思考');
  assert.equal(result.contextWindow, 1000000);
  assert.equal(result.maxInputTokens, 983616);
  assert.equal(result.longestReasoningTokens, 81920);
  assert.equal(result.maxOutputTokens, 65536);
  assert.equal(
    result.pricingNote,
    '0<Token≤256K：输入 2 元 / 输出 12 元；256K<Token≤1M：输入 8 元 / 输出 48 元',
  );
});

test('extractModelInspectorResult does not apply flagship qwen3 card data to qwen image models', () => {
  const result = extractModelInspectorResult('Aliyun', 'qwen-image-2.0-2026-03-03', [
    {
      url: 'https://help.aliyun.com/zh/model-studio/models',
      html: `
        <html><body>
          qwen-image-2.0-2026-03-03 稳定版 0.2元/张
          Qwen3-Max Qwen3.6-Plus Qwen3.5-Flash
          最大上下文长度（Token 数） 262,144 1,000,000 1,000,000
          最低输入价格（每百万 Token） 2.5 元 2 元 0.2 元
          最低输出价格（每百万 Token） 10 元 12 元 2 元
        </body></html>
      `,
    },
  ]);

  assert.equal(result.contextWindow, undefined);
  assert.equal(result.inputCostPerMillion, undefined);
  assert.equal(result.outputCostPerMillion, undefined);
  assert.equal(result.pricingNote, '单价 0.2 元/张');
});

test('extractModelInspectorResult extracts qwen tts row-specific fields without token fallback', () => {
  const result = extractModelInspectorResult('Aliyun', 'qwen3-tts-vd-2026-01-26', [
    {
      url: 'https://help.aliyun.com/zh/model-studio/models',
      html: `
        <html><body>
          qwen3-tts-vd-2026-01-26 稳定版 0.8元/万字符 最大输入字符数 600
          Qwen3-Max Qwen3.6-Plus Qwen3.5-Flash
          最大上下文长度（Token 数） 262,144 1,000,000 1,000,000
          最低输入价格（每百万 Token） 2.5 元 2 元 0.2 元
          最低输出价格（每百万 Token） 10 元 12 元 2 元
        </body></html>
      `,
    },
  ]);

  assert.equal(result.contextWindow, undefined);
  assert.equal(result.maxInputCharacters, 600);
  assert.equal(result.pricingNote, '单价 0.8 元/万字符；最大输入字符数 600');
});

test('getOfficialModelInspectorSources returns provider-specific sources', () => {
  assert.equal(getOfficialModelInspectorSources('OpenAI', 'gpt-4o').length > 0, true);
  assert.equal(getOfficialModelInspectorSources('Anthropic', 'claude-3-7-sonnet').length > 0, true);
  assert.equal(getOfficialModelInspectorSources('Qwen', 'qwen-plus').length > 0, true);
});
