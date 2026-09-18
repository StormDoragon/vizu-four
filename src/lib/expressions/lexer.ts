export type TokenType =
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "DOT"
  | "STAR"
  | "COMMA"
  | "BANG"
  | "LT"
  | "LE"
  | "GT"
  | "GE"
  | "EQ"
  | "NE"
  | "AND"
  | "OR"
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string | number;
  start: number;
  end: number;
}

export class ExpressionSyntaxError extends Error {
  constructor(message: string, public position: number) {
    super(message);
    this.name = "ExpressionSyntaxError";
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/**
 * Tokenizes the *inside* of a `${{ ... }}` expression (or a bare `if:`
 * condition string). GitHub Actions expressions are deliberately small:
 * no arithmetic operators, only comparisons/logic/member-access/calls.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const peek = (offset = 0) => src[i + offset];

  while (i < n) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    const start = i;

    if (c === "(") { tokens.push({ type: "LPAREN", value: c, start, end: ++i }); continue; }
    if (c === ")") { tokens.push({ type: "RPAREN", value: c, start, end: ++i }); continue; }
    if (c === "[") { tokens.push({ type: "LBRACKET", value: c, start, end: ++i }); continue; }
    if (c === "]") { tokens.push({ type: "RBRACKET", value: c, start, end: ++i }); continue; }
    if (c === ",") { tokens.push({ type: "COMMA", value: c, start, end: ++i }); continue; }

    if (c === ".") {
      // `.*` object filter (e.g. steps.*.outputs.result)
      if (peek(1) === "*") {
        tokens.push({ type: "STAR", value: ".*", start, end: i + 2 });
        i += 2;
        continue;
      }
      tokens.push({ type: "DOT", value: c, start, end: ++i });
      continue;
    }

    if (c === "!") {
      if (peek(1) === "=") { tokens.push({ type: "NE", value: "!=", start, end: i + 2 }); i += 2; continue; }
      tokens.push({ type: "BANG", value: c, start, end: ++i });
      continue;
    }
    if (c === "=") {
      if (peek(1) === "=") { tokens.push({ type: "EQ", value: "==", start, end: i + 2 }); i += 2; continue; }
      throw new ExpressionSyntaxError("Unexpected '=' (did you mean '=='?)", i);
    }
    if (c === "<") {
      if (peek(1) === "=") { tokens.push({ type: "LE", value: "<=", start, end: i + 2 }); i += 2; continue; }
      tokens.push({ type: "LT", value: c, start, end: ++i });
      continue;
    }
    if (c === ">") {
      if (peek(1) === "=") { tokens.push({ type: "GE", value: ">=", start, end: i + 2 }); i += 2; continue; }
      tokens.push({ type: "GT", value: c, start, end: ++i });
      continue;
    }
    if (c === "&") {
      if (peek(1) === "&") { tokens.push({ type: "AND", value: "&&", start, end: i + 2 }); i += 2; continue; }
      throw new ExpressionSyntaxError("Unexpected '&' (did you mean '&&'?)", i);
    }
    if (c === "|") {
      if (peek(1) === "|") { tokens.push({ type: "OR", value: "||", start, end: i + 2 }); i += 2; continue; }
      throw new ExpressionSyntaxError("Unexpected '|' (did you mean '||'?)", i);
    }

    if (c === "'") {
      i++;
      let value = "";
      let closed = false;
      while (i < n) {
        if (src[i] === "'" && peek(1) === "'") { value += "'"; i += 2; continue; }
        if (src[i] === "'") { closed = true; i++; break; }
        value += src[i];
        i++;
      }
      if (!closed) throw new ExpressionSyntaxError("Unterminated string literal", start);
      tokens.push({ type: "STRING", value, start, end: i });
      continue;
    }

    if (DIGIT.test(c) || (c === "-" && DIGIT.test(peek(1) ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(src[j])) {
        // stop runaway consumption on a second standalone '-' that isn't part of an exponent
        if ((src[j] === "-" || src[j] === "+") && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (Number.isNaN(value) && text !== "NaN") {
        throw new ExpressionSyntaxError(`Invalid number literal '${text}'`, i);
      }
      tokens.push({ type: "NUMBER", value, start, end: j });
      i = j;
      continue;
    }

    if (c === "-" && src.slice(i, i + 9) === "-Infinity") {
      tokens.push({ type: "NUMBER", value: -Infinity, start, end: i + 9 });
      i += 9;
      continue;
    }

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(src[j])) j++;
      const text = src.slice(i, j);
      if (text === "NaN") {
        tokens.push({ type: "NUMBER", value: NaN, start, end: j });
      } else if (text === "Infinity") {
        tokens.push({ type: "NUMBER", value: Infinity, start, end: j });
      } else {
        tokens.push({ type: "IDENT", value: text, start, end: j });
      }
      i = j;
      continue;
    }

    throw new ExpressionSyntaxError(`Unexpected character '${c}'`, i);
  }

  tokens.push({ type: "EOF", value: "", start: n, end: n });
  return tokens;
}
