/**
 * LangChain-style agent loop: run the model with tools until no more tool_calls or max steps.
 * Returns the final assistant text to display in the chat.
 *
 * Fallback when the model does not support tool calling: If the model returns no tool_calls,
 * the first response is treated as the final answer (single turn). Search and email tools
 * work best with tool-capable models (e.g. Qwen 2.5, Llama 3.1+ with tool-use templates).
 */

import {
  type BaseMessage,
  ToolMessage,
  AIMessage,
} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {LlamaRNChatModel} from './LlamaRNChatModel';

const MAX_AGENT_STEPS = 10;

function truncateForLog(s: string, maxLen = 400): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...[truncated]';
}

/** Detect if the user message is asking for current time or date. */
function looksLikeTimeDateQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  const patterns = [
    /what('s|\s+is)\s+the\s+time/,
    /what\s+time\s+is\s+it/,
    /current\s+time/,
    /what('s|\s+is)\s+the\s+date/,
    /what('s|\s+is)\s+today('s)?\s+date/,
    /what\s+day\s+is\s+it/,
    /today('s)?\s+date/,
    /current\s+date/,
    /time\s+now/,
    /date\s+today/,
  ];
  return patterns.some(p => p.test(lower));
}

/**
 * Parse Qwen-style XML tool call from model content when native tool_calls are empty.
 * Handles <parameter=name>value</parameter> and infers current_time when tool_call is empty and user asked about time/date.
 */
function parseToolCallFromContent(
  content: string,
  availableToolNames: string[],
  lastUserMessage?: string,
): Array<{name: string; id: string; args: Record<string, unknown>}> | null {
  const trimmed = content.trim();
  const hasToolCall =
    trimmed.includes('<tool_call>') &&
    (trimmed.includes('</tool_call>') || trimmed.includes('</function>'));
  if (!hasToolCall) return null;

  const args: Record<string, string> = {};
  const paramRegex = /<parameter\s*(?:=\s*(\w+)|name\s*=\s*["']?(\w+)["']?)\s*>([\s\S]*?)<\/parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(trimmed)) !== null) {
    const key = (m[1] || m[2] || '').toLowerCase();
    const value = (m[3] ?? '').trim();
    if (key) args[key] = value;
  }

  if (Object.keys(args).length > 0) {
    const queryVal = (args.query ?? args.q)?.trim();
    const timezoneVal = (args.timezone ?? args.tz)?.trim();
    const hasMaxResults = 'maxresults' in args || 'max_results' in args;

    if (queryVal !== undefined && queryVal.length > 0 && availableToolNames.includes('search_web') && !hasMaxResults) {
      return [{ name: 'search_web', id: `synthetic_search_${Date.now()}`, args: { query: queryVal } }];
    }
    if (availableToolNames.includes('current_time') && ('timezone' in args || 'tz' in args)) {
      return [{ name: 'current_time', id: `synthetic_time_${Date.now()}`, args: timezoneVal ? { timezone: timezoneVal } : {} }];
    }
    if (availableToolNames.includes('read_email') && (hasMaxResults || queryVal !== undefined)) {
      const maxResults = args.maxresults ?? args.max_results;
      const num = maxResults ? parseInt(String(maxResults), 10) : 5;
      return [{
        name: 'read_email',
        id: `synthetic_email_${Date.now()}`,
        args: { query: queryVal ?? '', maxResults: isNaN(num) ? 5 : Math.min(20, Math.max(1, num)) },
      }];
    }
    if (queryVal !== undefined && queryVal.length > 0 && availableToolNames.includes('search_web')) {
      return [{ name: 'search_web', id: `synthetic_search_${Date.now()}`, args: { query: queryVal } }];
    }
    return null;
  }

  if (lastUserMessage && looksLikeTimeDateQuestion(lastUserMessage) && availableToolNames.includes('current_time')) {
    return [
      {
        name: 'current_time',
        id: `synthetic_time_${Date.now()}`,
        args: {},
      },
    ];
  }
  return null;
}

export type RunAgentStreamingOptions = {
  onToken: (accumulatedText: string) => void;
};

/**
 * Run the agent loop: call the model with the current messages; if it returns tool_calls,
 * execute each tool and append ToolMessages, then repeat. Stops when the model returns
 * no tool_calls or we hit max steps. Returns the final text reply.
 * When streamingOptions is provided, tokens are streamed to onToken (per turn).
 */
export async function runAgent(
  model: LlamaRNChatModel,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
  streamingOptions?: RunAgentStreamingOptions,
): Promise<{text: string; error?: string}> {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  let currentMessages: BaseMessage[] = [...messages];
  let steps = 0;

  console.log('[Agent] runAgent started', { messageCount: messages.length, toolNames: tools.map(t => t.name), streaming: !!streamingOptions?.onToken });

  while (steps < MAX_AGENT_STEPS) {
    steps += 1;
    let streamBuffer = '';
    const invokeOptions =
      streamingOptions?.onToken
        ? {
            streamingCallback: (token: string) => {
              streamBuffer += token;
              streamingOptions.onToken(streamBuffer);
            },
          }
        : undefined;

    if (steps > 1) streamingOptions?.onToken('');

    console.log('[Agent] step', steps, 'invoking model with', currentMessages.length, 'messages');
    const result = await model.invoke(currentMessages, invokeOptions as any);
    const aiMessage = result as AIMessage;
    const content = typeof aiMessage.content === 'string' ? aiMessage.content : String(aiMessage.content ?? '');
    const toolCalls = aiMessage.tool_calls ?? [];

    const toolNames = tools.map(t => t.name);
    const lastHuman = currentMessages.filter((m: BaseMessage) => m._getType() === 'human').pop();
    const lastUserMessage = lastHuman
      ? (typeof lastHuman.content === 'string' ? lastHuman.content : String((lastHuman as any).content ?? ''))
      : undefined;
    const syntheticCalls = toolCalls.length === 0 ? parseToolCallFromContent(content, toolNames, lastUserMessage) : null;
    const effectiveToolCalls =
      toolCalls.length > 0
        ? toolCalls.map(tc => ({name: tc.name, id: tc.id ?? `call_${tc.name}_${Date.now()}`, args: typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {query: tc.args}; } })() : tc.args}))
        : syntheticCalls;

    console.log('[Agent] step', steps, 'model response:', {
      contentLength: content.length,
      contentPreview: truncateForLog(content, 200),
      toolCallsCount: toolCalls.length,
      syntheticParsed: syntheticCalls ? syntheticCalls.length : null,
      effectiveToolCallsCount: effectiveToolCalls?.length ?? 0,
      toolCalls: (effectiveToolCalls ?? []).map((tc: any) => ({ name: tc.name, id: tc.id, args: truncateForLog(JSON.stringify(tc.args), 150) })),
    });

    if (!effectiveToolCalls || effectiveToolCalls.length === 0) {
      const finalText = content.trim();
      if (finalText && finalText.includes('<tool_call>')) {
        console.warn('[Agent] content looks like tool call but could not parse it; returning fallback message');
        return {text: "I tried to look that up but couldn't complete the tool call. Please try asking again or rephrase."};
      }
      console.log('[Agent] no tool calls — returning final answer, length:', finalText.length);
      return {text: finalText || '(No response)'};
    }

    // Replace streamed intro text with a short placeholder so the user sees one clear result (the final answer), not the model's preamble
    const placeholders: Record<string, string> = {
      search_web: 'Searching…',
      read_email: 'Checking email…',
      current_time: 'Getting current time…',
    };
    const placeholder =
      effectiveToolCalls.length > 0 && effectiveToolCalls[0].name in placeholders
        ? placeholders[effectiveToolCalls[0].name as keyof typeof placeholders]
        : 'Looking that up…';
    streamingOptions?.onToken(placeholder);

    const toolResults: ToolMessage[] = [];
    for (const tc of effectiveToolCalls) {
      const tool = toolMap.get(tc.name);
      const id = tc.id ?? `call_${tc.name}_${Date.now()}`;
      const args = typeof tc.args === 'object' && tc.args !== null ? tc.args : {query: String(tc.args)};
      let resultContent: string;
      try {
        console.log('[Agent] executing tool', tc.name, 'with args', JSON.stringify(args));
        resultContent = tool
          ? await tool.invoke(args).then(out => (typeof out === 'string' ? out : JSON.stringify(out)))
          : `Tool "${tc.name}" not found.`;
        console.log('[Agent] tool', tc.name, 'result length:', resultContent.length, 'preview:', truncateForLog(resultContent, 300));
        toolResults.push(
          new ToolMessage({content: resultContent, tool_call_id: id}),
        );
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn('[Agent] tool', tc.name, 'threw:', err);
        toolResults.push(
          new ToolMessage({content: resultContent, tool_call_id: id}),
        );
      }
    }

    currentMessages = [
      ...currentMessages,
      aiMessage,
      ...toolResults,
    ];
    console.log('[Agent] step', steps, 'done; conversation now has', currentMessages.length, 'messages, continuing loop');
  }

  const lastAi = currentMessages.filter((m): m is AIMessage => m._getType() === 'ai').pop();
  const text = lastAi && typeof lastAi.content === 'string' ? lastAi.content : '(Max steps reached)';
  console.log('[Agent] max steps reached; returning last AI content, length:', text.trim().length);
  return {text: text.trim() || '(Max steps reached)'};
}
