/**
 * Build gate: no value may be spliced directly into a SQL string. Every
 * interpolated value must go through sqlString()/sqlStringList().
 *
 * Scans every .ts file under src/ for the raw-interpolation signature — a single
 * quote immediately followed by a `${...}` template substitution — and fails
 * unless the line opts out with a trailing `// sql-escape-allowed`. Exactly one
 * line is expected to carry that annotation: the body of sqlString() itself.
 *
 *   npx tsx scripts/check-sql-escaping.ts        # exits non-zero on violation
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** A single quote directly followed by a template substitution: `'` + `${`. */
const RAW_INTERPOLATION = "'" + "${";
const ALLOW_ANNOTATION = "// sql-escape-allowed";

export interface EscapeViolation {
  file: string;
  line: number;
  text: string;
}

/** Recursively list every .ts file under `dir`. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Every line under `root` that splices a value directly into a SQL string
 * without going through sqlString(), unless it opts out with the annotation.
 */
export function findSqlEscapeViolations(root: string): EscapeViolation[] {
  const violations: EscapeViolation[] = [];
  for (const file of tsFiles(root)) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, index) => {
        if (text.includes(RAW_INTERPOLATION) && !text.includes(ALLOW_ANNOTATION)) {
          violations.push({ file, line: index + 1, text: text.trim() });
        }
      });
  }
  return violations;
}

/** Run as a build gate when invoked directly. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const srcRoot = path.resolve(fileURLToPath(new URL("../src", import.meta.url)));
  const violations = findSqlEscapeViolations(srcRoot);
  if (violations.length > 0) {
    console.error(
      `SQL-escaping guard: ${violations.length} raw interpolation(s) — route through sqlString(), or annotate with ${ALLOW_ANNOTATION}:`,
    );
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    process.exit(1);
  }
  console.log("SQL-escaping guard: no raw SQL interpolation found under src/.");
}
