/**
 * Custom LangChain ChatModel that wraps llama.rn context.completion().
 * Maps LangChain messages to llama.rn format and result (including tool_calls) to AIMessage.
 */

import type {LlamaContext} from 'llama.rn';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import {AIMessage} from '@langchain/core/messages';
import type {ChatResult} from '@langchain/core/outputs';
import type {CallbackManagerForLLMRun} from '@langchain/core/callbacks/manager';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import type {StructuredToolInterface} from '@langchain/core/tools';

export type RNLlamaMessage = {
  role: string;
  content?: string | Array<{type: string; text?: string; image_url?: {url?: string}}>;
  tool_call_id?: string;
  tool_calls?: Array<{type: 'function'; id?: string; function: {name: string; arguments: string}}>;
};

export type LlamaRNChatModelParams = {
  context: LlamaContext | null;
  /** Session/completion params (temperature, n_predict, stop, jinja, etc.) */
  completionParams: Record<string, unknown>;
  /** Tool definitions for tool_choice; converted to OpenAI format for llama.rn */
  tools?: StructuredToolInterface[];
  /** Stop words from model config */
  stopWords?: string[];
};

/**
 * Converts LangChain BaseMessage[] to the format expected by llama.rn (OpenAI-compatible roles + content).
 * Handles system, user, assistant, and tool messages.
 */
/** Map LangChain message role to OpenAI/Jinja chat template role (system, user, assistant, tool). */
function toLlamaRole(type: string): string {
  if (type === 'human') return 'user';
  if (type === 'ai') return 'assistant';
  return type; // system, tool, etc.
}

export function langChainMessagesToLlamaRN(
  messages: BaseMessage[],
): RNLlamaMessage[] {
  return messages.map(msg => {
    const type = msg._getType();
    const role = toLlamaRole(type);
    let content: string | any[] =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((part: any) => {
              if (part.type === 'text') return {type: 'text', text: part.text ?? ''};
              if (part.type === 'image_url' && part.image_url?.url)
                return {type: 'image_url', image_url: {url: part.image_url.url}};
              return {type: 'text', text: ''};
            }).filter((p: any) => p.type === 'text' && p.text)
          : String(msg.content ?? '');

    const out: RNLlamaMessage = {role, content: content as any};
    if (type === 'tool' && 'tool_call_id' in msg && msg.tool_call_id)
      out.tool_call_id = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : String(msg.tool_call_id);
    if (type === 'ai' && 'tool_calls' in msg && Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0) {
      out.tool_calls = (msg as any).tool_calls.map((tc: any) => ({
        type: 'function' as const,
        id: tc.id,
        function: { name: tc.name ?? tc.function?.name ?? '', arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}) },
      }));
    }
    return out;
  });
}

/**
 * ChatModel that uses llama.rn context.completion() with optional tools.
 * When the model returns tool_calls, they are mapped to LangChain AIMessage.tool_calls.
 */
export class LlamaRNChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  declare context: LlamaContext | null;
  declare completionParams: Record<string, unknown>;
  declare tools: StructuredToolInterface[];
  declare stopWords: string[] | undefined;

  constructor(params: LlamaRNChatModelParams) {
    super({});
    this.context = params.context;
    this.completionParams = params.completionParams;
    this.tools = params.tools ?? [];
    this.stopWords = params.stopWords;
  }

  _llmType(): string {
    return 'llama_rn';
  }

  /**
   * Update context and/or completion params (e.g. when model or session changes).
   */
  updateParams(params: Partial<LlamaRNChatModelParams>): void {
    if (params.context !== undefined) this.context = params.context;
    if (params.completionParams !== undefined) this.completionParams = params.completionParams;
    if (params.tools !== undefined) this.tools = params.tools;
    if (params.stopWords !== undefined) this.stopWords = params.stopWords;
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const ctx = this.context;
    if (!ctx) {
      throw new Error('LlamaRNChatModel: context is not loaded. Load a model first.');
    }

    const llamaMessages = langChainMessagesToLlamaRN(messages);
    const streamingCallback = (options as any).streamingCallback as ((token: string) => void) | undefined;
    const params: Record<string, any> = {
      ...this.completionParams,
      messages: llamaMessages,
      emit_partial_completion: !!streamingCallback,
    };

    if (this.stopWords?.length) params.stop = this.stopWords;
    if (this.tools.length > 0) {
      params.tools = this.tools.map(t => convertToOpenAITool(t));
      params.tool_choice = options.tool_choice ?? 'auto';
      params.jinja = true;
    }

    console.log('[LlamaRNChatModel] completion request:', {
      messageCount: llamaMessages.length,
      toolsCount: this.tools.length,
      toolNames: this.tools.map(t => t.name),
      streaming: !!streamingCallback,
    });
    const result = streamingCallback
      ? await ctx.completion(params, (data: {token?: string}) => {
          if (data?.token) streamingCallback(data.token);
        })
      : await ctx.completion(params);
    const rawToolCalls = result.tool_calls ?? [];
    console.log('[LlamaRNChatModel] completion response:', {
      hasContent: !!(result.content ?? result.text),
      contentLength: (result.content ?? result.text ?? '').length,
      rawToolCallsCount: rawToolCalls.length,
      rawToolCalls: rawToolCalls.map((tc: any) => ({ name: tc.function?.name, argsPreview: typeof tc.function?.arguments === 'string' ? tc.function.arguments.slice(0, 100) : '(object)' })),
    });

    const toolCalls = rawToolCalls.map((tc: any) => ({
      id: tc.id ?? `call_${tc.function?.name ?? 'unknown'}_${Date.now()}`,
      name: tc.function?.name ?? 'unknown',
      args: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
    }));

    const content = (result.content ?? result.text ?? '').trim();
    const aiMessage = new AIMessage({
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    return {
      generations: [{message: aiMessage, text: content}],
      llmOutput: {reasoning_content: result.reasoning_content},
    };
  }
}
