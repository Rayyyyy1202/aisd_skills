import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface LLMTurnResponse {
  /** Full assistant message to push back into history */
  message: ChatCompletionMessageParam;
  /** content text emitted by the assistant (may be empty if tool-calling) */
  text: string;
  /** Tool calls the assistant requested */
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  /** finish reason from the API */
  finish: string | null;
  /** usage block from the API */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'AbortError') return true;
  const msg = (err?.message ?? '').toLowerCase();
  return msg.includes('aborted') || msg.includes('request was aborted');
}

function isRetryableLlmError(e: unknown): boolean {
  // Aborts must NEVER be retried — propagate immediately.
  if (isAbortError(e)) return false;
  const err = e as { name?: string; message?: string; status?: number; code?: string };
  const status = typeof err?.status === 'number' ? err.status : 0;
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600)) return true;
  const code = err?.code ?? '';
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED') return true;
  const msg = (err?.message ?? '').toLowerCase();
  if (
    msg.includes('connection error') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('temporarily unavailable')
  ) {
    return true;
  }
  return false;
}

export class LLMClient {
  private openai: OpenAI;

  constructor(private config: LLMConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  /** Default model from server config — exposed so callers can echo it back to clients. */
  get defaultModel(): string {
    return this.config.model;
  }

  private async callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    const delaysMs = [200, 1000, 5000];
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!isRetryableLlmError(e) || i === attempts - 1) throw e;
        const wait = delaysMs[i] ?? 5000;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    modelOverride?: string,
    signal?: AbortSignal,
  ): Promise<LLMTurnResponse> {
    if (signal?.aborted) throw new AbortError();
    const res = await this.callWithRetry(() =>
      this.openai.chat.completions.create(
        {
          model: modelOverride && modelOverride.trim() ? modelOverride.trim() : this.config.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
        },
        signal ? { signal } : undefined,
      ),
    );
    const choice = res.choices[0];
    if (!choice) throw new Error('OpenAI returned no choice');
    const msg = choice.message;
    const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
    return {
      message: msg as ChatCompletionMessageParam,
      text: msg.content ?? '',
      toolCalls,
      finish: choice.finish_reason ?? null,
      usage: res.usage
        ? {
            prompt_tokens: res.usage.prompt_tokens,
            completion_tokens: res.usage.completion_tokens,
            total_tokens: res.usage.total_tokens,
          }
        : undefined,
    };
  }
}

export function toolMessage(
  toolCallId: string,
  payload: unknown,
): ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}
