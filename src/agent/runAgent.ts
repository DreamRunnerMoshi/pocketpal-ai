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

/**
 * Run the agent loop: call the model with the current messages; if it returns tool_calls,
 * execute each tool and append ToolMessages, then repeat. Stops when the model returns
 * no tool_calls or we hit max steps. Returns the final text reply.
 *
 * If the model does not support tool calling, the first response is treated as the final answer.
 */
export async function runAgent(
  model: LlamaRNChatModel,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
): Promise<{text: string; error?: string}> {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  let currentMessages: BaseMessage[] = [...messages];
  let steps = 0;

  while (steps < MAX_AGENT_STEPS) {
    steps += 1;
    const result = await model.invoke(currentMessages);
    const aiMessage = result as AIMessage;
    const content = typeof aiMessage.content === 'string' ? aiMessage.content : String(aiMessage.content ?? '');
    const toolCalls = aiMessage.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return {text: content.trim() || '(No response)'};
    }

    const toolResults: ToolMessage[] = [];
    for (const tc of toolCalls) {
      const tool = toolMap.get(tc.name);
      const id = tc.id ?? `call_${tc.name}_${Date.now()}`;
      let resultContent: string;
      try {
        const args = typeof tc.args === 'string' ? (() => {
          try {
            return JSON.parse(tc.args);
          } catch {
            return {query: tc.args};
          }
        })() : tc.args;
        resultContent = tool
          ? await tool.invoke(args).then(out => (typeof out === 'string' ? out : JSON.stringify(out)))
          : `Tool "${tc.name}" not found.`;
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      toolResults.push(
        new ToolMessage({content: resultContent, tool_call_id: id}),
      );
    }

    currentMessages = [
      ...currentMessages,
      aiMessage,
      ...toolResults,
    ];
  }

  const lastAi = currentMessages.filter((m): m is AIMessage => m._getType() === 'ai').pop();
  const text = lastAi && typeof lastAi.content === 'string' ? lastAi.content : '(Max steps reached)';
  return {text: text.trim() || '(Max steps reached)'};
}
