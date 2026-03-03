# PocketPal AI (Fork)

This project is **forked from [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai)**. It keeps the same goal — an on-device AI assistant for iOS and Android — and adds an **agent-style chat flow** with tools (web search, Gmail) while still using local LLMs for inference.

## What This Fork Adds

- **LangChain-style agent loop**: Each user message is handled by an agent that can call tools and then send results back to the model for a final answer.
- **Tools**: **Web search** (Serper API) and **Read Gmail** (Google Sign-In + Gmail API). The on-device model decides when to call them.
- **Qwen-style tool-call parsing**: When the model outputs tool calls as XML-like text (e.g. `<tool_call><parameter=query>...</parameter></tool_call>`) instead of structured `tool_calls`, we parse that format and run the corresponding tools so search and email still work with models that don’t emit native tool calls.
- **System prompt for tools**: A built-in system hint tells the model it has access to search and email and should use them for weather, news, inbox, etc.

The rest of the app (Pals, model download/load, chat UI, settings) is unchanged from the upstream PocketPal experience.

---

## Architecture

- **On-device inference**: [llama.rn](https://github.com/mybigday/llama.rn) (llama.cpp bindings for React Native). Models are GGUF, loaded and run locally; no chat data is sent to a remote LLM.
- **Agent orchestration**: [LangChain](https://js.langchain.com/) (`@langchain/core`). We implement:
  - A custom **ChatModel** that wraps `llama.rn`’s completion API and maps messages/tool calls to and from LangChain’s `BaseMessage` and `AIMessage.tool_calls`.
  - An **agent loop** in app code: invoke model → if it returns tool calls (or we parse them from content), execute tools → append tool results to the conversation → invoke model again. Loop until the model returns a final text reply or a step limit is reached.
- **Tools**:
  - **search_web**: Calls Serper API with a query; returns a formatted string of results. Requires `SERPER_API_KEY` in `.env`.
  - **read_email**: Uses the user’s Google access token (from Google Sign-In) to call Gmail API and return a summary of messages. Requires “Connect Gmail” (or equivalent) so the app has `gmail.readonly` scope.
- **Chat formatting**: The same chat templates and Jinja usage as upstream; we map LangChain roles (`ai` → `assistant`, etc.) so the model’s template receives the expected roles.
- **Pals & settings**: Unchanged from upstream: Pals define system prompts and default models; the agent uses the active Pal’s system prompt plus the tool hint when tools are enabled.

So: **one process** (your app) runs the **LLM on-device** and the **agent loop** (model + tools + parsing); only tool calls (search, Gmail) hit external APIs.

---

## Development

### Prerequisites

- Node.js 18+
- Yarn
- Xcode (iOS) / Android Studio (Android)
- For tools: Serper API key (web search), Google Sign-In configured (Gmail)

### Setup

```bash
git clone https://github.com/<your-org>/pocketpal-ai
cd pocketpal-ai
yarn install
cd ios && pod install && cd ..
```

Create a `.env` with `SERPER_API_KEY` if you want web search.

### Run

```bash
yarn start    # Metro
yarn ios      # iOS Simulator
yarn android  # Android Emulator
```

Build from Xcode/Android Studio as in the original PocketPal repo.

### Scripts

- `yarn start` — Metro bundler  
- `yarn ios` / `yarn android` — Run on simulator/emulator  
- `yarn lint` / `yarn typecheck` — Lint and type check  
- `yarn test` — Tests  

---

## License

Same as upstream: [MIT License](LICENSE).

---

## Acknowledgements

- **[PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai)** — Original on-device SLM assistant and UI.
- **[llama.rn](https://github.com/mybigday/llama.rn)** — React Native bindings for llama.cpp.
- **[LangChain](https://js.langchain.com/)** — Agent and message abstractions.
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — On-device inference.
