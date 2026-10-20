import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { chatAssistantStream } from '../api';
import { useToast } from '../App';

interface Msg { role: 'user' | 'assistant'; content: string }

export default function AssistantDrawer({ nodeId, nodeTitle }: { nodeId: number; nodeTitle: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const msgsEnd = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function ask() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      await chatAssistantStream(
        { node_id: nodeId, question: q, history: msgs.slice(-6) },
        (delta) => setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + delta };
          return copy;
        }),
      );
    } catch {
      toast('问答失败，请重试', true);
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <>
      <button className="ask-fab" title="问 AI：随时提问学习中不懂的问题" onClick={() => setOpen(true)}>
        💬
      </button>
      {open && (
        <>
          <div className="drawer-mask" onClick={() => !streaming && setOpen(false)} />
          <div className="drawer">
            <header>
              <div className="t">
                学习问答
                <small>正在学习：{nodeTitle} · AI 会结合本节内容回答</small>
              </div>
              <button title="清空会话" onClick={() => setMsgs([])}>🗑</button>
              <button title="关闭" onClick={() => setOpen(false)}>✕</button>
            </header>
            <div className="msgs">
              {msgs.length === 0 && (
                <div className="msg ai">
                  有什么不懂的尽管问，比如：「这个概念能不能举个生活中的例子？」
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.role === 'assistant'
                    ? <><Markdown>{m.content}</Markdown>{streaming && i === msgs.length - 1 && <span className="cursor" />}</>
                    : m.content}
                </div>
              ))}
              <div ref={msgsEnd} />
            </div>
            <footer>
              <textarea
                value={input}
                disabled={streaming}
                placeholder="输入你的问题…（Enter 发送）"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
                }}
              />
              <button className="btn small" onClick={ask} disabled={streaming || !input.trim()}>
                {streaming ? <span className="spinner" /> : '发送'}
              </button>
            </footer>
          </div>
        </>
      )}
    </>
  );
}
