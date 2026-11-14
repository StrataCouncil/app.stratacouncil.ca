/**
 * Stratasphere's calculator (the `calculate` tool, lib/ai/stratasphere.ts).
 * Claude decides what to work out, and writes it as expressions; this
 * code does the arithmetic and the date counting exactly, so no figure in
 * an answer is mental arithmetic.
 *
 * Expressions: numbers (84000, 1250.50; no commas or $), + - * / ^, and
 * brackets; dates written 'YYYY-MM-DD'; earlier results by name; and:
 *
 *   days(start, end)                       days from start to end, both included
 *   overlap_days(a_start, a_end, b_start, b_end)
 *                                          days in both periods (ends included), 0 if none
 *   months(start, end)                     calendar months from start to end, both
 *                                          included; a part month counts as its share
 *                                          of that month's days (Sep 1 2026 to
 *                                          Feb 28 2028 is 18)
 *   overlap_months(a_start, a_end, b_start, b_end)
 *                                          months(...) of the part in both periods
 *   add_days(date, n), add_months(date, n) a date n days or months later (or earlier)
 *   round(x), round(x, places)             half away from zero (money: round(x, 2))
 *   min(...), max(...), sum(...), abs(x)
 *
 * Pure: no I/O, so it's unit-tested directly (tests/calculator.test.ts).
 */

export interface Calculation {
  /** Lower-case identifier, so later expressions can use the result. */
  name: string;
  /** What it is, and where each figure comes from. */
  label: string;
  expression: string;
}

export interface CalculationResult {
  name: string;
  label: string;
  expression: string;
  result?: string;
  error?: string;
}

type Value = { kind: "number"; n: number } | { kind: "date"; d: number /* days since 1970-01-01, UTC */ };

const DAY_MS = 86_400_000;

class CalcError extends Error {}

/* ---------- dates ---------- */

function parseDate(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new CalcError(`'${text}' isn't a date: write dates as 'YYYY-MM-DD'.`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new CalcError(`'${text}' isn't a real date.`);
  }
  return Math.round(ms / DAY_MS);
}

function formatDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function ymd(day: number) {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Calendar months from start to end, both days included; part months by their share of days. */
function monthsBetween(start: number, end: number): number {
  if (end < start) return 0;
  let total = 0;
  let cursor = start;
  while (cursor <= end) {
    const { y, m } = ymd(cursor);
    const monthEnd = Math.round(Date.UTC(y, m + 1, 0) / DAY_MS);
    const last = Math.min(monthEnd, end);
    total += (last - cursor + 1) / daysInMonth(y, m);
    cursor = last + 1;
  }
  return total;
}

function addMonths(day: number, n: number): number {
  if (!Number.isInteger(n)) throw new CalcError("add_months needs a whole number of months.");
  const { y, m, d } = ymd(day);
  const target = new Date(Date.UTC(y, m + n, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  // Jan 31 + 1 month is Feb 28 (or 29): the month's last day, never March.
  return Math.round(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, dim)) / DAY_MS);
}

/* ---------- parsing ---------- */

type Token =
  | { t: "num"; v: number }
  | { t: "date"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new CalcError(`Can't read the number at '${src.slice(i, i + 10)}'.`);
      // 84,000 (a thousands comma, no space) rather than round(x, 2).
      if (!m[0].includes(".") && /^,\d{3}(?!\d)/.test(src.slice(i + m[0].length))) throw new CalcError("Write numbers without commas (84000, not 84,000).");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      const close = src.indexOf(c, i + 1);
      if (close < 0) throw new CalcError("A date is missing its closing quote.");
      out.push({ t: "date", v: src.slice(i + 1, close).trim() });
      i = close + 1;
    } else if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else if (c === "$") {
      throw new CalcError("Leave out the $: write plain numbers.");
    } else if (c === "%") {
      throw new CalcError("Write percentages as numbers (5% is 0.05, or 5 / 100).");
    } else {
      throw new CalcError(`Can't read '${c}'.`);
    }
  }
  return out;
}

class Parser {
  private i = 0;
  private tokens: Token[];
  private names: Map<string, Value>;
  constructor(tokens: Token[], names: Map<string, Value>) {
    this.tokens = tokens;
    this.names = names;
  }

  run(): Value {
    if (!this.tokens.length) throw new CalcError("The expression is empty.");
    const v = this.expr();
    if (this.i < this.tokens.length) throw new CalcError("There's something extra at the end of the expression.");
    return v;
  }

  private peek(v: string) {
    const t = this.tokens[this.i];
    return t?.t === "op" && t.v === v;
  }
  private take(v: string) {
    if (!this.peek(v)) throw new CalcError(`Expected '${v}'.`);
    this.i++;
  }

  private expr(): Value {
    let left = this.term();
    while (this.peek("+") || this.peek("-")) {
      const op = (this.tokens[this.i++] as { v: string }).v;
      const right = this.term();
      left = number(op === "+" ? num(left, "+") + num(right, "+") : num(left, "-") - num(right, "-"));
    }
    return left;
  }

  private term(): Value {
    let left = this.unary();
    while (this.peek("*") || this.peek("/")) {
      const op = (this.tokens[this.i++] as { v: string }).v;
      const right = this.unary();
      if (op === "*") left = number(num(left, "*") * num(right, "*"));
      else {
        const d = num(right, "/");
        if (d === 0) throw new CalcError("Division by zero.");
        left = number(num(left, "/") / d);
      }
    }
    return left;
  }

  private unary(): Value {
    if (this.peek("-")) {
      this.i++;
      return number(-num(this.unary(), "-"));
    }
    if (this.peek("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Value {
    const base = this.primary();
    if (this.peek("^")) {
      this.i++;
      return number(Math.pow(num(base, "^"), num(this.unary(), "^")));
    }
    return base;
  }

  private primary(): Value {
    const t = this.tokens[this.i++];
    if (!t) throw new CalcError("The expression ends too soon.");
    if (t.t === "num") return number(t.v);
    if (t.t === "date") return { kind: "date", d: parseDate(t.v) };
    if (t.t === "op" && t.v === "(") {
      const v = this.expr();
      this.take(")");
      return v;
    }
    if (t.t === "id") {
      if (this.peek("(")) {
        this.i++;
        const args: Value[] = [];
        if (!this.peek(")")) {
          args.push(this.expr());
          while (this.peek(",")) {
            this.i++;
            args.push(this.expr());
          }
        }
        this.take(")");
        return call(t.v, args);
      }
      const v = this.names.get(t.v);
      if (!v) throw new CalcError(`'${t.v}' isn't an earlier result. Name a result before using it.`);
      return v;
    }
    throw new CalcError(`Unexpected '${(t as { v: string }).v}'.`);
  }
}

function number(n: number): Value {
  if (!Number.isFinite(n)) throw new CalcError("The result isn't a finite number.");
  return { kind: "number", n };
}

function num(v: Value, where: string): number {
  if (v.kind !== "number") throw new CalcError(`A date can't be used with '${where}': use days(), months(), add_days(), or add_months().`);
  return v.n;
}

function date(v: Value, fn: string): number {
  if (v.kind !== "date") throw new CalcError(`${fn} needs dates written 'YYYY-MM-DD'.`);
  return v.d;
}

function arity(fn: string, args: Value[], n: number | [number, number]) {
  const [lo, hi] = Array.isArray(n) ? n : [n, n];
  if (args.length < lo || args.length > hi) throw new CalcError(`${fn} takes ${lo === hi ? lo : `${lo} or ${hi}`} values.`);
}

function call(fn: string, args: Value[]): Value {
  switch (fn) {
    case "days": {
      arity(fn, args, 2);
      const [s, e] = [date(args[0], fn), date(args[1], fn)];
      if (e < s) throw new CalcError("days(start, end): the end is before the start.");
      return number(e - s + 1);
    }
    case "overlap_days": {
      arity(fn, args, 4);
      const [as, ae, bs, be] = args.map((a) => date(a, fn));
      return number(Math.max(0, Math.min(ae, be) - Math.max(as, bs) + 1));
    }
    case "months": {
      arity(fn, args, 2);
      const [s, e] = [date(args[0], fn), date(args[1], fn)];
      if (e < s) throw new CalcError("months(start, end): the end is before the start.");
      return number(monthsBetween(s, e));
    }
    case "overlap_months": {
      arity(fn, args, 4);
      const [as, ae, bs, be] = args.map((a) => date(a, fn));
      return number(monthsBetween(Math.max(as, bs), Math.min(ae, be)));
    }
    case "add_days": {
      arity(fn, args, 2);
      const n = num(args[1], fn);
      if (!Number.isInteger(n)) throw new CalcError("add_days needs a whole number of days.");
      return { kind: "date", d: date(args[0], fn) + n };
    }
    case "add_months":
      arity(fn, args, 2);
      return { kind: "date", d: addMonths(date(args[0], fn), num(args[1], fn)) };
    case "round": {
      arity(fn, args, [1, 2]);
      const x = num(args[0], fn);
      const places = args[1] ? num(args[1], fn) : 0;
      if (!Number.isInteger(places) || places < 0 || places > 10) throw new CalcError("round(x, places): places is a whole number from 0 to 10.");
      const f = 10 ** places;
      // Half away from zero, with a nudge so 1.005 rounds to 1.01 as written.
      return number((Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f);
    }
    case "abs":
      arity(fn, args, 1);
      return number(Math.abs(num(args[0], fn)));
    case "min":
    case "max":
    case "sum": {
      if (!args.length) throw new CalcError(`${fn} needs at least one value.`);
      const ns = args.map((a) => num(a, fn));
      return number(fn === "sum" ? ns.reduce((a, b) => a + b, 0) : fn === "min" ? Math.min(...ns) : Math.max(...ns));
    }
    default:
      throw new CalcError(`There's no '${fn}'. Use days, overlap_days, months, overlap_months, add_days, add_months, round, min, max, sum, or abs.`);
  }
}

/* ---------- results ---------- */

/** Up to 10 decimal places, without the float noise (0.1 + 0.2 is 0.3). */
export function formatNumber(n: number): string {
  const fixed = Number(n.toFixed(10));
  if (Object.is(fixed, -0)) return "0";
  return fixed.toLocaleString("en-CA", { maximumFractionDigits: 10, useGrouping: false });
}

const NAME = /^[a-z_][a-z0-9_]{0,59}$/;
const RESERVED = new Set(["days", "overlap_days", "months", "overlap_months", "add_days", "add_months", "round", "abs", "min", "max", "sum"]);

/** Works through the calculations in order; each can use the results named before it. */
export function calculate(calculations: Calculation[]): CalculationResult[] {
  const names = new Map<string, Value>();
  return calculations.map((c) => {
    const base = { name: c.name, label: c.label, expression: c.expression };
    try {
      const name = c.name.trim().toLowerCase();
      if (!NAME.test(name)) throw new CalcError("A name is lower-case letters, digits, and underscores, starting with a letter.");
      if (RESERVED.has(name)) throw new CalcError(`'${name}' is a function: choose another name.`);
      if (c.expression.length > 2000) throw new CalcError("The expression is too long: split it into named steps.");
      const v = new Parser(tokenize(c.expression), names).run();
      names.set(name, v);
      return { ...base, result: v.kind === "date" ? formatDate(v.d) : formatNumber(v.n) };
    } catch (err) {
      if (err instanceof CalcError) return { ...base, error: err.message };
      throw err;
    }
  });
}
