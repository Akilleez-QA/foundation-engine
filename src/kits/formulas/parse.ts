import {FORMULA_OPERATORS, FormulaError, isFormulaName, type Expr} from './expression';

/**
 * Text form of an expression, for authors who prefer `attack * (level + 3) / max(defense, 1)` to JSON arrays. The
 * result is the same JSON expression data; store either. Grammar, loosest first:
 *
 *   or      a || b                     and   a && b
 *   compare a < b, <=, >, >=, ==, !=   (one comparison per level, no chaining)
 *   sum     a + b, a - b               product  a * b, a / b, a // b (truncating), a % b
 *   unary   -a, !a                     power    a ^ b (right associative)
 *   primary number, name, name(args…) for any operator (min, max, clamp, sqrt, if, roll, chance, rand, …), (expr)
 */
export function parseFormula(text: string, maxLength = 4096): Expr {
  if (typeof text !== 'string') throw new FormulaError('formula text must be a string');
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 65536)
    throw new FormulaError('maxLength must be an integer in 1..65536');
  if (text.length > maxLength) throw new FormulaError('formula text is too long');
  const tokens = tokenize(text);
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++]!;
  const accept = (value: string) => {
    if (peek()?.value === value && peek()?.kind !== 'number') {
      index++;
      return true;
    }
    return false;
  };
  const expect = (value: string) => {
    if (!accept(value)) throw new FormulaError(`expected "${value}" at ${peek()?.at ?? text.length}`);
  };
  const nest = <T>(f: () => T): T => {
    if (++depth > 64) throw new FormulaError('formula nesting is too deep');
    try {
      return f();
    } finally {
      depth--;
    }
  };
  const binary = (next: () => Expr, table: Record<string, string>): Expr => {
    let left = next();
    for (;;) {
      const t = peek();
      if (!t || t.kind !== 'symbol' || !Object.hasOwn(table, t.value)) return left;
      index++;
      left = [table[t.value]!, left, next()];
    }
  };
  const or = (): Expr => binary(and, {'||': 'or'});
  const and = (): Expr => binary(compare, {'&&': 'and'});
  const compare = (): Expr => {
    const left = sum();
    const t = peek();
    const ops: Record<string, string> = {'<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '==': 'eq', '!=': 'ne'};
    if (t && t.kind === 'symbol' && Object.hasOwn(ops, t.value)) {
      index++;
      const right = sum();
      const after = peek();
      if (after && after.kind === 'symbol' && Object.hasOwn(ops, after.value))
        throw new FormulaError(`chained comparison at ${after.at}; use && to combine comparisons`);
      return [ops[t.value]!, left, right];
    }
    return left;
  };
  const sum = (): Expr => binary(product, {'+': 'add', '-': 'sub'});
  const product = (): Expr => binary(unary, {'*': 'mul', '/': 'div', '//': 'idiv', '%': 'mod'});
  const unary = (): Expr =>
    nest(() => {
      if (accept('-')) return ['neg', unary()];
      if (accept('!')) return ['not', unary()];
      if (accept('+')) return unary();
      return power();
    });
  const power = (): Expr => {
    const base = primary();
    if (accept('^')) return ['pow', base, nest(unary)];
    return base;
  };
  const primary = (): Expr =>
    nest(() => {
      const t = peek();
      if (!t) throw new FormulaError('unexpected end of formula');
      if (t.kind === 'number') {
        index++;
        return Number(t.value);
      }
      if (t.kind === 'name') {
        index++;
        if (accept('(')) {
          if (!FORMULA_OPERATORS.includes(t.value)) throw new FormulaError(`unknown function ${t.value} at ${t.at}`);
          const args: Expr[] = [];
          if (!accept(')')) {
            do args.push(or());
            while (accept(','));
            expect(')');
          }
          return [t.value, ...args];
        }
        if (!isFormulaName(t.value))
          throw new FormulaError(`"${t.value}" is a function name, not a variable (at ${t.at})`);
        return t.value;
      }
      if (accept('(')) {
        const inner = or();
        expect(')');
        return inner;
      }
      throw new FormulaError(`unexpected "${t.value}" at ${t.at}`);
    });
  const result = or();
  if (index !== tokens.length) throw new FormulaError(`unexpected "${take().value}" at ${tokens[index - 1]!.at}`);
  return result;
}

interface Token {
  kind: 'number' | 'name' | 'symbol';
  value: string;
  at: number;
}
const SYMBOLS = ['//', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '!', '(', ')', ','];
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new FormulaError(`number out of range at ${i}`);
      tokens.push({kind: 'number', value: number[0], at: i});
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i, i + 65));
    if (name) {
      if (name[0].length > 64) throw new FormulaError(`name too long at ${i}`);
      tokens.push({kind: 'name', value: name[0], at: i});
      i += name[0].length;
      continue;
    }
    const symbol = SYMBOLS.find(s => text.startsWith(s, i));
    if (!symbol) throw new FormulaError(`unexpected character ${JSON.stringify(c)} at ${i}`);
    tokens.push({kind: 'symbol', value: symbol, at: i});
    i += symbol.length;
  }
  return tokens;
}
