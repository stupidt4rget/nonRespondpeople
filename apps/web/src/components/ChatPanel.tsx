import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CharacterDto } from '@roleagent/shared';
import { getCharacterConversation, sendChat } from '../api';

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCharacterConversation(character.id)
      .then((res) => {
        if (cancelled) return;
        onConversationReady(res.conversation.id, res.activeWorldBookIds);
        if (res.messages.length > 0) {
          setMessages(res.messages);
        } else if (character.firstMessage) {
          setMessages([
            {
              role: 'assistant',
              content: character.firstMessage,
              createdAt: new Date().toISOString(),
            },
          ]);
        } else {
          setMessages([]);
        }
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
  }, [character.id, character.firstMessage, onConversationReady]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      setError('消息不能为空');
      return;
    }
    setError(null);
    const userMsg: ChatMessage = {
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
      }
      if (res.messages && res.messages.length > 0) {
        setMessages(res.messages);
      } else {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: res.reply,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
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
                  <p>{m.content}</p>
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
          disabled={sending}
          placeholder="输入消息..."
        />
        <button className="button button--primary" type="submit" disabled={sending}>
          {sending ? '发送中...' : '发送'}
        </button>
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
