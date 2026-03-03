# Agent (LangChain-style)

This folder implements a LangChain-style agent that runs for every user message: the on-device LLM can call tools (web search, read Gmail) and the loop runs until the model returns a final text reply or max steps.

## Model support

- **Tool-capable models**: When the model returns `tool_calls`, the agent executes the tools and calls the model again with the results. Search and email work best with models that support tool/function calling (e.g. Qwen 2.5, Llama 3.1+ with a tool-use chat template).
- **Fallback**: If the model does not return `tool_calls`, the first response is used as the final answer (single turn). No tools are used in that case.

## Tools

- **search_web**: Serper API; requires `SERPER_API_KEY` in `.env`.
- **read_email**: Gmail API using the Google Sign-In access token. User must add Gmail scope (Settings → Connect Gmail or sign in with Google and grant read access).

## Gmail

- Scope: `https://www.googleapis.com/auth/gmail.readonly`
- Use **Connect Gmail** in Settings to request the scope, or sign in with Google (e.g. in Pals) and add the scope when prompted. The `read_email` tool returns a clear message if Gmail is not connected.

## Sample prompts to trigger tools

Use these in chat to test that the model calls tools (search or email). If the model does not support tool calling, it may answer without using tools.

**Web search (search_web):**
- "What's the latest news about [topic] today?"
- "Search for the current weather in Tokyo."
- "Look up the most recent score of [sports game/team]."
- "What happened in the news this week?"
- "Find current prices for Bitcoin."

**Email (read_email):**
- "Check my inbox."
- "Do I have any unread emails?"
- "Show my last 5 emails."
- "Search my emails for messages from [sender]."
