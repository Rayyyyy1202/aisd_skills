// Global stubs (fetch, window, document, CustomEvent) installed before any
// module under test is imported. Test files MUST import this first.

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface MockOptions {
  body: unknown;
  status?: number;
}

interface MockHandle {
  calls: FetchCall[];
  setHandler: (handler: ((url: string, init?: RequestInit) => MockOptions) | null) => void;
  events: Array<{ type: string; detail: unknown }>;
  resetAll: () => void;
}

const calls: FetchCall[] = [];
const events: Array<{ type: string; detail: unknown }> = [];
let handler: ((url: string, init?: RequestInit) => MockOptions) | null = null;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  calls.push({ url, init });
  const h = handler;
  if (!h) throw new Error(`unmocked fetch: ${url}`);
  const { body, status = 200 } = h(url, init);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  } as Response;
}) as typeof fetch;

const eventBus = new Map<string, Array<(e: Event) => void>>();

const win = {
  location: { pathname: '/chat' },
  addEventListener(type: string, fn: (e: Event) => void) {
    const arr = eventBus.get(type) ?? [];
    arr.push(fn);
    eventBus.set(type, arr);
  },
  removeEventListener(type: string, fn: (e: Event) => void) {
    const arr = eventBus.get(type);
    if (!arr) return;
    eventBus.set(
      type,
      arr.filter((f) => f !== fn),
    );
  },
  dispatchEvent(e: Event & { type: string; detail?: unknown }) {
    events.push({ type: e.type, detail: e.detail });
    const arr = eventBus.get(e.type) ?? [];
    arr.forEach((fn) => fn(e));
    return true;
  },
};
(globalThis as Record<string, unknown>).window = win;
globalThis.dispatchEvent = win.dispatchEvent as typeof globalThis.dispatchEvent;

class FakeCustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
}
(globalThis as Record<string, unknown>).CustomEvent = FakeCustomEvent;

const magicEls: Array<{ text: string; classes: Set<string> }> = [
  { text: '批准 → 下一步', classes: new Set() },
  { text: '新建品牌', classes: new Set() },
  { text: '上传文件给 agent', classes: new Set() },
];
const doc = {
  title: 'aisd Agent test',
  querySelectorAll(selector: string) {
    if (selector === '[data-magic]') {
      return magicEls.map((e) => ({
        getAttribute: (k: string) => (k === 'data-magic' ? e.text : null),
        textContent: e.text,
        classList: {
          add: (c: string) => e.classes.add(c),
          remove: (c: string) => e.classes.delete(c),
        },
        scrollIntoView: () => undefined,
      }));
    }
    return [];
  },
};
(globalThis as Record<string, unknown>).document = doc;

export const mock: MockHandle = {
  calls,
  events,
  setHandler: (h) => {
    handler = h;
  },
  resetAll: () => {
    calls.length = 0;
    events.length = 0;
    handler = null;
  },
};
