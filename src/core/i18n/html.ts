/**
 * core/i18n strings in HTML templates. A template that interpolates `t()` escapes it
 * (`escapeHtml`), so a string is always text, never markup. `markupString` is for the few sentences with markup inside
 * (a link, a `<strong>`): the message's own words are escaped and each hole takes the caller's HTML, which the caller
 * builds from other keys. Pure.
 */
import {runtimeT, type I18n} from './i18n';

const escapes: Readonly<Record<string, string>> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
/** Text made safe for a text node or a double-quoted attribute. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, c => escapes[c]!); // the class matches only escapes' keys

/** The key's text with each `{hole}` replaced by the caller's markup; everything else escaped. */
export function markupString<P, K extends keyof P & string>(
  i18n: I18n<P>,
  key: K,
  holes: Readonly<Record<keyof P[K] & string, string>>,
): string {
  const vars = Object.fromEntries(Object.keys(holes).map(name => [name, '\u0001' + name + '\u0001']));
  const text = runtimeT(i18n, key, vars);
  return escapeHtml(text).replace(/\u0001(\w+)\u0001/g, (_, name: string) => (holes as Record<string, string>)[name]!); // the marked names are holes' keys
}
