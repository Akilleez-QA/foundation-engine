import {viewOwnsInput} from './owner';

/** Input context stack: gameplay < viewer < ui < modal. The highest rank (latest among equals)
 * is the top; it alone receives discrete actions. Every push or pop notifies listeners, which
 * cancel held input and require neutral so nothing leaks across the change. */
export type ContextKind = 'gameplay' | 'viewer' | 'ui' | 'modal';
export const CONTEXT_RANK: Record<ContextKind, number> = {gameplay: 0, viewer: 1, ui: 2, modal: 3};
export type InputContext = {
  readonly id: number;
  readonly kind: ContextKind;
  readonly label: string;
  readonly element?: Element;
  pop(): void;
  readonly active: boolean;
};
export type ContextChange = {top: InputContext | null; previous: InputContext | null; reason: 'push' | 'pop'};

export class InputContextStack {
  private entries: InputContext[] = [];
  private listeners = new Set<(change: ContextChange) => void>();
  private nextId = 1;
  push(kind: ContextKind, options: {label?: string; element?: Element; onPop?: () => void} = {}): InputContext {
    const previous = this.top(),
      stack = this;
    let active = true;
    const context: InputContext = {
      id: this.nextId++,
      kind,
      label: options.label ?? kind,
      element: options.element,
      get active() {
        return active;
      },
      pop() {
        if (!active) return;
        active = false;
        const before = stack.top();
        stack.entries = stack.entries.filter(e => e !== context);
        stack.emit({top: stack.top(), previous: before, reason: 'pop'});
        options.onPop?.();
      },
    };
    this.entries.push(context);
    this.emit({top: this.top(), previous, reason: 'push'});
    return context;
  }
  top(): InputContext | null {
    let best: InputContext | null = null;
    for (const e of this.entries) if (!best || CONTEXT_RANK[e.kind] >= CONTEXT_RANK[best.kind]) best = e;
    return best;
  }
  topKind(): ContextKind {
    return this.top()?.kind ?? 'gameplay';
  }
  /** True while `context` is the top: the stack's replacement for viewOwnsInput(host). */
  owns(context: InputContext) {
    return context.active && this.top() === context;
  }
  onChange(listener: (change: ContextChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  get size() {
    return this.entries.length;
  }
  private emit(change: ContextChange) {
    for (const listener of [...this.listeners]) listener(change);
  }
}

/** Mirrors the DOM ownership signals the movers use today into one 'modal' context: native
 * modal dialogs and visible [role=dialog]/[aria-modal] overlays (via viewOwnsInput, which keeps
 * working unchanged) and a covering class such as .view-covered on the host or an ancestor.
 * Returns a disconnect function; it also stops when `signal` aborts. */
export function observeDomModals(
  stack: InputContextStack,
  host: HTMLElement,
  options: {
    signal?: AbortSignal;
    covered?: string;
    owns?: (host: HTMLElement) => boolean;
    Observer?: typeof MutationObserver;
  } = {},
) {
  const covered = options.covered ?? '.view-covered',
    owns = options.owns ?? viewOwnsInput,
    Observer = options.Observer ?? globalThis.MutationObserver;
  let context: InputContext | null = null;
  const sync = () => {
    const blocked = !owns(host) || !!host.closest(covered);
    if (blocked && !context) context = stack.push('modal', {label: 'dom-modal'});
    else if (!blocked && context) {
      context.pop();
      context = null;
    }
  };
  const observer = Observer ? new Observer(sync) : null;
  observer?.observe(host.ownerDocument.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'class', 'hidden', 'role', 'aria-modal', 'style'],
  });
  sync();
  const stop = () => {
    observer?.disconnect();
    context?.pop();
    context = null;
  };
  options.signal?.addEventListener('abort', stop, {once: true});
  return Object.assign(stop, {sync});
}
