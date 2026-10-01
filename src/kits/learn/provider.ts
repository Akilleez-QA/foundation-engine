/**
 * kits/learn/provider: who answers a learner in a discuss scene. The engine ships only the scripted provider:
 * authored responses per prompt. A game may supply another `DiscussProvider` (for example one backed by a service
 * it trusts); every response passes the same checks before it is shown, and a kid-safe game rejects anything that
 * fails them in favour of an authored fallback. There is no runtime language model by default.
 */
import type { Action } from './lesson';

export interface DiscussContext { lesson: string; scene: string; text: (key: string) => string }
export interface DiscussProvider { readonly id: string; respond(prompt: string, ctx: DiscussContext): Action[] | Promise<Action[]> }

/** Authored responses, one list of actions per prompt id. */
export function scriptedProvider(responses: Readonly<Record<string, Action[]>>): DiscussProvider {
  return { id: 'scripted', respond: prompt => responses[prompt] ?? [] };
}

const UNSAFE = [/https?:\/\//i, /\bwww\./i, /@\w/, /\b(address|phone|password|surname|school name|where do you live)\b/i, /\b(kill|blood|die|dead|gun|weapon|hate)\b/i];
/** Problems with a response for a young audience: links, requests for personal data, violence, length, only speech. */
export function kidSafeProblems(actions: readonly Action[], text: (key: string) => string): string[] {
  const out: string[] = [];
  if (actions.length > 6) out.push('a response is at most 6 actions');
  for (const a of actions) {
    if (a.do === 'branch' || a.do === 'wait-for') { out.push('a response only speaks and shows; it does not branch or wait'); continue; }
    if (a.do !== 'say') continue;
    const s = text(a.text);
    if (s.length > 220) out.push(`too long for a young reader (${s.length} characters)`);
    for (const re of UNSAFE) if (re.test(s)) out.push(`not kid-safe: "${s.slice(0, 60)}"`);
  }
  return out;
}
