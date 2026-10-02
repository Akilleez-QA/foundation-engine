/**
 * core/i18n message format (ADR 0021). A message is text with `{name}` holes and an ICU MessageFormat subset:
 *
 *   "🎟 +{n, plural, one {# ticket} other {# tickets}} for exploring! You have {total}."
 *   "{who, select, she {She left} he {He left} other {They left}}"
 *   "You finished {rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}."
 *
 * Plural and selectordinal forms are `=N` (exact), then the locale's `Intl.PluralRules` category (cardinal or
 * ordinal), then `other`; categories are the CLDR names (zero, one, two, few, many, other). `#` inside a form is the
 * number, formatted for the locale. Select cases are identifiers (letters, digits, `_`, `-`) matched against the
 * value's string form, then `other`. Every complex argument needs `other`. Forms may contain holes and nested
 * arguments. There is no escaping: a literal brace is a content error and `parseMessage` rejects it.
 *
 * Bounds: a message is at most MESSAGE_LIMITS.maxLength UTF-16 units, nests complex arguments at most
 * MESSAGE_LIMITS.maxDepth deep and has at most MESSAGE_LIMITS.maxParts parts, so parsing (and the recursion of
 * rendering) is bounded by the catalogue text rather than by the call stack.
 *
 * Pure: no DOM, no clock, no globals beyond `Intl`.
 */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string }
  | { kind: 'plural'; name: string; forms: Readonly<Record<string, readonly Part[]>>; ordinal?: true }
  | { kind: 'select'; name: string; forms: Readonly<Record<string, readonly Part[]>> };

export type Vars = Readonly<Record<string, string | number>>;

export const MESSAGE_LIMITS = Object.freeze({ maxLength: 16384, maxDepth: 8, maxParts: 1024 });
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Parse a message. Throws with the offending position on unbalanced or malformed braces, or over the limits. */
export function parseMessage(message: string): Part[] {
  if (typeof message !== 'string') throw new TypeError('A message must be a string');
  if (message.length > MESSAGE_LIMITS.maxLength) throw new Error(`Message longer than ${MESSAGE_LIMITS.maxLength} characters`);
  let i = 0, count = 0;
  const fail = (why: string): never => { throw new Error(`${why} at ${i} in message ${JSON.stringify(message.length > 200 ? message.slice(0, 200) + '…' : message)}`); };
  const push = (out: Part[], p: Part) => { if (++count > MESSAGE_LIMITS.maxParts) fail(`More than ${MESSAGE_LIMITS.maxParts} parts`); out.push(p); };
  function parts(depth: number, untilClose: boolean): Part[] {
    const out: Part[] = [];
    let text = '';
    const flush = () => { if (text) push(out, { kind: 'text', text }); text = ''; };
    while (i < message.length) {
      const c = message[i];
      if (c === '}') { if (!untilClose) fail('Unexpected "}"'); flush(); return out; }
      if (c !== '{') { text += c; i++; continue; }
      flush(); i++;
      const head = /^\s*([A-Za-z_]\w*)\s*(?:,\s*(plural|selectordinal|select)\s*,)?/.exec(message.slice(i, i + 256));
      if (!head) fail('Expected a variable name after "{"');
      i += head![0].length;
      const name = head![1], type = head![2];
      if (!type) {
        if (message[i] !== '}') fail(`Expected "}" after {${name}`);
        i++; push(out, { kind: 'var', name }); continue;
      }
      if (depth >= MESSAGE_LIMITS.maxDepth) fail(`Arguments nested deeper than ${MESSAGE_LIMITS.maxDepth}`);
      const select = type === 'select';
      // Null prototype: a case named `__proto__` (or `constructor`) is an ordinary case, never the prototype.
      const forms: Record<string, Part[]> = Object.create(null);
      for (;;) {
        const sel = (select ? /^\s*([A-Za-z0-9_][\w-]*)\s*\{/ : /^\s*(=\d+|[a-z]+)\s*\{/).exec(message.slice(i, i + 256));
        if (!sel) break;
        i += sel[0].length;
        const key = sel[1];
        if (!select && !key.startsWith('=') && !PLURAL_CATEGORIES.has(key)) fail(`Unknown plural category "${key}"`);
        if (Object.hasOwn(forms, key)) fail(`Duplicate ${select ? 'select case' : 'plural form'} "${key}"`);
        forms[key] = parts(depth + 1, true);
        i++; // the form's closing brace
      }
      const close = /^\s*\}/.exec(message.slice(i, i + 256));
      if (!close) fail(`Expected "}" to close the ${type} {${name}}`);
      i += close![0].length;
      if (!Object.hasOwn(forms, 'other')) fail(`${type[0].toUpperCase() + type.slice(1)} {${name}} needs an "other" form`);
      push(out, select ? { kind: 'select', name, forms } : type === 'selectordinal' ? { kind: 'plural', name, forms, ordinal: true } : { kind: 'plural', name, forms });
    }
    if (untilClose) fail('Unclosed "{"');
    flush();
    return out;
  }
  return parts(0, false);
}

/** The variables a message uses. Plural and ordinal variables are numbers; the others take a string or a number. */
export function messageVars(parts: readonly Part[], into = new Map<string, 'number' | 'text'>()): Map<string, 'number' | 'text'> {
  for (const p of parts) {
    if (p.kind === 'text') continue;
    if (p.kind === 'var') { if (!into.has(p.name)) into.set(p.name, 'text'); }
    else {
      if (p.kind === 'plural') into.set(p.name, 'number');
      else if (!into.has(p.name)) into.set(p.name, 'text');
      for (const f of Object.values(p.forms)) messageVars(f, into);
    }
  }
  return into;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();
/**
 * The tag Intl actually supports for this service, else `en`. Without this, a well-formed but unsupported tag
 * (`xx`, `tlh`) would silently use the host's default locale, so the same catalogue would render differently on
 * different machines. A malformed tag also resolves to `en` instead of throwing while rendering.
 */
function supported(tag: string, service: { supportedLocalesOf(l: string): string[] }): string {
  try { return service.supportedLocalesOf(tag)[0] ?? 'en'; } catch { return 'en'; }
}
const rulesFor = (l: string, ordinal: boolean) => {
  const key = l + '\u0000' + (ordinal ? 'o' : 'c');
  let v = pluralRules.get(key);
  if (!v) { v = new Intl.PluralRules(supported(l, Intl.PluralRules), { type: ordinal ? 'ordinal' : 'cardinal' }); pluralRules.set(key, v); }
  return v;
};
const numbersFor = (l: string) => {
  let v = numberFormats.get(l);
  if (!v) { v = new Intl.NumberFormat(supported(l, Intl.NumberFormat)); numberFormats.set(l, v); }
  return v;
};

/** Render parsed parts. A hole with no value stays visible as `{name}`, so the gap is seen rather than hidden. */
export function renderMessage(parts: readonly Part[], vars: Vars | undefined, locale: string, count?: number): string {
  let out = '';
  for (const p of parts) {
    if (p.kind === 'text') out += count === undefined ? p.text : p.text.replace(/#/g, numbersFor(locale).format(count));
    else if (p.kind === 'var') out += vars && Object.hasOwn(vars, p.name) ? String(vars[p.name]) : `{${p.name}}`;
    else if (p.kind === 'select') {
      const value = vars && Object.hasOwn(vars, p.name) ? String(vars[p.name]) : 'other';
      const form = (value !== '' && Object.hasOwn(p.forms, value) ? p.forms[value] : undefined) ?? p.forms.other;
      out += renderMessage(form, vars, locale, count);
    } else {
      const n = Number(vars?.[p.name] ?? 0);
      const exact = '=' + n;
      const category = rulesFor(locale, p.ordinal === true).select(n);
      const form = (Object.hasOwn(p.forms, exact) ? p.forms[exact] : undefined) ?? (Object.hasOwn(p.forms, category) ? p.forms[category] : undefined) ?? p.forms.other;
      out += renderMessage(form, vars, locale, n);
    }
  }
  return out;
}
