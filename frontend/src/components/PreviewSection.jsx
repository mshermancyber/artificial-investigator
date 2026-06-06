import { useState } from 'react';
import { formatTimestamp, truncateStr, safeStringify } from '../utils/parser';

const TABS = [
  { key: 'prompts', label: '📋 Extracted Prompts' },
  { key: 'conversation', label: '📄 Full Transcript' },
];

export default function PreviewSection({ prompts, conversation, format }) {
  const [activeTab, setActiveTab] = useState('prompts');

  return (
    <div className="preview-section visible">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`preview-pane ${activeTab === 'prompts' ? 'active' : ''}`}>
        {prompts.length === 0 ? (
          <EmptyMessage text="No user prompts found in this file." />
        ) : (
          prompts.map((p, i) => (
            <div className="turn" key={i}>
              <div className="turn-header">
                Turn {p.turn} — {formatTimestamp(p.timestamp)}
                {p.sessionId && (
                  <span className="session-tag">[{p.sessionId.substring(0, 8)}…]</span>
                )}
              </div>
              <div className="user-text">{p.text}</div>
            </div>
          ))
        )}
      </div>

      <div className={`preview-pane ${activeTab === 'conversation' ? 'active' : ''}`}>
        {conversation.length === 0 ? (
          <EmptyMessage text="No conversation found in this file." />
        ) : (
          conversation.map((item, i) => (
            <ConversationItem key={i} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyMessage({ text }) {
  return <div className="empty-message">{text}</div>;
}

function ConversationItem({ item }) {
  if (item.role === 'meta') {
    if (item.type === 'session_separator') {
      return (
        <div className="session-separator">
          Session: {item.sessionId}
        </div>
      );
    }
    return (
      <div className="turn">
        <div className="turn-header meta">📌 Chat Title: {item.title}</div>
      </div>
    );
  }

  const ts = formatTimestamp(item.timestamp);
  return (
    <div className="turn">
      <ConversationHeader item={item} ts={ts} />
      <ConversationBody item={item} />
    </div>
  );
}

function ConversationHeader({ item, ts }) {
  const turnPart = item.turn != null ? `Turn ${item.turn} — ` : '';
  if (item.type === 'prompt') {
    return <div className="turn-header">{turnPart}{ts} — 👤 User</div>;
  }
  if (item.type === 'interrupt') {
    return <div className="turn-header interrupt">{turnPart}{ts} — ⚠️ User Interrupt</div>;
  }
  if (item.type === 'tool_result') {
    return <div className="turn-header tool-result-header">{turnPart}{ts} — 🔧 Tool Result</div>;
  }
  if (item.role === 'assistant') {
    const modelLabel = item.model ? ` — 🤖 ${item.model}` : ' — 🤖 Assistant';
    return <div className="turn-header assistant">{turnPart}{ts}{modelLabel}</div>;
  }
  return null;
}

function ConversationBody({ item }) {
  if (item.type === 'prompt' || item.type === 'interrupt') {
    return <div className={item.type === 'interrupt' ? 'user-text interrupt-text' : 'user-text'}>{item.text}</div>;
  }

  if (item.type === 'tool_result') {
    return (
      <div className="tool-result">
        {item.isError && <div className="tool-error">⚠️ Error / Rejected by user</div>}
        <div className="tool-id">tool_use_id: {item.toolUseId || 'N/A'}</div>
        <div>{truncateStr(String(item.content))}</div>
      </div>
    );
  }

  if (item.role === 'assistant') {
    const blocks = item.blocks || [];
    return (
      <>
        {blocks.map((block, i) => (
          <AssistantBlock key={i} block={block} />
        ))}
      </>
    );
  }

  return null;
}

function AssistantBlock({ block }) {
  switch (block.type) {
    case 'thinking':
      if (block.encrypted) {
        return (
          <div className="thinking-encrypted">
            🔒 [Encrypted thinking — signature present, content hidden]
          </div>
        );
      }
      return (
        <div className="thinking-block">
          <div className="block-label">💭 Thinking:</div>
          {block.thinking}
        </div>
      );

    case 'text':
      return <div className="user-text">{block.text}</div>;

    case 'tool_use':
      return (
        <div className="tool-call">
          <div className="block-label">🔨 Tool: {block.name}</div>
          {Object.keys(block.input).length > 0 && (
            <pre className="tool-input">
              {safeStringify(block.input)}
            </pre>
          )}
        </div>
      );

    default:
      return null;
  }
}
