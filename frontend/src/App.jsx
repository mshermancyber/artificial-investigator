import { useState, useCallback } from 'react';
import DropZone from './components/DropZone';
import PreviewSection from './components/PreviewSection';
import {
  parseJSONL,
  buildPromptsOutput,
  buildConversationOutput,
  downloadFile,
} from './utils/parser';

const FORMAT_LABELS = {
  'claude-code': 'Claude Code',
  'continue': 'Continue',
  'cursor': 'Cursor',
  'chatgpt': 'ChatGPT',
  'aider': 'Aider',
  'codex': 'Codex CLI',
  'unknown': 'JSONL',
};

export default function App() {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);

  const handleFileLoaded = useCallback((name, text) => {
    let data;
    try {
      data = parseJSONL(text);
    } catch (err) {
      alert('Error parsing JSONL: ' + err.message);
      console.error(err);
      return;
    }
    setFileName(name);
    setParsed(data);
  }, []);

  const handleReset = useCallback(() => {
    setFileName('');
    setParsed(null);
  }, []);

  const hasData = parsed !== null;
  const fmtLabel = FORMAT_LABELS[parsed?.format] || 'JSONL';

  const prefix = parsed?.format === 'chatgpt' ? 'chatgpt'
    : parsed?.format === 'aider' ? 'aider'
    : parsed?.format === 'continue' ? 'continue'
    : parsed?.format === 'cursor' ? 'cursor'
    : 'claude';

  window._downloadPrompts = () => {
    if (!parsed?.prompts?.length) {
      alert('No prompts to download.');
      return;
    }
    const out = buildPromptsOutput(parsed.prompts, fileName, parsed.format);
    downloadFile(out, `${prefix}-prompts.txt`);
  };

  window._downloadConversation = () => {
    if (!parsed?.conversation?.length) {
      alert('No conversation to download.');
      return;
    }
    const out = buildConversationOutput(parsed.conversation, fileName, parsed.format);
    downloadFile(out, `${prefix}-conversation.txt`);
  };

  const assistantCount = parsed?.conversation?.filter((c) => c.role === 'assistant').length || 0;
  let stats = '';
  if (hasData) {
    stats = `${parsed.totalEvents} events · ${parsed.prompts.length} prompts · ${assistantCount} assistant turns`;
    if (parsed.sessions) {
      stats += ` · ${parsed.sessions} session${parsed.sessions > 1 ? 's' : ''}`;
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Conversation Investigator</h1>
        <span className="header-cursor" />
        <span className="header-sub">
          forensic session extraction &amp; evidence export
        </span>
      </header>

      <DropZone
        onFileLoaded={handleFileLoaded}
        hasData={hasData}
        fileName={fileName}
        stats={stats}
        formatLabel={fmtLabel}
        onReset={handleReset}
      />

      {hasData && (
        <PreviewSection
          prompts={parsed.prompts}
          conversation={parsed.conversation}
          format={parsed.format}
        />
      )}
    </div>
  );
}
