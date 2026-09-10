import test from "node:test";
import assert from "node:assert/strict";
import { splitSqlStatements } from "./sql-split.mjs";

test("does not treat apostrophes or semicolons in line comments as SQL delimiters", () => {
  const statements = splitSqlStatements("-- client's note; still prose\nCREATE TABLE sample (id text);\nSELECT 'it''s safe;';");
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TABLE sample/);
  assert.equal(statements[1], "SELECT 'it''s safe;';");
});
