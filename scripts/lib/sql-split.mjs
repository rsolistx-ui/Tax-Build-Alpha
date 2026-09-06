/**
 * Splits a SQL script into individual statements on top-level semicolons,
 * without breaking apart dollar-quoted blocks (DO $$ ... $$;) or semicolons
 * inside single-quoted string literals.
 */
export function splitSqlStatements(text) {
  const statements = [];
  let current = "";
  let i = 0;
  let dollarTag = null; // active dollar-quote delimiter, e.g. "$$" or "$tag$", or null
  let inSingleQuote = false;

  while (i < text.length) {
    const ch = text[i];

    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ";") {
      current += ch;
      statements.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim()) statements.push(current);

  return statements.map((statement) => statement.trim()).filter(Boolean);
}
