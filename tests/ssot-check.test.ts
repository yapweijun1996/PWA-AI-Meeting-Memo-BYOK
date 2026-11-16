import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/check-ssot.mjs");
const temporaryRoots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-memo-ssot-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const baseline = path.join(root, "baseline.json");
  fs.writeFileSync(baseline, JSON.stringify({ version: 1, files: {}, selectorOwners: {} }, null, 2) + "\n");
  return { root, baseline };
}

function write(root: string, filename: string, contents: string) {
  const target = path.join(root, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function run(root: string, baseline: string) {
  return spawnSync(process.execPath, [script, "--root", root, "--baseline", baseline], { encoding: "utf8" });
}

function setBaseline(filename: string, value: object) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + "\n");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("meeting-memo-ssot-")) {
      throw new Error(`Refusing to remove unexpected test path: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("SSOT checker", () => {
  it("rejects raw CSS colors and a new file/rule combination even if another file's debt is removed", () => {
    const { root, baseline } = fixture();
    setBaseline(baseline, { version: 1, files: { "src/old.css": { color: 1 } }, selectorOwners: {} });
    write(root, "src/old.css", ".old { color: var(--text); }");
    write(root, "src/new.css", ".new { color: red; }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/new.css [color]");
  });

  it("rejects an additional cross-file base-selector owner", () => {
    const { root, baseline } = fixture();
    setBaseline(baseline, { version: 1, files: {}, selectorOwners: { ".panel": ["src/a.css", "src/b.css"] } });
    write(root, "src/a.css", ".panel { display: block; }");
    write(root, "src/b.css", ".panel { display: grid; }");
    write(root, "src/c.css", ".panel { display: flex; }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".panel has additional owner(s): src/c.css");
  });

  it("counts predefined CSS color spaces in stylesheets and TypeScript literals", () => {
    const { root, baseline } = fixture();
    const spaces = ["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65"];
    write(root, "src/colors.css", spaces.map((space, index) => `.color-${index} { color: color(${space} 1 0 0); }`).join("\n"));
    write(root, "src/colors.ts", `export const colors = ${JSON.stringify(spaces.map((space) => `color(${space} 1 0 0)`))};`);
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/colors.css [color] 8 exceeds baseline 0");
    expect(result.stderr).toContain("src/colors.ts [color] 8 exceeds baseline 0");
  });

  it("counts nonzero radius and font percentages while preserving percentage resets and variable-only values", () => {
    const { root, baseline } = fixture();
    write(root, "src/percent.css", ".sized { border-radius: 50%; font-size: 100%; }");
    write(root, "src/percent.tsx", "export const View = () => <span style={{ borderRadius: '50%', fontSize: '100%' }} />;");
    write(root, "src/fallback.css", ".fallback { border-radius: var(--radius, 50%); font-size: var(--size, 100%); }");
    write(root, "src/reset.css", ".reset { border-radius: 0%; font-size: 0%; } .variable { border-radius: var(--radius); font-size: var(--size); }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    for (const filename of ["src/percent.css", "src/percent.tsx", "src/fallback.css"]) {
      for (const rule of ["radius", "font-size"]) expect(result.stderr).toContain(`${filename} [${rule}] 1 exceeds baseline 0`);
    }
    expect(result.stderr).not.toContain("src/reset.css");
  });

  it("counts named colors in static JSX attribute expressions without counting variable references or color resets", () => {
    const { root, baseline } = fixture();
    write(root, "src/named-colors.tsx", [
      'export const View = () => <svg color={"rebeccapurple"}>',
      '<path fill={"red"} stroke={"blue"} />',
      '<path fill="red" stroke="blue" />',
      '<path fill={"transparent"} stroke={"currentColor"} />',
      '<path fill={paint} stroke={paint} />',
      '</svg>;',
    ].join("\n"));
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/named-colors.tsx [color] 5 exceeds baseline 0");
  });

  it("checks structural design debt inside keyframe declarations", () => {
    const { root, baseline } = fixture();
    write(root, "src/animation.css", "@keyframes change { from { border-radius: 4px; box-shadow: 0 1px 2px #000; font-size: 14px; z-index: 1; } }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    for (const rule of ["color", "radius", "shadow", "font-size", "z-index"]) expect(result.stderr).toContain(`[${rule}]`);
  });

  it("passes when existing debt is deleted without baseline growth", () => {
    const { root, baseline } = fixture();
    setBaseline(baseline, { version: 1, files: { "src/a.css": { color: 1, radius: 1 } }, selectorOwners: { ".panel": ["src/a.css", "src/b.css"] } });
    write(root, "src/a.css", ".a { color: var(--text); border-radius: var(--radius); } .panel { display: block; } @media (min-width: 40rem) { .panel { display: grid; } }");
    write(root, "src/b.css", ".panel { display: flex; }");
    expect(run(root, baseline).status).toBe(0);
  });

  // Keep independent CLI failures separate so process startup time does not accumulate in one test.
  it.each([
    ["CSS", "src/broken.css", "%%% { color: red; }"],
    ["TypeScript", "src/broken.tsx", "export const = ;"],
  ])("rejects malformed %s source", (_language, filename, contents) => {
    const { root, baseline } = fixture();
    write(root, filename, contents);
    expect(run(root, baseline).status).toBe(2);
  });

  it.each([
    ["unsupported baseline version", JSON.stringify({ version: 2, files: {}, selectorOwners: {} })],
    ["malformed baseline JSON", "{\n"],
  ])("rejects %s", (_configuration, contents) => {
    const { root, baseline } = fixture();
    write(root, "src/valid.css", ".valid { color: var(--token); }");
    fs.writeFileSync(baseline, contents);
    expect(run(root, baseline).status).toBe(2);
  });

  it("rejects malformed recognized inline CSS literals instead of skipping them", () => {
    const { root, baseline } = fixture();
    write(root, "src/ui.tsx", "export const View = () => <span style={{ color: '#zzzzzz' }} />;");
    const result = run(root, baseline);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid inline CSS literal for color");
  });

  it("ignores comments and URLs while detecting typed inline CSS strings", () => {
    const { root, baseline } = fixture();
    write(root, "src/a.css", "/* #abc color: red */\n.icon { background-image: url('/asset/#fff'); content: '#fed'; }");
    write(root, "src/ui.tsx", "export const View = () => <span style={{ color: '#123456' }} />;");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/ui.tsx [color]");
    expect(result.stderr).not.toContain("src/a.css");
  });

  it("detects inline radius, shadow, font-size, and z-index strings", () => {
    const { root, baseline } = fixture();
    write(root, "src/ui.tsx", "export const View = () => <span style={{ borderRadius: '4px', boxShadow: '0 0 2px #123', fontSize: '13px', zIndex: '42' }} />;");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    for (const rule of ["color", "radius", "shadow", "font-size", "z-index"]) expect(result.stderr).toContain(`[${rule}]`);
  });

  it("uses the TypeScript parser so comments do not become inline-style debt", () => {
    const { root, baseline } = fixture();
    write(root, "src/ui.tsx", "// style={{ color: '#123456' }}\nexport const View = () => <span style={{ color: 'var(--text)' }} />;");
    expect(run(root, baseline).status).toBe(0);
  });

  it("keeps browser-chrome colors in index.html as design debt", () => {
    const { root, baseline } = fixture();
    write(root, "index.html", '<meta name="theme-color" content="#123456">');
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("index.html [color]");
  });

  it("counts TypeScript color literals and JSX SVG fill while ignoring comments and URL or route hashes", () => {
    const { root, baseline } = fixture();
    write(root, "src/appearance.tsx", [
      '// const ignored = "#000000";',
      'const route = "#/settings";',
      'const url = "https://example.test/#ffffff";',
      'const theme = isDark ? "#15191f" : "#f7f8fa";',
      'const icon = <svg><path fill="#ff00ff" stroke="currentColor" /></svg>;',
    ].join("\n"));
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/appearance.tsx [color] 3 exceeds baseline 0");
  });

  it("exempts only custom properties in root token scopes", () => {
    const { root, baseline } = fixture();
    write(root, "src/style.css", ":root { --token: #123456; --radius: 0; }");
    expect(run(root, baseline).status).toBe(0);
    write(root, "src/style.css", ":root { --token: #123456; --radius: 0; } .component { --local: #abcdef; --radius: 4px; }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/style.css [color] 1 exceeds baseline 0");
    expect(result.stderr).toContain("src/style.css [radius] 1 exceeds baseline 0");
  });

  it("ignores variable-only and reset values but counts literal fallbacks", () => {
    const { root, baseline } = fixture();
    const source = write(root, "src/a.css", [
      ".reset { border-radius: 0; box-shadow: none; font-size: 0; z-index: 0; color: var(--text);",
      "border-radius: var(--radius); box-shadow: var(--shadow); font-size: var(--size); z-index: var(--layer);",
      "font-family: var(--font, red); }",
    ].join(" "));
    expect(run(root, baseline).status).toBe(0);
    fs.writeFileSync(source, ".fallback { color: var(--text, red); border-radius: var(--radius, 4px); box-shadow: var(--shadow, 0 2px 4px #fff); font-size: var(--size, 14px); z-index: var(--layer, 2); }");
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    for (const rule of ["color", "radius", "shadow", "font-size", "z-index"]) expect(result.stderr).toContain(`[${rule}]`);
  });

  it("reports CLI failure without changing source or baseline bytes", () => {
    const { root, baseline } = fixture();
    const source = write(root, "src/a.css", ".a { color: #112233; }");
    const sourceBefore = fs.readFileSync(source);
    const baselineBefore = fs.readFileSync(baseline);
    const result = run(root, baseline);
    expect(result.status).toBe(1);
    expect(fs.readFileSync(source).equals(sourceBefore)).toBe(true);
    expect(fs.readFileSync(baseline).equals(baselineBefore)).toBe(true);
  });
});
