import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CharacterDto, ChatMessageDto } from '@roleagent/shared';
import {
  clearConversationMessages,
  deleteChatMessage,
  getCharacterConversation,
  regenerateLastAssistant,
  sendChat,
  streamChat,
  streamRegenerate,
  updateChatMessage,
} from '../api';
import { splitAssistantMessageParts } from '../utils/assistantMessageParts';

type ChatMessage = ChatMessageDto;

interface ChatPanelProps {
  character: CharacterDto;
  detailOpen: boolean;
  onToggleDetail: () => void;
  detailSlot: ReactNode;
  activeWorldBookCount: number;
  onConversationReady: (conversationId: string, activeWorldBookIds: string[]) => void;
  streamEnabled: boolean;
}

export function ChatPanel({
  character,
  detailOpen,
  onToggleDetail,
  detailSlot,
  activeWorldBookCount,
  onConversationReady,
  streamEnabled,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [streamingMode, setStreamingMode] = useState<'send' | 'regenerate' | null>(null);
  const [mutatingMessageId, setMutatingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);

  const actionBusy =
    sending || clearing || regenerating || streamingMode !== null || mutatingMessageId !== null;
  const lastMessage = messages.at(-1);
  const lastAssistantMessageId =
    lastMessage?.role === 'assistant' ? lastMessage.id : null;

  const isAbortError = (err: unknown): boolean =>
    err instanceof Error && err.name === 'AbortError';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConversationId(null);
    setEditingMessageId(null);
    setEditContent('');
    getCharacterConversation(character.id)
      .then((res) => {
        if (cancelled) return;
        onConversationReady(res.conversation.id, res.activeWorldBookIds);
        setConversationId(res.conversation.id);
        setMessages(res.messages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [character.id, onConversationReady]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
    };
  }, []);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      setError('消息不能为空');
      return;
    }
    setError(null);
    const pendingId = `pending-${Date.now()}`;
    const pendingAssistantId = `pending-assistant-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: pendingId,
      conversationId: conversationId ?? '',
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    const assistantMsg: ChatMessage = {
      id: pendingAssistantId,
      conversationId: conversationId ?? '',
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setSending(true);
    try {
      if (!streamEnabled) {
        const res = await sendChat({
          characterId: character.id,
          message: text,
        });
        if (!res.conversation || !res.messages || !res.activeWorldBookIds) {
          throw new Error('Chat response missing conversation data');
        }
        onConversationReady(res.conversation.id, res.activeWorldBookIds);
        setConversationId(res.conversation.id);
        setMessages(res.messages);
        return;
      }
      setStreamingMode('send');
      const abortController = new AbortController();
      streamAbortControllerRef.current = abortController;
      await streamChat(
        {
          characterId: character.id,
          message: text,
        },
        {
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === 'delta') {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === pendingAssistantId
                    ? { ...message, content: `${message.content}${event.content}` }
                    : message,
                ),
              );
              return;
            }
            if (event.type === 'done') {
              onConversationReady(event.conversation.id, event.activeWorldBookIds);
              setConversationId(event.conversation.id);
              setMessages(event.messages);
            }
          },
        },
      );
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((message) => message.id !== pendingId));
      setMessages((prev) =>
        prev.filter((message) => message.id !== pendingAssistantId),
      );
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSending(false);
      setStreamingMode(null);
      streamAbortControllerRef.current = null;
    }
  };

  const startEditing = (message: ChatMessage) => {
    if (actionBusy) return;
    setEditingMessageId(message.id);
    setEditContent(message.content);
    setError(null);
  };

  const handleSaveEdit = async (messageId: string) => {
    if (!conversationId) return;
    const content = editContent.trim();
    if (!content) {
      setError('Message cannot be empty');
      return;
    }
    setError(null);
    setMutatingMessageId(messageId);
    try {
      const res = await updateChatMessage(conversationId, messageId, { content });
      onConversationReady(res.conversation.id, res.activeWorldBookIds);
      setConversationId(res.conversation.id);
      setMessages(res.messages);
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutatingMessageId(null);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!conversationId || actionBusy) return;
    if (!window.confirm('Delete this message?')) return;
    setError(null);
    setMutatingMessageId(messageId);
    try {
      const res = await deleteChatMessage(conversationId, messageId);
      onConversationReady(res.conversation.id, res.activeWorldBookIds);
      setConversationId(res.conversation.id);
      setMessages(res.messages);
      if (editingMessageId === messageId) {
        setEditingMessageId(null);
        setEditContent('');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutatingMessageId(null);
    }
  };

  const handleClearMessages = async () => {
    if (!conversationId || actionBusy || messages.length === 0) return;
    if (!window.confirm('Clear the current character chat history?')) return;
    setError(null);
    setClearing(true);
    try {
      const res = await clearConversationMessages(conversationId);
      onConversationReady(res.conversation.id, res.activeWorldBookIds);
      setConversationId(res.conversation.id);
      setMessages(res.messages);
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  const handleRegenerate = async () => {
    if (!conversationId || actionBusy || !lastAssistantMessageId) return;
    const originalMessage = messages.find((message) => message.id === lastAssistantMessageId);
    if (!originalMessage) return;
    setError(null);
    setRegenerating(true);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === lastAssistantMessageId
          ? { ...message, content: '' }
          : message,
      ),
    );
    try {
      if (!streamEnabled) {
        const res = await regenerateLastAssistant(conversationId);
        if (!res.conversation || !res.messages || !res.activeWorldBookIds) {
          throw new Error('Regenerate response missing conversation data');
        }
        onConversationReady(res.conversation.id, res.activeWorldBookIds);
        setConversationId(res.conversation.id);
        setMessages(res.messages);
        setEditingMessageId(null);
        setEditContent('');
        return;
      }
      setStreamingMode('regenerate');
      const abortController = new AbortController();
      streamAbortControllerRef.current = abortController;
      let partialContent = '';
      await streamRegenerate(conversationId, {
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.type === 'delta') {
            partialContent += event.content;
            setMessages((prev) =>
              prev.map((message) =>
                message.id === lastAssistantMessageId
                  ? { ...message, content: partialContent }
                  : message,
              ),
            );
            return;
          }
          if (event.type === 'done') {
            onConversationReady(event.conversation.id, event.activeWorldBookIds);
            setConversationId(event.conversation.id);
            setMessages(event.messages);
            setEditingMessageId(null);
            setEditContent('');
          }
        },
      });
    } catch (err: unknown) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === originalMessage.id ? originalMessage : message,
        ),
      );
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRegenerating(false);
      setStreamingMode(null);
      streamAbortControllerRef.current = null;
    }
  };

  const handleStopStreaming = () => {
    streamAbortControllerRef.current?.abort();
  };

  return (
    <section className="workspace-panel chat-panel chat-main">
      <header className="chat-header">
        <div className="chat-title-block">
          <p className="eyebrow">对话</p>
          <h2>{character.name}</h2>
          <p className="chat-description">
            {character.description ?? '暂无简介。打开详情可编辑或导出角色。'}
          </p>
        </div>
        <div className="chat-header-actions">
          <span className="count-pill">世界书 {activeWorldBookCount}</span>
          <span className="count-pill">{messages.length}</span>
          <button
            className="button button--danger"
            type="button"
            onClick={handleClearMessages}
            disabled={loading || actionBusy || !conversationId || messages.length === 0}
          >
            {clearing ? 'Clearing...' : 'Clear'}
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={onToggleDetail}
            aria-expanded={detailOpen}
          >
            {detailOpen ? '隐藏详情' : '详情'}
          </button>
        </div>
      </header>

      {detailOpen && <div className="chat-detail-drawer">{detailSlot}</div>}

      <div className="chat-history" aria-live="polite">
        {loading && <p className="empty-state">正在加载聊天记录...</p>}
        {!loading && messages.length === 0 && (
          <div className="chat-empty">
            <strong>还没有消息</strong>
            <p>发送第一条消息开始对话。</p>
          </div>
        )}
        {!loading && messages.length > 0 && (
          <ol className="message-list">
            {messages.map((m, i) => {
              const parts = m.role === 'assistant'
                ? splitAssistantMessageParts(m.content)
                : null;
              const visibleContent = parts?.visibleContent ?? m.content;
              const thinkingBlocks = parts?.thinkingBlocks ?? [];
              const isStreamingMessage =
                m.id.startsWith('pending-') ||
                (streamingMode !== null && m.id === lastAssistantMessageId);
              const thinkingSummary =
                isStreamingMessage || parts?.hasOpenThinkingBlock
                  ? 'Thinking...'
                  : 'Thinking hidden';
              const hiddenUpdateCount = parts?.updateVariableBlocks.length ?? 0;
              const hiddenStateCount = parts?.variableStateBlocks.length ?? 0;
              return (
              <li className={`message-row message-row--${m.role}`} key={i}>
                <article className="message-bubble">
                  <span className="message-role">
                    {m.role === 'user' ? '你' : character.name}
                  </span>
                  {editingMessageId === m.id ? (
                    <form
                      className="message-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveEdit(m.id);
                      }}
                    >
                      <textarea
                        className="message-edit-textarea"
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        disabled={mutatingMessageId === m.id}
                        rows={4}
                      />
                      <div className="message-edit-actions">
                        <button
                          className="button button--primary"
                          type="submit"
                          disabled={mutatingMessageId === m.id}
                        >
                          {mutatingMessageId === m.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => {
                            setEditingMessageId(null);
                            setEditContent('');
                          }}
                          disabled={mutatingMessageId === m.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {thinkingBlocks.length > 0 && (
                        <details className="message-thinking">
                          <summary>{thinkingSummary}</summary>
                          <pre>{thinkingBlocks.join('\n\n')}</pre>
                        </details>
                      )}
                      <p>{visibleContent}</p>
                      {(hiddenUpdateCount > 0 || hiddenStateCount > 0) && (
                        <div className="message-hidden-parts">
                          {hiddenUpdateCount > 0 && <span>Variable update hidden</span>}
                          {hiddenStateCount > 0 && <span>Variable state hidden</span>}
                        </div>
                      )}
                    </>
                  )}
                  {!m.id.startsWith('pending-') && (
                    <div className="message-actions">
                      <button
                        className="message-action-button"
                        type="button"
                        onClick={() => startEditing(m)}
                        disabled={actionBusy}
                      >
                        Edit
                      </button>
                      <button
                        className="message-action-button message-action-button--danger"
                        type="button"
                        onClick={() => void handleDeleteMessage(m.id)}
                        disabled={actionBusy}
                      >
                        {mutatingMessageId === m.id ? 'Deleting...' : 'Delete'}
                      </button>
                      {m.id === lastAssistantMessageId && (
                        <button
                          className="message-action-button"
                          type="button"
                          onClick={() => void handleRegenerate()}
                          disabled={actionBusy}
                        >
                          {regenerating ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              </li>
              );
            })}
          </ol>
        )}
      </div>

      <form className="chat-composer" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={actionBusy}
          placeholder="输入消息..."
        />
        <button className="button button--primary" type="submit" disabled={actionBusy}>
          {sending ? '发送中...' : '发送'}
        </button>
        {streamingMode !== null && (
          <button
            className="button button--danger"
            type="button"
            onClick={handleStopStreaming}
          >
            Stop
          </button>
        )}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
