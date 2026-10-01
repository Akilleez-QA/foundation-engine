/**
 * core/i18n message format (ADR 0021). A message is text with `{name}` holes and ICU-lite plurals:
 *
 *   "🎟 +{n, plural, one {# ticket} other {# tickets}} for exploring! You have {total}."
 *
 * Plural forms are `=N` (exact), then the locale's `Intl.PluralRules` category, then `other`. `#` inside a form is the
 * number, formatted for the locale. Forms may themselves contain `{name}` holes and nested plurals. There is no
 * escaping: a message with a literal brace is a content error and `parseMessage` rejects it.
 *
 * Pure: no DOM, no clock, no globals beyond `Intl`.
 */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string }
  | { kind: 'plural'; name: string; forms: Readonly<Record<string, readonly Part[]>> };

export type Vars = Readonly<Record<string, string | number>>;

/** Parse a message. Throws with the offending position on unbalanced or malformed braces. */
export function parseMessage(message: string): Part[] {
  let i = 0;
  const fail = (why: string): never => { throw new Error(`${why} at ${i} in message ${JSON.stringify(message)}`); };
  function parts(untilClose: boolean): Part[] {
    const out: Part[] = [];
    let text = '';
    const flush = () => { if (text) out.push({ kind: 'text', text }); text = ''; };
    while (i < message.length) {
      const c = message[i];
      if (c === '}') { if (!untilClose) fail('Unexpected "}"'); flush(); return out; }
      if (c !== '{') { text += c; i++; continue; }
      flush(); i++;
      const head = /^\s*([A-Za-z_]\w*)\s*(?:,\s*(plural)\s*,)?/.exec(message.slice(i));
      if (!head) fail('Expected a variable name after "{"');
      i += head![0].length;
      const name = head![1];
      if (!head![2]) {
        if (message[i] !== '}') fail(`Expected "}" after {${name}`);
        i++; out.push({ kind: 'var', name }); continue;
      }
      const forms: Record<string, Part[]> = {};
      for (;;) {
        const sel = /^\s*(=\d+|[a-z]+)\s*\{/.exec(message.slice(i));
        if (!sel) break;
        i += sel[0].length;
        if (Object.hasOwn(forms, sel[1])) fail(`Duplicate plural form "${sel[1]}"`);
        forms[sel[1]] = parts(true);
        i++; // the form's closing brace
      }
      const close = /^\s*\}/.exec(message.slice(i));
      if (!close) fail(`Expected "}" to close the plural {${name}}`);
      i += close![0].length;
      if (!Object.hasOwn(forms, 'other')) fail(`Plural {${name}} needs an "other" form`);
      out.push({ kind: 'plural', name, forms });
    }
    if (untilClose) fail('Unclosed "{"');
    flush();
    return out;
  }
  return parts(false);
}

/** The variables a message uses. Plural variables are numbers; the others take a string or a number. */
export function messageVars(parts: readonly Part[], into = new Map<string, 'number' | 'text'>()): Map<string, 'number' | 'text'> {
  for (const p of parts) {
    if (p.kind === 'var') { if (!into.has(p.name)) into.set(p.name, 'text'); }
    else if (p.kind === 'plural') { into.set(p.name, 'number'); for (const f of Object.values(p.forms)) messageVars(f, into); }
  }
  return into;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const rulesFor = (l: string) => pluralRules.get(l) ?? (pluralRules.set(l, new Intl.PluralRules(l)), pluralRules.get(l)!);
const numbersFor = (l: string) => numberFormats.get(l) ?? (numberFormats.set(l, new Intl.NumberFormat(l)), numberFormats.get(l)!);

/** Render parsed parts. A hole with no value stays visible as `{name}`, so the gap is seen rather than hidden. */
export function renderMessage(parts: readonly Part[], vars: Vars | undefined, locale: string, count?: number): string {
  let out = '';
  for (const p of parts) {
    if (p.kind === 'text') out += count === undefined ? p.text : p.text.replace(/#/g, numbersFor(locale).format(count));
    else if (p.kind === 'var') out += vars && Object.hasOwn(vars, p.name) ? String(vars[p.name]) : `{${p.name}}`;
    else {
      const n = Number(vars?.[p.name] ?? 0);
      const form = p.forms['=' + n] ?? p.forms[rulesFor(locale).select(n)] ?? p.forms.other;
      out += renderMessage(form, vars, locale, n);
    }
  }
  return out;
}
