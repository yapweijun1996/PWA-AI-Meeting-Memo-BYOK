#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import console from "node:console";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { transform } from "lightningcss";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_BASELINE = path.join(SCRIPT_DIR, "ssot-baseline.json");
const RULES = new Set(["color", "radius", "shadow", "font-size", "z-index"]);
const COLOR_TYPES = new Set([
  "rgb", "hsl", "hwb", "lab", "lch", "oklab", "oklch", "predefined", "system",
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65",
]);
const BORDER_RADIUS_PROPERTIES = new Set([
  "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
  "border-start-start-radius", "border-start-end-radius", "border-end-start-radius", "border-end-end-radius",
]);
const STRUCTURAL_RULES = new Map([
  ["border-radius", "radius"], ["border-top-left-radius", "radius"], ["border-top-right-radius", "radius"],
  ["border-bottom-left-radius", "radius"], ["border-bottom-right-radius", "radius"], ["border-start-start-radius", "radius"],
  ["border-start-end-radius", "radius"], ["border-end-start-radius", "radius"], ["border-end-end-radius", "radius"], ["box-shadow", "shadow"],
  ["text-shadow", "shadow"], ["font-size", "font-size"], ["z-index", "z-index"],
]);
const TOKEN_FILES = new Set(["src/style.css", "src/theme.css"]);
const INLINE_STYLE_PROPERTIES = new Set([
  "background", "backgroundColor", "backgroundImage", "borderColor", "borderRadius", "borderBottomLeftRadius",
  "borderBottomRightRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderStartStartRadius", "borderStartEndRadius",
  "borderEndStartRadius", "borderEndEndRadius", "boxShadow", "color", "fill", "fontSize", "outlineColor", "stroke",
  "textDecorationColor", "textEmphasisColor", "textShadow", "zIndex",
]);
const COLOR_FALLBACK_PROPERTIES = new Set([
  "background", "background-image", "border", "border-block", "border-block-end", "border-block-start", "border-bottom", "border-color",
  "border-inline", "border-inline-end", "border-inline-start", "border-left", "border-right", "border-top", "box-shadow", "caret-color",
  "column-rule", "fill", "outline", "outline-color", "stroke", "text-decoration", "text-decoration-color", "text-emphasis",
  "text-emphasis-color", "text-shadow",
]);
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "none", "auto"]);

function usage(message) {
  throw new Error(message);
}

function parseArgs(args) {
  const options = { root: DEFAULT_ROOT, baseline: DEFAULT_BASELINE, writeBaseline: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write-baseline") options.writeBaseline = true;
    else if (arg === "--root" || arg === "--baseline") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) usage(`Missing value for ${arg}`);
      options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else usage(`Unknown argument: ${arg}`);
  }
  return options;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function walkFiles(directory, extensions, out = []) {
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage" || entry.name === "tests" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(full, extensions, out);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function countColorNodes(value) {
  let count = 0;
  const seen = new Set();
  function visit(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (typeof node.type === "string" && COLOR_TYPES.has(node.type)) {
      // Fully transparent colors (including CSS `transparent`) do not define a visible design color.
      if (!(node.type === "rgb" && node.alpha === 0)) count += 1;
      return;
    }
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  }
  visit(value);
  return count;
}

function parseColorLiteral(value) {
  let sheet;
  try {
    transform({ filename: "<inline-color>", code: Buffer.from(`.__ssot__ { color: ${value}; }`), visitor: { StyleSheet(parsed) { sheet = parsed; } } });
  } catch { return 0; }
  const declaration = sheet?.rules?.[0]?.value?.declarations?.declarations?.[0];
  if (!declaration || declaration.property !== "color") return 0;
  return countColorNodes(declaration.value) + countFallbackColorTokens(declaration.value);
}

function countFallbackColorTokens(value) {
  let count = 0;
  function visit(node, inFallback = false) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((item) => visit(item, inFallback)); return; }
    if (node.type === "var" && node.value?.fallback) visit(node.value.fallback, true);
    else if (inFallback && node.type === "token" && node.value?.type === "ident") count += parseColorLiteral(String(node.value.value));
    for (const [key, child] of Object.entries(node)) {
      if (node.type === "var" && key === "value") continue;
      visit(child, inFallback);
    }
  }
  visit(value);
  return count;
}

function hasColorFallbackContext(property) {
  return COLOR_FALLBACK_PROPERTIES.has(property) || /^(?:color|background-color|border.*-color|outline-color|text-.*-color|accent-color)$/.test(property ?? "");
}

function countCustomValueColors(tokens) {
  let count = 0;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "token" && node.value?.type === "ident") count += parseColorLiteral(String(node.value.value));
    if (node.type === "color") { count += countColorNodes(node.value); return; }
    for (const child of Object.values(node)) visit(child);
  }
  visit(tokens);
  return count;
}

function hasNonzeroNumeric(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasNonzeroNumeric);
  if (typeof value.type === "string" && COLOR_TYPES.has(value.type)) return false;
  if (typeof value.value === "number" && value.value !== 0 && (value.type === "integer" || value.type === "number" || value.type === "percentage" || typeof value.unit === "string")) return true;
  if (value.type === "unparsed") return hasNonzeroNumeric(value.value?.value);
  if (value.type === "var" && value.value?.fallback) return hasNonzeroNumeric(value.value.fallback);
  return Object.values(value).some(hasNonzeroNumeric);
}

function hasStructuralDebt(rule, value) {
  if (!value || typeof value !== "object") return false;
  if (value.type === "unparsed") return hasStructuralDebt(rule, value.value?.value ?? []);
  if (value.type === "var") return value.value?.fallback ? hasStructuralDebt(rule, value.value.fallback) : false;
  if (Array.isArray(value)) return value.some((item) => hasStructuralDebt(rule, item));
  if (rule === "font-size" && (value.type === "absolute" || value.type === "relative")) return true;
  if (rule === "z-index" || rule === "font-size" || rule === "radius") return hasNonzeroNumeric(value);
  if (rule === "shadow") return hasNonzeroNumeric(value);
  return false;
}

function isRootTokenScope(selectors) {
  return Array.isArray(selectors) && selectors.length > 0 && selectors.every((selector) =>
    selector.some((component) => component.type === "pseudo-class" && component.kind === "root") &&
    selector.every((component) => (component.type === "pseudo-class" && component.kind === "root") || component.type === "attribute"));
}

function addDebt(debts, file, rule, count = 1) {
  if (!count) return;
  debts[file] ??= {};
  debts[file][rule] = (debts[file][rule] ?? 0) + count;
}

function isTokenCustomProperty(file, declaration, selectors) {
  return TOKEN_FILES.has(file) && declaration.property === "custom" && isRootTokenScope(selectors);
}

function analyzeDeclaration(declaration, file, debts, selectors) {
  if (declaration.property === "custom") {
    if (!isTokenCustomProperty(file, declaration, selectors)) {
      addDebt(debts, file, "color", countCustomValueColors(declaration.value.value));
      const category = customPropertyRule(String(declaration.value.name));
      if (category && hasStructuralDebt(category, declaration.value.value)) addDebt(debts, file, category);
    }
    return;
  }
  const sourceProperty = declaration.property === "unparsed" ? declaration.value.propertyId?.property : declaration.property;
  addDebt(debts, file, "color", countColorNodes(declaration.value) + (hasColorFallbackContext(sourceProperty) ? countFallbackColorTokens(declaration.value) : 0));
  const category = STRUCTURAL_RULES.get(sourceProperty) ?? (BORDER_RADIUS_PROPERTIES.has(sourceProperty) ? "radius" : null);
  if (category && hasStructuralDebt(category, declaration.value)) addDebt(debts, file, category);
}

function customPropertyRule(name) {
  const normalized = name.toLowerCase();
  if (/radius/.test(normalized)) return "radius";
  if (/shadow/.test(normalized)) return "shadow";
  if (/font[-_]?size/.test(normalized)) return "font-size";
  if (/z[-_]?index/.test(normalized)) return "z-index";
  return null;
}

function selectorName(selector) {
  if (selector.length !== 1 || selector[0]?.type !== "class") return null;
  return `.${selector[0].name}`;
}

function analyzeCss(source, file, debts, selectorFiles) {
  let sheet;
  try {
    transform({ filename: file, code: Buffer.from(source), visitor: { StyleSheet(value) { sheet = value; } } });
  } catch (error) {
    throw new Error(`${file}: CSS parse failed: ${error.message}`, { cause: error });
  }
  if (!sheet) throw new Error(`${file}: CSS parser returned no stylesheet`);

  function visitRules(rules = []) {
    for (const rule of rules) {
      if (rule.type === "style") {
        const style = rule.value;
        for (const selector of style.selectors ?? []) {
          const name = selectorName(selector);
          if (name) {
            selectorFiles[name] ??= new Set();
            selectorFiles[name].add(file);
          }
        }
        for (const declaration of [...(style.declarations?.declarations ?? []), ...(style.declarations?.importantDeclarations ?? [])]) {
          analyzeDeclaration(declaration, file, debts, style.selectors);
        }
        visitRules(style.rules);
      } else if (rule.value?.rules) visitRules(rule.value.rules);
      else if (rule.type === "keyframes") {
        for (const frame of rule.value.keyframes ?? []) {
          for (const declaration of [...(frame.declarations?.declarations ?? []), ...(frame.declarations?.importantDeclarations ?? [])]) {
            analyzeDeclaration(declaration, file, debts, []);
          }
        }
      }
    }
  }
  visitRules(sheet.rules);
}

function analyzeInlineLiteral(property, value, file, debts) {
  const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
  const css = `.__ssot__ { ${cssProperty}: ${value}; }`;
  let sheet;
  try {
    transform({ filename: file, code: Buffer.from(css), visitor: { StyleSheet(parsed) { sheet = parsed; } } });
  } catch (error) {
    throw new Error(`${file}: invalid inline CSS literal for ${property}: ${error.message}`, { cause: error });
  }
  const declarations = sheet?.rules?.[0]?.value?.declarations?.declarations ?? [];
  if (!declarations.length) throw new Error(`${file}: inline CSS parser rejected the ${property} literal`);
  for (const declaration of declarations) {
    const sourceProperty = declaration.property === "unparsed" ? declaration.value.propertyId?.property : declaration.property;
    if (declaration.property === "unparsed" && !hasAcceptedUnparsedValue(declaration.value)) {
      throw new Error(`${file}: invalid inline CSS literal for ${property}`);
    }
    addDebt(debts, file, "color", countColorNodes(declaration.value) + (hasColorFallbackContext(sourceProperty) ? countFallbackColorTokens(declaration.value) : 0));
    const category = STRUCTURAL_RULES.get(sourceProperty) ?? (BORDER_RADIUS_PROPERTIES.has(sourceProperty) ? "radius" : null);
    if (category && hasStructuralDebt(category, declaration.value)) addDebt(debts, file, category);
  }
}

function hasAcceptedUnparsedValue(unparsed) {
  let hasVariable = false;
  let keyword = null;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "var") hasVariable = true;
    if (node.type === "token" && node.value?.type === "ident") keyword = String(node.value.value).toLowerCase();
    for (const child of Object.values(node)) visit(child);
  }
  visit(unparsed?.value);
  return hasVariable || CSS_WIDE_KEYWORDS.has(keyword);
}

function analyzeTypeScript(source, file, debts) {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length) {
    const message = ts.flattenDiagnosticMessageText(sourceFile.parseDiagnostics[0].messageText, " ");
    throw new Error(`${file}: TypeScript parse failed: ${message}`);
  }
  const inlineStyleLiterals = new WeakSet();
  function isExactColorLiteral(node) {
    const value = node.text.trim();
    if (/^#[\da-f]{3,8}$/i.test(value) || /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i.test(value)) return true;
    const parent = node.parent;
    const jsxAttribute = ts.isJsxExpression(parent) ? parent.parent : parent;
    if (ts.isJsxAttribute(jsxAttribute) && ["color", "fill", "stroke"].includes(jsxAttribute.name.getText(sourceFile))) return parseColorLiteral(value) > 0;
    let ancestor = parent;
    while (ancestor && !ts.isVariableDeclaration(ancestor) && !ts.isCallExpression(ancestor)) ancestor = ancestor.parent;
    if (ancestor && ts.isVariableDeclaration(ancestor) && ts.isIdentifier(ancestor.name) && /(?:color|palette|hair|background)/i.test(ancestor.name.text) && ts.isArrayLiteralExpression(ancestor.initializer)) return parseColorLiteral(value) > 0;
    if (ancestor && ts.isCallExpression(ancestor) && ts.isPropertyAccessExpression(ancestor.expression) && ancestor.expression.name.text === "setAttribute") {
      const attributeName = ancestor.arguments[0];
      if (attributeName && ts.isStringLiteralLike(attributeName) && attributeName.text.toLowerCase() === "content") return parseColorLiteral(value) > 0;
    }
    return false;
  }
  function visit(node) {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const property = node.name.text;
      if (INLINE_STYLE_PROPERTIES.has(property) && (ts.isStringLiteralLike(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
        analyzeInlineLiteral(property, node.initializer.text, file, debts);
        inlineStyleLiterals.add(node.initializer);
      } else if (ts.isNumericLiteral(node.initializer)) {
        if (INLINE_STYLE_PROPERTIES.has(property)) {
          const value = property.toLowerCase() === "zindex" ? node.initializer.text : `${node.initializer.text}px`;
          analyzeInlineLiteral(property, value, file, debts);
        }
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !inlineStyleLiterals.has(node) && isExactColorLiteral(node)) {
      addDebt(debts, file, "color", parseColorLiteral(node.text));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function analyzeBrowserChrome(root, debts) {
  const indexFile = path.join(root, "index.html");
  if (!fs.existsSync(indexFile)) return;
  const source = fs.readFileSync(indexFile, "utf8");
  const metaTags = source.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/\bname\s*=\s*(["'])theme-color\1/i.test(tag)) continue;
    const match = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
    if (!match) continue;
    const file = "index.html";
    analyzeInlineLiteral("color", match[2], file, debts);
  }
}

function scan(root) {
  const debts = {};
  const selectorFiles = {};
  for (const filename of walkFiles(path.join(root, "src"), new Set([".css", ".ts", ".tsx"]))) {
    const file = relative(root, filename);
    const source = fs.readFileSync(filename, "utf8");
    if (filename.endsWith(".css")) analyzeCss(source, file, debts, selectorFiles);
    else analyzeTypeScript(source, file, debts);
  }
  analyzeBrowserChrome(root, debts);
  const duplicates = Object.fromEntries(Object.entries(selectorFiles)
    .filter(([, owners]) => owners.size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([selector, owners]) => [selector, [...owners].sort()]));
  return { debts: sortDebt(debts), selectorOwners: duplicates };
}

function sortDebt(debts) {
  return Object.fromEntries(Object.entries(debts).sort(([a], [b]) => a.localeCompare(b)).map(([file, counts]) => [
    file, Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
  ]));
}

function validateBaseline(baseline, filename) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) || baseline.version !== 1 || !baseline.files || !baseline.selectorOwners) {
    throw new Error(`${filename}: invalid baseline shape; expected version 1, files, and selectorOwners`);
  }
  if (typeof baseline.files !== "object" || Array.isArray(baseline.files) || typeof baseline.selectorOwners !== "object" || Array.isArray(baseline.selectorOwners)) {
    throw new Error(`${filename}: files and selectorOwners must be objects`);
  }
  if (Object.keys(baseline).sort().join(",") !== "files,selectorOwners,version") throw new Error(`${filename}: unexpected top-level baseline fields`);
  const validSourcePath = (file) => typeof file === "string" && !path.posix.isAbsolute(file) && path.posix.normalize(file) === file && !file.split("/").includes("..") && (file === "index.html" || file.startsWith("src/"));
  for (const [file, counts] of Object.entries(baseline.files)) {
    if (!validSourcePath(file) || file.includes("\\") || !counts || typeof counts !== "object" || Array.isArray(counts)) throw new Error(`${filename}: invalid debt entry for ${file}`);
    for (const [rule, count] of Object.entries(counts)) if (!RULES.has(rule) || !Number.isSafeInteger(count) || count < 0) throw new Error(`${filename}: invalid ${rule} count for ${file}`);
  }
  for (const [selector, owners] of Object.entries(baseline.selectorOwners)) {
    if (!/^\.[A-Za-z_][\w-]*$/.test(selector) || !Array.isArray(owners) || owners.length < 2 || owners.some((owner) => !validSourcePath(owner) || !owner.endsWith(".css") || owner.includes("\\")) || new Set(owners).size !== owners.length) {
      throw new Error(`${filename}: invalid duplicate selector ownership for ${selector}`);
    }
  }
}

function compare(current, baseline) {
  const failures = [];
  for (const [file, rules] of Object.entries(current.debts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const previous = baseline.files[file]?.[rule] ?? 0;
      if (count > previous) failures.push(`${file} [${rule}] ${count} exceeds baseline ${previous}`);
    }
  }
  for (const [selector, owners] of Object.entries(current.selectorOwners)) {
    const previous = baseline.selectorOwners[selector] ?? [];
    const added = owners.filter((owner) => !previous.includes(owner));
    if (!baseline.selectorOwners[selector]) failures.push(`${selector} has new cross-file owners: ${owners.join(", ")}`);
    else if (added.length) failures.push(`${selector} has additional owner(s): ${added.join(", ")}`);
  }
  return failures.sort((a, b) => a.localeCompare(b));
}

function readBaseline(filename) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { throw new Error(`${filename}: cannot read valid JSON baseline: ${error.message}`, { cause: error }); }
  validateBaseline(parsed, relative(path.dirname(path.dirname(filename)), filename));
  return parsed;
}

function summary(current) {
  const counts = {};
  let total = 0;
  for (const fileCounts of Object.values(current.debts)) for (const [rule, count] of Object.entries(fileCounts)) {
    counts[rule] = (counts[rule] ?? 0) + count;
    total += count;
  }
  return { total, counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))), duplicateSelectors: Object.keys(current.selectorOwners).length };
}

export function check(root = DEFAULT_ROOT, baselineFile = DEFAULT_BASELINE, writeBaseline = false) {
  const absoluteRoot = path.resolve(root);
  const current = scan(absoluteRoot);
  if (writeBaseline) {
    const baseline = { version: 1, files: current.debts, selectorOwners: current.selectorOwners };
    fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    return { current, failures: [], created: true };
  }
  const baseline = readBaseline(baselineFile);
  return { current, failures: compare(current, baseline), created: false };
}

// This ratchet catches additive static debt but cannot detect a count-neutral replacement within one file/rule.
// It is a scoped source check; it does not establish complete CSS coverage, accessibility, or runtime correctness.

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = check(options.root, options.baseline, options.writeBaseline);
  const totals = summary(result.current);
  if (result.created) {
    console.log(`SSOT baseline written: ${options.baseline}`);
    console.log(`Current debt: ${totals.total} (${Object.entries(totals.counts).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}); ${totals.duplicateSelectors} duplicate selectors`);
    return;
  }
  if (result.failures.length) {
    console.error(`SSOT check failed: ${result.failures.length} added violation(s).`);
    for (const message of result.failures.slice(0, 20)) console.error(`  ${message}`);
    if (result.failures.length > 20) console.error(`  ... ${result.failures.length - 20} more`);
  } else console.log(`SSOT check passed: ${totals.total} debt count(s) within baseline (${Object.entries(totals.counts).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}); ${totals.duplicateSelectors} duplicate selectors.`);
  if (result.failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`SSOT check error: ${error.message}`); process.exitCode = 2; }
}
