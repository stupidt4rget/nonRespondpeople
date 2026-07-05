import { useState, type FormEvent } from 'react';
import type { CharacterDto, ChatHistoryMessage } from '@roleagent/shared';
import { sendChat } from '../api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ChatPanelProps {
  character: CharacterDto;
}

export function ChatPanel({ character }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (character.firstMessage) {
      return [
        {
          role: 'assistant',
          content: character.firstMessage,
          createdAt: new Date().toISOString(),
        },
      ];
    }
    return [];
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      setError('message must not be empty');
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
      const history: ChatHistoryMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await sendChat({
        characterId: character.id,
        message: text,
        history,
      });
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="workspace-panel chat-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2>Chat with {character.name}</h2>
        </div>
        <span className="count-pill">{messages.length}</span>
      </header>

      <div className="chat-history" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <strong>No messages yet</strong>
            <p>Send the first message to begin the scene.</p>
          </div>
        )}
        {messages.length > 0 && (
          <ol className="message-list">
            {messages.map((m, i) => (
              <li className={`message-row message-row--${m.role}`} key={i}>
                <article className="message-bubble">
                  <span className="message-role">
                    {m.role === 'user' ? 'You' : character.name}
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
          placeholder="Type a message..."
        />
        <button className="button button--primary" type="submit" disabled={sending}>
          {sending ? 'Sending...' : 'Send'}
        </button>
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
