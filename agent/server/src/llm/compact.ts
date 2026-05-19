import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';

export const STUB_CONTENT = '[Old tool result content cleared]';

// Tools used by the orchestrator chat loop (api/chat.ts). The ones listed here
// emit large recoverable payloads — once the model has acted on them, replaying
// the full body wastes context. Mutation/state-tracking tools (add_task,
// save_memory, finish, preflight_skill, etc.) stay verbatim.
export const ORCHESTRATOR_COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_output',
  'run_skill',
  'get_workspace_state',
  'list_skills',
  'distill_project_profile',
]);

// Tools used inside a single skill execution (executor/node.ts).
export const EXECUTOR_COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_dir',
  'run_shell',
  'validate_schema',
]);

const DEFAULT_KEEP_LAST_ROUNDS = 3;

/**
 * Replace tool_result content of "compactable" tools that occur before the
 * last `keepLastRounds` assistant rounds. Pure on the in-memory message array;
 * persisted DB rows are untouched.
 *
 * A "round" = one assistant message (with or without tool_calls). We walk
 * backwards from the end, count assistant messages, and any tool message that
 * lives before the cutoff round AND was emitted by a compactable tool gets
 * its content replaced with STUB_CONTENT.
 *
 * Tool↔assistant linkage is by `tool_call_id`: we first index every assistant
 * tool_call's name by id, then check each tool message against that index.
 */
export function microcompactMessages(
  messages: ChatCompletionMessageParam[],
  compactableTools: ReadonlySet<string>,
  keepLastRounds: number = DEFAULT_KEEP_LAST_ROUNDS,
): ChatCompletionMessageParam[] {
  if (messages.length === 0) return messages;

  // Build tool_call_id → tool name map from all assistant messages.
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const calls = (m as { tool_calls?: Array<{ id: string; function: { name: string } }> }).tool_calls;
    if (!calls) continue;
    for (const tc of calls) {
      toolNameById.set(tc.id, tc.function.name);
    }
  }

  // Find the cutoff index: the position of the (keepLastRounds+1)-th
  // assistant message counted from the end. Anything strictly before that
  // index is eligible for stubbing.
  let assistantSeen = 0;
  let cutoffIdx = -1; // messages at index < cutoffIdx are old
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      assistantSeen += 1;
      if (assistantSeen > keepLastRounds) {
        cutoffIdx = i;
        break;
      }
    }
  }
  if (cutoffIdx === -1) return messages; // not enough rounds yet

  let mutated = false;
  const out: ChatCompletionMessageParam[] = messages.map((m, i) => {
    if (i >= cutoffIdx) return m;
    if (m.role !== 'tool') return m;
    const tm = m as ChatCompletionToolMessageParam;
    const toolName = toolNameById.get(tm.tool_call_id);
    if (!toolName || !compactableTools.has(toolName)) return m;
    if (typeof tm.content === 'string' && tm.content === STUB_CONTENT) return m;
    mutated = true;
    return { ...tm, content: STUB_CONTENT };
  });

  return mutated ? out : messages;
}
