/**
 * Parses the file format GitHub Actions uses for `$GITHUB_OUTPUT` and
 * `$GITHUB_ENV`: either `key=value` lines, or a heredoc-style block
 * `key<<DELIMITER` ... `DELIMITER` for multi-line values.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heredoc = line.match(/^([^=<]+)<<(.+)$/);
    if (heredoc) {
      const key = heredoc[1];
      const delimiter = heredoc[2];
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]);
        i++;
      }
      result[key] = valueLines.join("\n");
      i++; // consume delimiter line
      continue;
    }
    const eq = line.indexOf("=");
    if (eq !== -1) {
      result[line.slice(0, eq)] = line.slice(eq + 1);
    }
    i++;
  }
  return result;
}

/** Parses `$GITHUB_PATH`: one directory to prepend per line. */
export function parsePathFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
