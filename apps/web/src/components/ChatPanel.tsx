import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CharacterDto, ChatMessageDto } from '@roleagent/shared';
import {
  clearConversationMessages,
  deleteChatMessage,
  getCharacterConversation,
  regenerateLastAssistant,
  sendChat,
  updateChatMessage,
} from '../api';

type ChatMessage = ChatMessageDto;

interface ChatPanelProps {
  character: CharacterDto;
  detailOpen: boolean;
  onToggleDetail: () => void;
  detailSlot: ReactNode;
  activeWorldBookCount: number;
  onConversationReady: (conversationId: string, activeWorldBookIds: string[]) => void;
}

export function ChatPanel({
  character,
  detailOpen,
  onToggleDetail,
  detailSlot,
  activeWorldBookCount,
  onConversationReady,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [mutatingMessageId, setMutatingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const actionBusy =
    sending || clearing || regenerating || mutatingMessageId !== null;
  const lastMessage = messages.at(-1);
  const lastAssistantMessageId =
    lastMessage?.role === 'assistant' ? lastMessage.id : null;

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

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      setError('消息不能为空');
      return;
    }
    setError(null);
    const pendingId = `pending-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: pendingId,
      conversationId: conversationId ?? '',
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const res = await sendChat({
        characterId: character.id,
        message: text,
      });
      if (res.conversation) {
        onConversationReady(res.conversation.id, res.activeWorldBookIds ?? []);
        setConversationId(res.conversation.id);
      }
      if (res.messages && res.messages.length > 0) {
        setMessages(res.messages);
      } else if (res.assistantMessage) {
        const assistantMessage = res.assistantMessage;
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((message) => message.id !== pendingId));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
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
    setError(null);
    setRegenerating(true);
    try {
      const res = await regenerateLastAssistant(conversationId);
      onConversationReady(res.conversation.id, res.activeWorldBookIds);
      setConversationId(res.conversation.id);
      setMessages(res.messages);
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
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
            {messages.map((m, i) => (
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
                    <p>{m.content}</p>
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
            ))}
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
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
