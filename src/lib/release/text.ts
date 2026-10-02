import { maskSecrets } from "../engine/masking";

/** Mask before truncation. Only public metadata enters this module, never session state. */
export function releaseText(text: string, max = 1200): string {
  return maskSecrets(text, [process.env.ANTHROPIC_API_KEY ?? "", process.env.GITHUB_TOKEN ?? ""])
    .replace(/\r\n?/g, "\n")
    .replace(/\b(?:gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-ant-[a-zA-Z0-9_-]{20,})\b/g, "[redacted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, max);
}

/** Notes are Markdown exports, not a way for source text to inject links or HTML. */
export function markdownText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]()<>!#|~]/g, "\\$&")
    // Break bare autolinks (URLs, www hosts, emails) and @mentions with a zero-width space.
    .replace(/:\/\//g, ":\u200b//").replace(/\bwww\./gi, "www\u200b.").replace(/@/g, "@\u200b");
}
