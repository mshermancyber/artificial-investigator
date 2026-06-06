/**
 * Parse Claude Code, Continue, Cursor, ChatGPT, OR Aider session files.
 *
 * Auto-detection:
 *   - eventName === "chatInteraction"                → Continue (JSONL)
 *   - type ∈ {user, assistant, system}               → Claude Code (JSONL)
 *   - role ∈ {user, assistant} with message.content  → Cursor (JSONL)
 *   - text starts with "[" and has "mapping" field   → ChatGPT (JSON array)
 *   - text starts with "# " or has "#### " lines     → Aider (Markdown)
 *
 * Returns { format, prompts, conversation, totalEvents, sessions? }
 */

const MAX_TOOL_RESULT_CHARS = 5000;

// ── Top-level dispatch ───────────────────────────────────

export function parseJSONL(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { format: 'unknown', prompts: [], conversation: [], totalEvents: 0 };
  }

  // ── ChatGPT detection: JSON array with "mapping" field ──
  if (trimmed.startsWith('[')) {
    // Guard against enormous single-line JSON (ChatGPT exports can be 100+ MB)
    if (trimmed.length > 300 * 1024 * 1024) {
      return { format: 'chatgpt', prompts: [], conversation: [], totalEvents: 0,
               error: 'File too large for browser parsing (>300 MB). Use a smaller export or split the file.' };
    }
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0 && arr[0].mapping) {
        return parseChatGPT(arr);
      }
    } catch { /* fall through */ }
  }

  // ── Aider detection: markdown with #### / > markers ──
  if (trimmed.startsWith('# ') || /^####\s/m.test(trimmed)) {
    return parseAider(trimmed);
  }

  // ── JSONL formats ────────────────────────────────────
  const lines = trimmed.split('\n').filter((l) => l.trim());

  let format = 'unknown';
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.eventName === 'chatInteraction') {
        format = 'continue';
        break;
      }
      if (obj.type === 'session_meta') {
        format = 'codex';
        break;
      }
      if (obj.type === 'user' || obj.type === 'assistant' || obj.type === 'system') {
        format = 'claude-code';
        break;
      }
      if ((obj.role === 'user' || obj.role === 'assistant') && obj.message?.content) {
        format = 'cursor';
        break;
      }
    } catch { /* keep scanning */ }
  }

  if (format === 'continue') return parseContinue(lines);
  if (format === 'cursor')   return parseCursor(lines);
  if (format === 'codex')    return parseCodex(lines);
  return parseClaudeCode(lines);
}

// ═══════════════════════════════════════════════════════════
//  Claude Code parser (unchanged logic)
// ═══════════════════════════════════════════════════════════

function parseClaudeCode(lines) {
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i])); } catch { /* skip */ }
  }

  events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  const prompts = [];
  const conversation = [];
  let turnNum = 0;

  for (const ev of events) {
    if (ev.type === 'user' && ev.message?.role === 'user') {
      if (ev.toolUseResult) {
        const content = extractUserContent(ev.message.content);
        conversation.push({
          turn: turnNum,
          timestamp: ev.timestamp,
          role: 'user',
          type: 'tool_result',
          toolUseId: content?.tool_use_id || null,
          content: content?.content ?? '',
          isError: !!content?.is_error,
        });
        continue;
      }

      const rawText = coerceContentString(ev.message.content);
      if (rawText.startsWith('[Request interrupted')) {
        conversation.push({
          turn: turnNum, timestamp: ev.timestamp,
          role: 'user', type: 'interrupt', text: rawText,
        });
        continue;
      }

      turnNum++;
      const promptText = coerceContentString(ev.message.content);
      if (promptText.trim()) {
        prompts.push({ turn: turnNum, timestamp: ev.timestamp, text: promptText });
        conversation.push({
          turn: turnNum, timestamp: ev.timestamp,
          role: 'user', type: 'prompt', text: promptText,
        });
      }
    } else if (ev.type === 'assistant' && ev.message?.role === 'assistant') {
      const content = ev.message.content;
      if (!Array.isArray(content)) continue;
      const blocks = content.map(parseContentBlock).filter(Boolean);
      if (blocks.length > 0) {
        conversation.push({
          turn: turnNum, timestamp: ev.timestamp,
          role: 'assistant', model: ev.message.model || null, blocks,
        });
      }
    } else if (ev.type === 'ai-title' && ev.aiTitle) {
      conversation.push({
        turn: turnNum, timestamp: ev.timestamp,
        role: 'meta', type: 'title', title: ev.aiTitle,
      });
    }
  }

  return { format: 'claude-code', prompts, conversation, totalEvents: events.length };
}

function parseContentBlock(block) {
  switch (block.type) {
    case 'text':    return { type: 'text', text: block.text };
    case 'thinking': {
      const isEncrypted = !block.thinking && !!block.signature;
      return { type: 'thinking', thinking: block.thinking || '', signature: block.signature || '', encrypted: isEncrypted };
    }
    case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input || {} };
    default:         return null;
  }
}

function coerceContentString(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text').map((t) => t.text ?? '').join('\n');
}

function extractUserContent(content) {
  if (!Array.isArray(content)) return null;
  const tr = content.find((c) => c.type === 'tool_result');
  if (!tr) return null;
  return {
    tool_use_id: tr.tool_use_id || null,
    content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
    is_error: !!tr.is_error,
  };
}

// ═══════════════════════════════════════════════════════════
//  Continue parser
//
//  Continue stores conversation history as bare section-marker
//  tags (NOT proper XML — no closing tags in the prompt):
//
//    <system>
//    <important_rules>
//    ...
//    </important_rules>
//
//    <user>
//    hello
//
//    <assistant>
//    Hello! How can I help?
//
//    <user>
//    what about...
//
//  The completion field uses <assistant>...</assistant> wrappers
//  around each streamed token.
// ═══════════════════════════════════════════════════════════

const SECTION_RE = /^<(system|user|assistant|important_rules|\/important_rules)>$/;

function parseContinue(lines) {
  const interactions = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.eventName === 'chatInteraction') interactions.push(obj);
    } catch { /* skip */ }
  }

  // Group by sessionId and sort by timestamp
  const sessions = new Map();
  for (const ix of interactions) {
    const sid = ix.sessionId || 'unknown';
    if (!sessions.has(sid)) sessions.set(sid, []);
    sessions.get(sid).push(ix);
  }
  for (const [, list] of sessions) {
    list.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  }

  const allPrompts = [];
  const allConversation = [];
  let globalTurn = 0;

  for (const [sessionId, ixList] of sessions) {
    // Build full conversation from the LAST interaction (has complete history)
    const { prompts: sessPrompts, conversation: sessConv } = buildContinueSession(ixList, sessionId);

    for (const p of sessPrompts) {
      globalTurn++;
      p.turn = globalTurn;
      allPrompts.push(p);
    }
    for (const c of sessConv) {
      if (c.turn != null) c.turn = c.turn + (globalTurn - sessPrompts.length);
      allConversation.push(c);
    }
    globalTurn = allPrompts.length;

    if (allConversation.length > 0) {
      allConversation.push({
        turn: null, timestamp: null,
        role: 'meta', type: 'session_separator', sessionId,
      });
    }
  }

  return {
    format: 'continue',
    prompts: allPrompts,
    conversation: allConversation,
    totalEvents: interactions.length,
    sessions: sessions.size,
  };
}

/**
 * Parse a Continue session.
 *
 * We use the LAST interaction's `prompt` to get the complete
 * conversation history, then append its `completion` as the final
 * assistant response.
 */
function buildContinueSession(ixList, sessionId) {
  const prompts = [];
  const conversation = [];
  let turnNum = 0;

  // Use the last interaction to get the full history
  const lastIx = ixList[ixList.length - 1];
  if (!lastIx) return { prompts, conversation };

  // Parse the prompt into sections
  const promptSections = parseContinuePrompt(lastIx.prompt || '');

  // Also collect all unique user texts from individual interactions
  // (each interaction's prompt ends with a <user> section — the new prompt for that turn)
  const seenUserTexts = new Set();

  for (const ix of ixList) {
    const sections = parseContinuePrompt(ix.prompt || '');
    // Find the LAST user section — that's this turn's prompt
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].tag === 'user') {
        const text = sections[i].content.trim();
        if (text && !seenUserTexts.has(text)) {
          seenUserTexts.add(text);
          turnNum++;
          prompts.push({
            turn: turnNum,
            _sessionTurn: turnNum,
            timestamp: ix.timestamp,
            text,
            sessionId,
          });
        }
        break;
      }
    }
  }

  // Build full conversation from the last interaction's complete prompt
  // + its completion as the final assistant response
  turnNum = 0;
  const seenConvTexts = new Set();

  for (const section of promptSections) {
    const text = section.content.trim();

    if (section.tag === 'system' || section.tag === 'important_rules' || section.tag === '/important_rules') {
      // Skip system/rule sections in conversation output (they're boilerplate)
      continue;
    }

    if (section.tag === 'user') {
      if (text && !seenConvTexts.has('u:' + text)) {
        seenConvTexts.add('u:' + text);
        turnNum++;
        prompts.forEach(p => { if (p.text.trim() === text) p._convTurn = turnNum; });
        conversation.push({
          turn: turnNum,
          timestamp: lastIx.timestamp,
          role: 'user',
          type: 'prompt',
          text,
          sessionId,
        });
      }
    } else if (section.tag === 'assistant') {
      if (text && !seenConvTexts.has('a:' + text)) {
        seenConvTexts.add('a:' + text);
        conversation.push({
          turn: turnNum,
          timestamp: lastIx.timestamp,
          role: 'assistant',
          model: lastIx.modelName || lastIx.modelTitle || null,
          provider: lastIx.modelProvider || null,
          blocks: [{ type: 'text', text }],
          sessionId,
        });
      }
    }
  }

  // Append the final completion as the last assistant response
  const finalCompletion = cleanContinueCompletion(lastIx.completion || '');
  if (finalCompletion && !seenConvTexts.has('a:' + finalCompletion)) {
    conversation.push({
      turn: turnNum,
      timestamp: lastIx.timestamp,
      role: 'assistant',
      model: lastIx.modelName || lastIx.modelTitle || null,
      provider: lastIx.modelProvider || null,
      blocks: [{ type: 'text', text: finalCompletion }],
      sessionId,
    });
  }

  return { prompts, conversation };
}

/**
 * Parse a Continue prompt string into sections.
 *
 * The format uses bare tags on their own line as section markers:
 *   <system>
 *   content...
 *   <user>
 *   content...
 *   <assistant>
 *   content...
 *
 * Returns: [{ tag: 'system', content: '...' }, ...]
 */
function parseContinuePrompt(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentTag = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (SECTION_RE.test(trimmed)) {
      // Save previous section
      if (currentTag) {
        sections.push({ tag: currentTag, content: currentLines.join('\n') });
      }
      currentTag = trimmed.replace(/[<>]/g, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentTag) {
    sections.push({ tag: currentTag, content: currentLines.join('\n') });
  }

  return sections;
}

/**
 * Clean a Continue completion string.
 * Completion wraps tokens as: <assistant>\ntoken\n</assistant>\n<assistant>\nnext\n</assistant>
 */
function cleanContinueCompletion(text) {
  return text
    .replace(/<\/?assistant>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ═══════════════════════════════════════════════════════════
//  Cursor parser
//
//  Cursor agent transcripts use `role` instead of `type`:
//    {"role":"user","message":{"content":[{"type":"text","text":"..."}]}}
//    {"role":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
//
//  User messages embed file context as XML:
//    <attached_files>
//      <code_selection path="..." lines="...">...</code_selection>
//    </attached_files>
//    <user_query>actual prompt</user_query>
//
//  No timestamps — ordering comes from file line order.
// ═══════════════════════════════════════════════════════════

function parseCursor(lines) {
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if ((obj.role === 'user' || obj.role === 'assistant') && obj.message?.content) {
        events.push({ ...obj, _line: i });
      }
    } catch { /* skip */ }
  }

  const prompts = [];
  const conversation = [];
  let turnNum = 0;

  for (const ev of events) {
    const content = ev.message.content;
    if (!Array.isArray(content)) continue;

    if (ev.role === 'user') {
      turnNum++;
      const rawText = coerceContentString(content);

      // Extract <user_query> from Cursor's XML wrapper, fall back to raw text
      const userQuery = extractCursorUserQuery(rawText) || rawText;

      if (userQuery.trim()) {
        prompts.push({ turn: turnNum, timestamp: null, text: userQuery });
        conversation.push({
          turn: turnNum, timestamp: null,
          role: 'user', type: 'prompt', text: userQuery,
        });
      }
    } else if (ev.role === 'assistant') {
      const blocks = content.map(parseContentBlock).filter(Boolean);
      if (blocks.length > 0) {
        conversation.push({
          turn: turnNum, timestamp: null,
          role: 'assistant', model: null, blocks,
        });
      }
    }
  }

  return { format: 'cursor', prompts, conversation, totalEvents: events.length };
}

/**
 * Extract the <user_query> content from a Cursor user message.
 * Strips the <attached_files> boilerplate.
 */
function extractCursorUserQuery(text) {
  const m = text.match(/<user_query>\s*(.*?)<\/user_query>/s);
  if (m) return m[1].trim();

  // If no <user_query> tag, strip <attached_files> blocks and return the rest
  return text
    .replace(/<attached_files>.*?<\/attached_files>/gs, '')
    .replace(/<code_selection[^>]*>.*?<\/code_selection>/gs, '')
    .trim();
}

// ═══════════════════════════════════════════════════════════
//  ChatGPT conversations.json parser
//
//  Structure (single JSON array, not JSONL):
//    [{
//      "title": "...",
//      "create_time": 1710000000,
//      "update_time": 1710000000,
//      "mapping": {
//        "uuid-1": {
//          "id": "uuid-1",
//          "message": { "author": {"role":"user"}, "content":{"parts":["..."]}, "create_time":... },
//          "parent": null,
//          "children": ["uuid-2"]
//        },
//        "uuid-2": {
//          "id": "uuid-2",
//          "message": { "author": {"role":"assistant"}, "content":{"parts":["..."]}, "create_time":... },
//          "parent": "uuid-1",
//          "children": []
//        }
//      },
//      "current_node": "uuid-2"
//    }]
//
//  Messages form a TREE — follow current_node → parent chain to
//  reconstruct the active conversation path.
// ═══════════════════════════════════════════════════════════

function parseChatGPT(conversations) {
  const allPrompts = [];
  const allConversation = [];
  let globalTurn = 0;

  for (const conv of conversations) {
    const mapping = conv.mapping || {};
    const currentNodeId = conv.current_node;

    if (!currentNodeId || !mapping[currentNodeId]) continue;

    // Reconstruct the conversation path: walk from current_node up via parent
    const path = [];
    const visited = new Set();
    let nodeId = currentNodeId;
    while (nodeId) {
      if (visited.has(nodeId)) break; // cycle detected — abort
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!node) break;
      path.unshift(node);
      nodeId = node.parent;
    }

    // Convert path nodes into prompts + conversation items
    const sessPrompts = [];
    const sessConv = [];
    let turnNum = 0;

    for (const node of path) {
      const msg = node.message;
      if (!msg) continue;
      const role = msg.author?.role;
      const parts = msg.content?.parts || [];
      const text = parts
        .filter((p) => typeof p === 'string')
        .join('\n')
        .trim();
      const ts = msg.create_time;

      if (!text) continue;

      if (role === 'user') {
        turnNum++;
        sessPrompts.push({ turn: turnNum, _sessionTurn: turnNum, timestamp: ts, text });
        sessConv.push({ turn: turnNum, timestamp: ts, role: 'user', type: 'prompt', text });
      } else if (role === 'assistant') {
        sessConv.push({
          turn: turnNum, timestamp: ts,
          role: 'assistant',
          model: msg.metadata?.model_slug || null,
          blocks: [{ type: 'text', text }],
        });
      } else if (role === 'tool' || role === 'system') {
        sessConv.push({ turn: turnNum, timestamp: ts, role: 'user', type: 'tool_result', content: text });
      }
    }

    // Add title as meta
    if (conv.title) {
      sessConv.unshift({ turn: null, timestamp: conv.create_time, role: 'meta', type: 'title', title: conv.title });
    }

    // Re-number globally
    for (const p of sessPrompts) {
      globalTurn++;
      p.turn = globalTurn;
      allPrompts.push(p);
    }
    for (const c of sessConv) {
      if (c.turn != null) c.turn = c.turn + (globalTurn - sessPrompts.length);
      allConversation.push(c);
    }
    globalTurn = allPrompts.length;

    // Session separator
    if (allConversation.length > 0) {
      allConversation.push({
        turn: null, timestamp: null,
        role: 'meta', type: 'session_separator',
        sessionId: conv.conversation_id || conv.id || '',
        title: conv.title,
      });
    }
  }

  return {
    format: 'chatgpt',
    prompts: allPrompts,
    conversation: allConversation,
    totalEvents: conversations.length,
    sessions: conversations.length,
  };
}

// ═══════════════════════════════════════════════════════════
//  Aider .aider.chat.history.md parser
//
//  Format (from aider/utils.py:split_chat_history_markdown):
//    # header line (skipped)
//    > context / tool output / git diff
//    #### user message
//    assistant response lines
//    > more context
//    #### next user message
//    more assistant response
//
//  Lines starting with "> "  → tool/context
//  Lines starting with "#### "→ user message
//  Everything else           → assistant response
// ═══════════════════════════════════════════════════════════

function parseAider(text) {
  const lines = text.split('\n');
  const messages = [];

  // State accumulators (match the Python logic exactly)
  let user = [];
  let assistant = [];
  let tool = [];

  function appendMsg(role, linesArr) {
    const content = linesArr.join('').trim();
    if (content) {
      messages.push({ role, content });
    }
  }

  for (const line of lines) {
    if (line.startsWith('# ')) {
      // Header line — skip (but could be "# aider chat history")
      continue;
    }
    if (line.startsWith('> ')) {
      appendMsg('assistant', assistant);
      assistant = [];
      appendMsg('user', user);
      user = [];
      tool.push(line.substring(2));
      continue;
    }
    if (line.startsWith('#### ')) {
      appendMsg('assistant', assistant);
      assistant = [];
      appendMsg('tool', tool);
      tool = [];
      const content = line.substring(5);
      user.push(content);
      continue;
    }

    // Regular line: belongs to assistant
    appendMsg('user', user);
    user = [];
    appendMsg('tool', tool);
    tool = [];
    assistant.push(line);
  }

  // Flush remaining accumulators
  appendMsg('assistant', assistant);
  appendMsg('user', user);
  appendMsg('tool', tool);

  const prompts = [];
  const conversation = [];
  let turnNum = 0;

  for (const msg of messages) {
    if (msg.role === 'user' && msg.content.trim()) {
      const cleaned = msg.content.trim();
      // Skip pure command lines like "/exit", "/clear", "/model"
      if (cleaned.startsWith('/')) continue;
      turnNum++;

      prompts.push({ turn: turnNum, timestamp: null, text: cleaned });
      conversation.push({ turn: turnNum, timestamp: null, role: 'user', type: 'prompt', text: cleaned });
    } else if (msg.role === 'assistant') {
      conversation.push({
        turn: turnNum, timestamp: null,
        role: 'assistant', model: null,
        blocks: [{ type: 'text', text: msg.content }],
      });
    } else if (msg.role === 'tool' && msg.content.trim()) {
      conversation.push({
        turn: turnNum, timestamp: null,
        role: 'user', type: 'tool_result',
        content: msg.content.trim(),
      });
    }
  }

  return { format: 'aider', prompts, conversation, totalEvents: messages.length };
}

// ═══════════════════════════════════════════════════════════
//  Codex CLI rollout JSONL parser
//
//  Format (from codex-trace types + community reverse-engineering):
//    {"type":"session_meta","id":"...","cwd":"...","cli_version":"...","git":{...}}
//    {"type":"event_msg","payload":{"type":"user_message","message":"..."}}
//    {"type":"event_msg","payload":{"type":"agent_message","message":"...","is_reasoning":true}}
//    {"type":"response_item","payload":{"type":"message","role":"assistant","content":[...]}}
//    {"type":"response_item","payload":{"type":"function_call","call_id":"...","name":"...","arguments":{...}}}
//    {"type":"response_item","payload":{"type":"function_call_output","call_id":"...","output":"..."}}
//
//  Event messages (event_msg) are the stream — agent_message with
//  `is_reasoning: true` is thinking. Response items are the final
//  structured record of each turn component.
// ═══════════════════════════════════════════════════════════

function parseCodex(lines) {
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i])); } catch { /* skip */ }
  }

  const prompts = [];
  const conversation = [];
  let turnNum = 0;
  let sessionMeta = null;
  let currentAssistantBlocks = [];
  let currentTurn = 0;

  for (const ev of events) {
    // ── Session metadata ────────────────────────────
    if (ev.type === 'session_meta') {
      sessionMeta = ev;
      if (ev.id || ev.cwd) {
        const metaParts = [];
        if (ev.id) metaParts.push('Session: ' + ev.id.substring(0, 8) + '…');
        if (ev.cwd) metaParts.push('cwd: ' + ev.cwd);
        if (ev.cli_version) metaParts.push('v' + ev.cli_version);
        conversation.push({
          turn: null, timestamp: ev.timestamp || null,
          role: 'meta', type: 'session_separator',
          sessionId: metaParts.join(' · '),
        });
      }
      continue;
    }

    // ── Event messages (streaming) ──────────────────
    if (ev.type === 'event_msg') {
      const payload = ev.payload || ev;
      const msgType = payload.type;

      if (msgType === 'user_message') {
        // Discard any orphan assistant blocks from before the first user message
        // (can happen in truncated/resumed sessions)
        if (currentTurn === 0) {
          currentAssistantBlocks = [];
        } else if (currentAssistantBlocks.length > 0) {
          conversation.push({
            turn: currentTurn, timestamp: ev.timestamp,
            role: 'assistant', model: null, blocks: currentAssistantBlocks,
          });
          currentAssistantBlocks = [];
        }

        turnNum++;
        currentTurn = turnNum;
        const text = typeof payload.message === 'string'
          ? payload.message
          : (payload.message?.content || '');

        if (text.trim()) {
          prompts.push({ turn: turnNum, timestamp: ev.timestamp, text: text.trim() });
          conversation.push({
            turn: turnNum, timestamp: ev.timestamp,
            role: 'user', type: 'prompt', text: text.trim(),
          });
        }
      } else if (msgType === 'agent_message') {
        const text = typeof payload.message === 'string'
          ? payload.message
          : (payload.message?.content || '');
        const isReasoning = payload.is_reasoning || payload.phase === 'commentary';

        if (text.trim()) {
          if (isReasoning) {
            currentAssistantBlocks.push({ type: 'thinking', thinking: text.trim(), signature: '', encrypted: false });
          } else {
            currentAssistantBlocks.push({ type: 'text', text: text.trim() });
          }
        }
      }
      continue;
    }

    // ── Response items (structured record) ──────────
    if (ev.type === 'response_item') {
      const payload = ev.payload || ev;
      const itemType = payload.type;

      if (itemType === 'message' && payload.role === 'assistant') {
        // Response item message may duplicate agent_message content;
        // use it if we haven't collected anything from event_msgs
        const content = payload.content;
        if (!Array.isArray(content)) continue;

        // Only use if we don't already have blocks from event_msgs
        if (currentAssistantBlocks.length === 0) {
          for (const block of content) {
            if (block.type === 'output_text') {
              currentAssistantBlocks.push({ type: 'text', text: block.text || '' });
            } else if (block.type === 'reasoning_text') {
              currentAssistantBlocks.push({ type: 'thinking', thinking: block.text || '', signature: '', encrypted: false });
            }
          }
        }
      } else if (itemType === 'function_call') {
        currentAssistantBlocks.push({
          type: 'tool_use',
          id: payload.call_id || '',
          name: payload.name || 'unknown',
          input: payload.arguments || {},
        });
      } else if (itemType === 'function_call_output') {
        // Flush accumulated blocks before tool result
        if (currentAssistantBlocks.length > 0) {
          conversation.push({
            turn: currentTurn, timestamp: ev.timestamp,
            role: 'assistant', model: null, blocks: [...currentAssistantBlocks],
          });
          currentAssistantBlocks = [];
        }

        const output = typeof payload.output === 'string'
          ? payload.output
          : safeStringify(payload.output || '');

        conversation.push({
          turn: currentTurn, timestamp: ev.timestamp,
          role: 'user', type: 'tool_result',
          toolUseId: payload.call_id || '',
          content: output,
          isError: payload.exit_code !== 0 && payload.exit_code != null,
        });
      }
      continue;
    }

    // ── Token count events ──────────────────────────
    // Skip — they're cumulative stats, not conversation content
    if (ev.type === 'token_count') continue;

    // ── Turn context ────────────────────────────────
    if (ev.type === 'TurnContext' || ev.type === 'turn_context') {
      if (ev.model) {
        // Attach model info to the current turn's assistant
        // by updating the last conversation item if it's an assistant
        for (let i = conversation.length - 1; i >= 0; i--) {
          if (conversation[i].role === 'assistant' && conversation[i].turn === currentTurn) {
            conversation[i].model = ev.model;
            break;
          }
        }
      }
      continue;
    }
  }

  // Flush remaining assistant blocks
  if (currentAssistantBlocks.length > 0) {
    conversation.push({
      turn: currentTurn, timestamp: null,
      role: 'assistant', model: null, blocks: currentAssistantBlocks,
    });
  }

  return { format: 'codex', prompts, conversation, totalEvents: events.length };
}

/**
 * JSON.stringify that never throws — catches circular refs and other errors.
 */
export function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  }
}

// ── display helpers (used by components) ───────────────────

function formatLabel(format) {
  const map = {
    'claude-code': 'Claude Code',
    'continue': 'Continue',
    'cursor': 'Cursor',
    'chatgpt': 'ChatGPT',
    'aider': 'Aider',
    'codex': 'Codex CLI',
  };
  return map[format] || 'Unknown';
}

export function formatTimestamp(ts) {
  if (!ts) return 'unknown time';
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

export function truncateStr(str, maxLen = MAX_TOOL_RESULT_CHARS) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `\n\n... [truncated ${str.length - maxLen} more chars]`;
}

export function indentText(text, indent = '    ') {
  return text.split('\n').map((l) => indent + l).join('\n');
}

// ── download helpers ───────────────────────────────────────

export function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build the "prompts only" output text.
 */
export function buildPromptsOutput(prompts, sourceFileName, format) {
  const label = formatLabel(format);
  let out = `AI Conversation Investigator — Extracted Prompts\n`;
  out += `Source format: ${label}\n`;
  out += `Source: ${sourceFileName}\n`;
  out += `Extracted: ${new Date().toISOString()}\n`;
  out += '='.repeat(60) + '\n\n';

  for (const p of prompts) {
    const ts = formatTimestamp(p.timestamp);
    out += `── Turn ${p.turn} ── ${ts}`;
    if (p.sessionId) out += ` [session: ${p.sessionId}]`;
    out += ` ──\n\n`;
    out += p.text + '\n\n';
    out += '-'.repeat(40) + '\n\n';
  }
  return out;
}

/**
 * Build the "full conversation with thinking" output text.
 */
export function buildConversationOutput(conversation, sourceFileName, format) {
  const label = formatLabel(format);
  let out = `AI Conversation Investigator — Full Transcript\n`;
  out += `Source format: ${label}\n`;
  out += `Source: ${sourceFileName}\n`;
  out += `Extracted: ${new Date().toISOString()}\n`;
  out += '='.repeat(60) + '\n\n';

  for (const item of conversation) {
    const ts = formatTimestamp(item.timestamp);

    if (item.role === 'meta') {
      if (item.type === 'title') {
        out += `📌 Chat Title: ${item.title}\n\n`;
      } else if (item.type === 'session_separator') {
        out += '\n' + '='.repeat(60) + '\n';
        out += `Session: ${item.sessionId}\n`;
        out += '='.repeat(60) + '\n\n';
      }
      continue;
    }

    if (item.turn != null) {
      out += `── Turn ${item.turn} ── ${ts} ── `;
    } else {
      out += `── ${ts} ── `;
    }

    if (item.type === 'prompt') {
      out += `👤 User ──\n\n`;
      out += item.text + '\n\n';
    } else if (item.type === 'interrupt') {
      out += `⚠️ User Interrupt ──\n\n`;
      out += item.text + '\n\n';
    } else if (item.type === 'tool_result') {
      out += `🔧 Tool Result ──\n`;
      if (item.isError) out += `⚠️ ERROR / REJECTED\n`;
      out += `tool_use_id: ${item.toolUseId || 'N/A'}\n`;
      out += truncateStr(String(item.content)) + '\n\n';
    } else if (item.role === 'assistant') {
      out += `🤖 Assistant`;
      if (item.model) out += ` (${item.model})`;
      out += ` ──\n\n`;

      const blocks = item.blocks || [];
      for (const block of blocks) {
        if (block.type === 'thinking') {
          if (block.encrypted) {
            out += `  🔒 [Encrypted thinking — signature present, content hidden]\n\n`;
          } else {
            out += `  💭 Thinking:\n`;
            out += indentText(block.thinking) + '\n\n';
          }
        } else if (block.type === 'text') {
          out += block.text + '\n\n';
        } else if (block.type === 'tool_use') {
          out += `  🔨 Tool: ${block.name}\n`;
          if (block.input && Object.keys(block.input).length > 0) {
            out += indentText(safeStringify(block.input)) + '\n';
          }
          out += '\n';
        }
      }
    }

    out += '-'.repeat(40) + '\n\n';
  }

  return out;
}
