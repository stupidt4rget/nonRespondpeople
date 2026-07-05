import { useState, type FormEvent } from 'react';
import type { CharacterDto } from '@roleagent/shared';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
      const res = await sendChat({ characterId: character.id, message: text });
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
    <section>
      <h2>Chat with {character.name}</h2>
      <div>
        {messages.length === 0 && <p>No messages yet</p>}
        {messages.length > 0 && (
          <ul>
            {messages.map((m, i) => (
              <li key={i}>
                <strong>{m.role}:</strong> {m.content}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={sending}>
          {sending ? 'Sending...' : 'Send'}
        </button>
        {error !== null && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </section>
  );
}
