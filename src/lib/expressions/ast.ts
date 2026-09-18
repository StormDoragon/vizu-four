export type AstNode =
  | { type: "Null" }
  | { type: "Bool"; value: boolean }
  | { type: "Number"; value: number }
  | { type: "String"; value: string }
  | { type: "Identifier"; name: string }
  | { type: "Member"; object: AstNode; property: string }
  | { type: "Filter"; object: AstNode } // `.*`
  | { type: "Index"; object: AstNode; index: AstNode }
  | { type: "Call"; callee: string; args: AstNode[] }
  | { type: "Unary"; op: "!"; argument: AstNode }
  | { type: "Binary"; op: "<" | "<=" | ">" | ">=" | "==" | "!="; left: AstNode; right: AstNode }
  | { type: "Logical"; op: "&&" | "||"; left: AstNode; right: AstNode };
