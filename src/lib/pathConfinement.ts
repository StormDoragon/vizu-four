import fs from "node:fs";
import path from "node:path";

/**
 * Resolves `segments` under `base`, returning null when the result lands
 * outside it.
 *
 * Resolution goes through the filesystem, not just the string: `path.resolve`
 * is textual, so a symlink inside the base pointing out of it passes a string
 * comparison and the caller then reads or writes the real target. The check
 * has to hold for paths that don't exist yet too - a download destination is
 * usually new - so the deepest existing ancestor is resolved and the missing
 * tail re-appended.
 *
 * Returns the resolved real path, so callers operate on that rather than on
 * the symlinked route they were given.
 */
export function resolveWithin(base: string, ...segments: string[]): string | null {
  // A NUL byte can never be part of a valid path, and `fs` throws a TypeError
  // rather than an ordinary "not found" on one - which the walk below would
  // otherwise read as "doesn't exist yet" and let through to the caller.
  // Reachable straight from pasted YAML, where `\0` is a normal escape.
  if (segments.some((s) => s.includes("\0")) || base.includes("\0")) return null;

  let realBase: string;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return null;
  }

  let existing = path.resolve(realBase, ...segments);
  const missing: string[] = [];
  for (;;) {
    try {
      existing = fs.realpathSync(existing);
      break;
    } catch (err) {
      // Only a genuinely absent path may be walked past. Anything else -
      // a permission error, a parent that is a file, an invalid argument -
      // is a reason to refuse, not to assume the path is simply new.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;

      // `realpath` reports ENOENT for a *dangling* symlink too, because it
      // resolves the target and the target is what is missing. Treating that
      // as "doesn't exist yet" was an escape: the name was kept as part of
      // the missing tail and re-appended to the resolved parent, so the
      // result looked confined, and the caller then wrote through the link
      // to wherever it pointed. `lstat` succeeding here means the entry does
      // exist - realpath failed on its target, not on the entry - so it is a
      // link that resolution cannot follow, and following it is exactly what
      // the caller would do next.
      try {
        fs.lstatSync(existing);
        return null;
      } catch {
        // Genuinely absent; keep walking up.
      }

      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }

  const resolved = missing.length > 0 ? path.resolve(existing, ...missing) : existing;
  const rel = path.relative(realBase, resolved);
  if (rel === "") return resolved;
  if (path.isAbsolute(rel) || rel.split(path.sep)[0] === "..") return null;
  return resolved;
}

/**
 * Whether a glob pattern reaches outside the directory it is matched against
 * before confinement can apply. Per-result checking still runs - this only
 * refuses the patterns that are unambiguously an escape attempt, so they can
 * be reported rather than silently matching nothing.
 */
export function escapesBase(pattern: string): boolean {
  return path.isAbsolute(pattern) || pattern.split("/").includes("..");
}
