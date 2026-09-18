import { ExpressionSyntaxError, tokenize, type Token, type TokenType } from "./lexer";
import type { AstNode } from "./ast";

/**
 * Recursive-descent parser for GitHub Actions expressions.
 *
 * Precedence (low to high binding), matching docs.github.com's expressions
 * reference: `||`, `&&`, `==`/`!=`, `<`/`<=`/`>`/`>=`, unary `!`, then
 * postfix member/index/call, then primaries.
 */
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, context: string): Token {
    if (!this.check(type)) {
      const tok = this.peek();
      throw new ExpressionSyntaxError(
        `Expected ${type} ${context}, got ${tok.type} '${tok.value}'`,
        tok.start
      );
    }
    return this.advance();
  }

  parseProgram(): AstNode {
    const expr = this.parseOr();
    this.expect("EOF", "at end of expression");
    return expr;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.check("OR")) {
      this.advance();
      const right = this.parseAnd();
      left = { type: "Logical", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseEquality();
    while (this.check("AND")) {
      this.advance();
      const right = this.parseEquality();
      left = { type: "Logical", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): AstNode {
    let left = this.parseRelational();
    while (this.check("EQ") || this.check("NE")) {
      const op = this.advance().type === "EQ" ? "==" : "!=";
      const right = this.parseRelational();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): AstNode {
    let left = this.parseUnary();
    while (
      this.check("LT") ||
      this.check("LE") ||
      this.check("GT") ||
      this.check("GE")
    ) {
      const map: Record<string, "<" | "<=" | ">" | ">="> = {
        LT: "<",
        LE: "<=",
        GT: ">",
        GE: ">=",
      };
      const op = map[this.advance().type];
      const right = this.parseUnary();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.check("BANG")) {
      this.advance();
      const argument = this.parseUnary();
      return { type: "Unary", op: "!", argument };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    for (;;) {
      if (this.check("DOT")) {
        this.advance();
        const ident = this.expect("IDENT", "after '.'");
        node = { type: "Member", object: node, property: String(ident.value) };
        continue;
      }
      if (this.check("STAR")) {
        this.advance();
        node = { type: "Filter", object: node };
        continue;
      }
      if (this.check("LBRACKET")) {
        this.advance();
        const index = this.parseOr();
        this.expect("RBRACKET", "to close '['");
        node = { type: "Index", object: node, index };
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const tok = this.peek();

    if (tok.type === "NUMBER") {
      this.advance();
      return { type: "Number", value: tok.value as number };
    }
    if (tok.type === "STRING") {
      this.advance();
      return { type: "String", value: String(tok.value) };
    }
    if (tok.type === "LPAREN") {
      this.advance();
      const expr = this.parseOr();
      this.expect("RPAREN", "to close '('");
      return expr;
    }
    if (tok.type === "IDENT") {
      this.advance();
      const name = String(tok.value);
      const lower = name.toLowerCase();
      if (lower === "true") return { type: "Bool", value: true };
      if (lower === "false") return { type: "Bool", value: false };
      if (lower === "null") return { type: "Null" };

      if (this.check("LPAREN")) {
        this.advance();
        const args: AstNode[] = [];
        if (!this.check("RPAREN")) {
          args.push(this.parseOr());
          while (this.check("COMMA")) {
            this.advance();
            args.push(this.parseOr());
          }
        }
        this.expect("RPAREN", "to close function call");
        return { type: "Call", callee: name, args };
      }

      return { type: "Identifier", name };
    }

    throw new ExpressionSyntaxError(
      `Unexpected token ${tok.type} '${tok.value}'`,
      tok.start
    );
  }
}

export function parseExpression(src: string): AstNode {
  return new Parser(src).parseProgram();
}

export { ExpressionSyntaxError } from "./lexer";
