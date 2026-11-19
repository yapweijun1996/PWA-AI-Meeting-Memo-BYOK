import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("user-facing strings", () => {
  it("contain no question-mark-only placeholder literals", () => {
    const offenders = sourceFiles("src").filter((file) => /"\?{3,}"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
