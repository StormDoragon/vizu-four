import type { AstNode } from "./ast";

/**
 * Renders an AST node back to expression syntax. Used only to label a
 * sub-expression in the playground's evaluation trace - not guaranteed to
 * reproduce the user's exact original text (e.g. string-literal quoting is
 * normalized), just something a person would recognize as "that part of
 * what I typed."
 */
export function unparse(node: AstNode): string {
  switch (node.type) {
    case "Null":
      return "null";
    case "Bool":
      return node.value ? "true" : "false";
    case "Number":
      return String(node.value);
    case "String":
      return `'${node.value.replace(/'/g, "''")}'`;
    case "Identifier":
      return node.name;
    case "Member":
      return `${unparse(node.object)}.${node.property}`;
    case "Filter":
      return `${unparse(node.object)}.*`;
    case "Index":
      return `${unparse(node.object)}[${unparse(node.index)}]`;
    case "Call":
      return `${node.callee}(${node.args.map(unparse).join(", ")})`;
    case "Unary":
      return `!${unparse(node.argument)}`;
    case "Binary":
      return `${unparse(node.left)} ${node.op} ${unparse(node.right)}`;
    case "Logical":
      return `${unparse(node.left)} ${node.op} ${unparse(node.right)}`;
  }
}
