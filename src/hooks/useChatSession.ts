import React, {useRef} from 'react';

import {toJS, runInAction} from 'mobx';

import {SystemMessage, HumanMessage, AIMessage} from '@langchain/core/messages';

import {chatSessionRepository} from '../repositories/ChatSessionRepository';

import {randId} from '../utils';
import {L10nContext} from '../utils';
import {assistantId} from '../utils/chat';
import {chatSessionStore, modelStore, palStore, uiStore} from '../store';

import {MessageType, User} from '../utils/types';
import {createMultimodalWarning} from '../utils/errors';
import {resolveSystemMessages} from '../utils/systemPromptResolver';
import {removeThinkingParts} from '../utils/chat';
import {activateKeepAwake, deactivateKeepAwake} from '../utils/keepAwake';
import {toApiCompletionParams, CompletionParams} from '../utils/completionTypes';
import {
  LlamaRNChatModel,
  runAgent,
  searchWebTool,
  createReadEmailTool,
} from '../agent';
import {getGmailAccessToken} from '../services/gmail/gmailAuth';

/** Hint added to system prompt when agent has tools, so the model uses search_web and read_email instead of refusing. */
const AGENT_TOOL_SYSTEM_HINT = [
  '',
  'You have tools to get real-time information. You MUST use them when relevant—never say you do not have access to current data.',
  'Tools:',
  '- search_web(query): search the internet. Use it for: weather, news, sports scores, prices, or any fact that changes over time. Example: for "what\'s the weather?" call search_web with a query like "current weather [location]".',
  '- read_email(query?, maxResults?): read the user\'s Gmail. Use it when they ask to check email, inbox, or unread messages.',
  'Rule: For weather, news, or other live information, always call search_web first with an appropriate query, then answer from the results. Do not suggest the user go to a website—use the tool and give them the answer.',
].join('\n');

/** Convert session history to LangChain messages (system + history + new user message built separately). */
function sessionToLangChainMessages(
  currentMessages: MessageType.Any[],
  includeThinkingInContext: boolean | undefined,
): (SystemMessage | HumanMessage | AIMessage)[] {
  const includeThinking = includeThinkingInContext !== false;
  const out: (SystemMessage | HumanMessage | AIMessage)[] = [];
  for (const msg of currentMessages) {
    if (msg.type !== 'text') continue;
    const textMsg = msg as MessageType.Text;
    const text = textMsg.text?.trim() ?? '';
    if (!text) continue;
    const isAssistant = textMsg.author?.id === assistantId;
    if (isAssistant) {
      const content = includeThinking ? text : removeThinkingParts(text);
      out.push(new AIMessage(content));
    } else {
      out.push(new HumanMessage(text));
    }
  }
  return out;
}

/** Create empty assistant message and add to session; returns messageInfo for updates. */
async function createEmptyAssistantMessage(
  context: {id: number},
  assistant: User,
  conversationIdRef: string,
  hasImages: boolean,
): Promise<{createdAt: number; id: string; sessionId: string}> {
  const createdAt = Date.now();
  const emptyMessage: MessageType.Text = {
    author: assistant,
    createdAt,
    id: '',
    text: '',
    type: 'text',
    metadata: {
      contextId: context.id,
      conversationId: conversationIdRef,
      copyable: true,
      multimodal: hasImages,
    },
  };
  await chatSessionStore.addMessageToCurrentSession(emptyMessage);
  return {
    createdAt,
    id: emptyMessage.id,
    sessionId: chatSessionStore.activeSessionId!,
  };
}

export const useChatSession = (
  currentMessageInfo: React.MutableRefObject<{
    createdAt: number;
    id: string;
    sessionId: string;
  } | null>,
  user: User,
  assistant: User,
) => {
  const l10n = React.useContext(L10nContext);
  const conversationIdRef = useRef<string>(randId());

  const addMessage = async (message: MessageType.Any) => {
    await chatSessionStore.addMessageToCurrentSession(message);
  };

  const addSystemMessage = async (text: string, metadata = {}) => {
    const textMessage: MessageType.Text = {
      author: assistant,
      createdAt: Date.now(),
      id: randId(),
      text,
      type: 'text',
      metadata: {system: true, ...metadata},
    };
    await addMessage(textMessage);
  };

  const handleSendPress = async (message: MessageType.PartialText) => {
    const context = modelStore.context;
    if (!context) {
      await addSystemMessage(l10n.chat.modelNotLoaded);
      return;
    }

    // Extract imageUris from the message object
    const imageUris = message.imageUris;
    // Check if we have images in the current message
    const hasImages = imageUris && imageUris.length > 0;

    const isMultimodalEnabled = await modelStore.isMultimodalEnabled();
    if (hasImages && !isMultimodalEnabled) {
      uiStore.setChatWarning(
        createMultimodalWarning(l10n.chat.multimodalNotEnabled),
      );
    }

    // Get the current session messages BEFORE adding the new user message
    // Use toJS to get a snapshot and avoid MobX reactivity issues
    const currentMessages = toJS(chatSessionStore.currentSessionMessages);

    // Create the user message with embedded images
    const textMessage: MessageType.Text = {
      author: user,
      createdAt: Date.now(),
      id: '', // Will be set by the database
      text: message.text,
      type: 'text',
      imageUris: hasImages ? imageUris : undefined, // Include images directly in the text message
      metadata: {
        contextId: context.id,
        conversationId: conversationIdRef.current,
        copyable: true,
        multimodal: hasImages, // Mark as multimodal if it has images
      },
    };
    await addMessage(textMessage);
    modelStore.setInferencing(true);
    modelStore.setIsStreaming(false);
    chatSessionStore.setIsGenerating(true);

    // Keep screen awake during completion
    try {
      activateKeepAwake();
    } catch (error) {
      console.error('Failed to activate keep awake during chat:', error);
      // Continue with chat even if keep awake fails
    }

    const activeSession = chatSessionStore.sessions.find(
      s => s.id === chatSessionStore.activeSessionId,
    );

    // Resolve system messages for agent context
    const pal = activeSession?.activePalId
      ? palStore.pals.find(p => p.id === activeSession.activePalId)
      : null;
    const systemMessages = resolveSystemMessages({
      pal,
      model: modelStore.activeModel,
    });
    const systemContentWithToolHint =
      systemMessages.length > 0
        ? systemMessages[0].content + AGENT_TOOL_SYSTEM_HINT
        : AGENT_TOOL_SYSTEM_HINT.trim();

    const sessionCompletionSettings =
      await chatSessionStore.getCurrentCompletionSettings();
    const includeThinkingInContext: boolean | undefined = (
      sessionCompletionSettings as CompletionParams
    )?.include_thinking_in_context;
    const messageInfo = await createEmptyAssistantMessage(
      context,
      assistant,
      conversationIdRef.current,
      Boolean(hasImages && isMultimodalEnabled),
    );
    currentMessageInfo.current = messageInfo;

    const langChainMessages = [
      new SystemMessage(systemContentWithToolHint),
      ...sessionToLangChainMessages(
        currentMessages,
        includeThinkingInContext !== false,
      ),
      hasImages && isMultimodalEnabled && imageUris?.length
        ? new HumanMessage({
            content: [
              {type: 'text', text: message.text},
              ...imageUris.map((path: string) => ({
                type: 'image_url' as const,
                image_url: {url: path},
              })),
            ],
          })
        : new HumanMessage(message.text),
    ];

    const stopWords = toJS(modelStore.activeModel?.stopWords);
    const completionParamsWithAppProps = {
      ...sessionCompletionSettings,
      emit_partial_completion: false,
      stop: stopWords,
    };
    const cleanCompletionParams = toApiCompletionParams(
      completionParamsWithAppProps as CompletionParams,
    );
    if (cleanCompletionParams.enable_thinking) {
      cleanCompletionParams.reasoning_format = 'auto';
    }

    const tools = [searchWebTool, createReadEmailTool(getGmailAccessToken)];
    const model = new LlamaRNChatModel({
      context,
      completionParams: cleanCompletionParams,
      tools,
      stopWords,
    });

    try {
      const agentPromise = runAgent(model, tools, langChainMessages);
      modelStore.registerCompletionPromise(agentPromise);
      const {text: finalText} = await agentPromise;
      modelStore.clearCompletionPromise();

      await chatSessionStore.updateMessage(
        currentMessageInfo.current.id,
        currentMessageInfo.current.sessionId,
        {
          text: finalText,
          metadata: {
            copyable: true,
            multimodal: hasImages && isMultimodalEnabled,
            completionResult: {content: finalText},
          },
        },
      );
      modelStore.setInferencing(false);
      modelStore.setIsStreaming(false);
      chatSessionStore.setIsGenerating(false);
    } catch (error) {
      modelStore.clearCompletionPromise();
      console.error('Agent/completion error:', error);
      modelStore.setInferencing(false);
      modelStore.setIsStreaming(false);
      chatSessionStore.setIsGenerating(false);

      // Clean up the empty assistant message that was created before the error
      if (currentMessageInfo.current) {
        try {
          await chatSessionRepository.deleteMessage(
            currentMessageInfo.current.id,
          );
          // Also remove from local state
          const session = chatSessionStore.sessions.find(
            s => s.id === currentMessageInfo.current!.sessionId,
          );
          if (session) {
            runInAction(() => {
              session.messages = session.messages.filter(
                msg => msg.id !== currentMessageInfo.current!.id,
              );
            });
          }
        } catch (cleanupError) {
          console.error(
            'Failed to clean up empty message after error:',
            cleanupError,
          );
        }
      }

      const errorMessage = (error as Error).message;
      if (errorMessage.includes('network')) {
        // TODO: This can be removed. We don't use network for chat.
        await addSystemMessage(l10n.common.networkError);
      } else {
        await addSystemMessage(`${l10n.chat.completionFailed}${errorMessage}`);
      }
    } finally {
      // Always try to deactivate keep awake in finally block
      try {
        deactivateKeepAwake();
      } catch (error) {
        console.error('Failed to deactivate keep awake after chat:', error);
      }
    }
  };

  const handleResetConversation = async () => {
    conversationIdRef.current = randId();
    await addSystemMessage(l10n.chat.conversationReset);
  };

  const handleStopPress = async () => {
    const context = modelStore.context;
    if (modelStore.inferencing && context) {
      context.stopCompletion();
    }
    modelStore.setInferencing(false);
    modelStore.setIsStreaming(false);
    chatSessionStore.setIsGenerating(false);

    // Deactivate keep awake when stopping completion
    try {
      deactivateKeepAwake();
    } catch (error) {
      console.error(
        'Failed to deactivate keep awake after stopping chat:',
        error,
      );
    }
  };

  return {
    handleSendPress,
    handleResetConversation,
    handleStopPress,
    // Add a method to check if multimodal is enabled
    isMultimodalEnabled: async () => await modelStore.isMultimodalEnabled(),
  };
};
