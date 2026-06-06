import { useState, useCallback, useRef } from 'react';

const FORMAT_BADGES = {
  'Claude Code': 'badge-cc',
  'Continue': 'badge-continue',
  'Cursor': 'badge-cursor',
  'ChatGPT': 'badge-chatgpt',
  'Aider': 'badge-aider',
  'Codex CLI': 'badge-codex',
};

export default function DropZone({ onFileLoaded, hasData, fileName, stats, formatLabel, onReset }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragOut = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file, onFileLoaded);
    },
    [onFileLoaded]
  );

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (file) readFile(file, onFileLoaded);
  };

  // ── loaded state ──────────────────────────────────────
  if (hasData) {
    const badgeCls = FORMAT_BADGES[formatLabel] || '';
    return (
      <div className="drop-zone loaded" onDragOver={handleDrag} onDrop={handleDrop}>
        <div className="file-info">
          <span className="file-icon">✅</span>
          <span className="filename">{fileName}</span>
          <span className={`format-badge ${badgeCls}`}>{formatLabel}</span>
          <span className="stats">{stats}</span>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => window._downloadPrompts?.()}>
            ⬇ Export Prompts
          </button>
          <button className="btn primary" onClick={() => window._downloadConversation?.()}>
            ⬇ Export Conversation
          </button>
          <button className="btn" onClick={onReset}>
            ↺ New Evidence
          </button>
        </div>
      </div>
    );
  }

  // ── empty state ───────────────────────────────────────
  return (
    <div
      className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
      onClick={handleClick}
      onDragOver={handleDrag}
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jsonl,.json,.md"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <div className="drop-zone-icon">📂</div>
      <div className="drop-zone-text">
        <strong>[ DROP EVIDENCE FILE ]</strong>
      </div>
      <div className="drop-zone-hint">
        .jsonl / .json / .md — Claude Code · Continue · Cursor · ChatGPT · Aider
      </div>
    </div>
  );
}

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB

function readFile(file, cb) {
  if (file.size > MAX_FILE_SIZE) {
    alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => cb(file.name, e.target.result);
  reader.onerror = () => alert('Error reading file.');
  reader.readAsText(file);
}
