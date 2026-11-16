/// <reference types="node" />
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { expect, it } from "vitest";

// This contract intentionally targets this repository's small workflow. GitHub
// owns scheduling semantics; these checks protect its security-critical wiring.
const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const fullCondition = "${{ github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && inputs.run_full) }}";
const trustedPush = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const fastCommands = ["npm ci", "npm run lint", "npm run test:unit", "npm run check:ssot", "npm run build", "npm run check:artifact"];
const fullCommands = ["npx playwright install --with-deps chromium webkit", "npm run test:e2e", "npm run test:catalogue", "npm run test:pwa"];

function jobs(source: string) {
  const verify = source.split("  verify:\n")[1]?.split("\n  publish:")[0];
  const publish = source.split("\n  publish:\n")[1];
  expect(verify).toBeDefined();
  expect(publish).toBeDefined();
  return { verify: verify!, publish: publish! };
}

function steps(job: string) {
  return job.split(/(?=^ {6}- name: )/m).slice(1);
}

function commandStep(job: string, command: string) {
  const matches = steps(job).filter(step => step.includes(`run: ${command}\n`));
  expect(matches, command).toHaveLength(1);
  return matches[0];
}

function requireFastChecks(source: string) {
  const { verify } = jobs(source);
  let previous = -1;
  for (const command of fastCommands) {
    const step = commandStep(verify, command);
    expect(step, `${command} must run for every selected event`).not.toMatch(/^ {8}if:/m);
    const position = verify.indexOf(step);
    expect(position, command).toBeGreaterThan(previous);
    previous = position;
  }
  expect(verify.indexOf("uses: actions/upload-pages-artifact@")).toBeGreaterThan(previous);
}

function requireFullChecks(source: string) {
  const { verify } = jobs(source);
  expect(verify).toContain(`      RUN_FULL_CHECKS: ${fullCondition}\n`);
  let previous = verify.indexOf("run: npm run check:artifact");
  for (const command of fullCommands) {
    const step = commandStep(verify, command);
    expect(step).toContain("        if: env.RUN_FULL_CHECKS == 'true'\n");
    const position = verify.indexOf(step);
    expect(position, command).toBeGreaterThan(previous);
    previous = position;
  }
  expect(verify.indexOf("uses: actions/upload-pages-artifact@")).toBeGreaterThan(previous);
}

function requireTrustedPublication(source: string) {
  const { verify, publish } = jobs(source);
  const upload = steps(verify).find(step => step.includes("uses: actions/upload-pages-artifact@"));
  expect(upload).toContain(`        if: ${trustedPush}\n`);
  expect(upload).toContain("          path: dist\n");
  expect(publish).toContain(`    if: ${trustedPush}\n`);
  expect(publish).toContain("    needs: verify\n");
  expect(verify).not.toMatch(/pages: write|id-token: write/);
  expect(publish).toContain("      contents: read\n      pages: write\n      id-token: write\n");
  expect(publish).toContain("      group: pages-production\n      cancel-in-progress: false\n");
  const guard = publish.indexOf("name: Check that this is still the main head");
  const configure = publish.indexOf("uses: actions/configure-pages@");
  const deploy = publish.indexOf("uses: actions/deploy-pages@");
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(configure).toBeGreaterThan(guard);
  expect(deploy).toBeGreaterThan(configure);
  expect(publish).toContain('gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main"');
  expect(publish).toContain('if [ "$latest_sha" = "$GITHUB_SHA" ]');
  expect(publish.match(/if: steps\.current\.outputs\.publish == 'true'/g)).toHaveLength(2);
}

function requireEventPolicy(source: string) {
  const push = source.split("  push:\n")[1]?.split("  pull_request:\n")[0];
  const pullRequest = source.split("  pull_request:\n")[1]?.split("  workflow_dispatch:\n")[0];
  expect(push).toContain("    branches: [main]\n");
  const ignored = [...(push ?? "").matchAll(/^ {6}- '([^']+)'$/gm)].map(match => match[1]);
  expect(ignored).toEqual(["docs/**", "**/*.md"]);
  expect(pullRequest).toBe("    branches: [main]\n");
  expect(source).toContain("      run_full:\n");
  expect(source).toContain("        type: boolean\n        default: true\n");
  expect(source).not.toMatch(/pull_request_target|^ {2}schedule:/m);
  return ignored;
}

it("requires the fast lint, unit, SSOT, type/build and artifact gates before upload", () => {
  requireFastChecks(workflow);
  // Build already owns TypeScript, so the fast lane need not run it twice.
  expect(packageJson.scripts.build).toMatch(/^tsc -b && vite build && node scripts\/build-pwa\.mjs$/);
  expect(readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim()).toMatch(/^22\./);
  expect(workflow).toContain("node-version-file: .node-version");
  expect(workflow).not.toMatch(/continue-on-error:|always\(\)|failure\(\)|\|\|\s*true/);
});

it("keeps full PR/manual validation in the same required verify status", () => {
  requireFullChecks(workflow);
  expect([...workflow.matchAll(/^ {2}([\w-]+):\n(?= {4}(?:if:|runs-on:))/gm)].map(match => match[1])).toEqual(["verify", "publish"]);
  expect(jobs(workflow).verify).toContain("group: build-${{ github.event_name }}-${{ github.ref }}\n      cancel-in-progress: true");
});

it("checks PRs read-only and publishes only successful pushes at the latest main head", () => {
  requireTrustedPublication(workflow);
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow.split("jobs:\n")[0]).not.toMatch(/^concurrency:/m);
  for (const action of workflow.matchAll(/uses: ([^\s]+)(?:\s|$)/g)) expect(action[1]).toMatch(/@[\da-f]{40}$/);
});

it("skips docs-only main pushes while keeping code/infra and all PR checks selected", () => {
  const ignored = requireEventPolicy(workflow);
  const selected = (files: string[]) => files.some(file => !ignored.some(pattern => matchesGlob(file, pattern)));
  expect(selected(["README.md", "task.md", "gap.md", "AGENTS.md", "docs/DEPLOYMENT.md", "docs/design/example.html"])).toBe(false);
  for (const file of ["src/App.tsx", "src/style.css", "index.html", "public/favicon.svg", "scripts/build-pwa.mjs", "tests/browser/preset.spec.ts", "package.json", "package-lock.json", ".node-version", "vite.config.ts", ".github/workflows/pages.yml"]) {
    expect(selected(["README.md", file]), file).toBe(true);
  }
});

it("rejects conditional fast checks and upload-before-artifact regressions", () => {
  expect(() => requireFastChecks(workflow.replace("        run: npm run lint", "        if: false\n        run: npm run lint"))).toThrow();
  const artifact = commandStep(jobs(workflow).verify, "npm run check:artifact");
  const lateArtifact = workflow.replace(artifact, "").replace("\n  publish:\n", artifact + "\n  publish:\n");
  expect(() => requireFastChecks(lateArtifact)).toThrow();
});

it("rejects browser work on main pushes or a missing full-suite gate", () => {
  expect(() => requireFullChecks(workflow.replace(fullCondition, "${{ true }}"))).toThrow();
  expect(() => requireFullChecks(workflow.replace("        if: env.RUN_FULL_CHECKS == 'true'\n", ""))).toThrow();
});

it("rejects manual deployment, a moved head guard or missing artifact trust gating", () => {
  expect(() => requireTrustedPublication(workflow.replaceAll(trustedPush, "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"))).toThrow();
  expect(() => requireTrustedPublication(workflow.replace(`        if: ${trustedPush}\n`, ""))).toThrow();
  const movedGuard = workflow.replace("      - name: Check that this is still the main head", "      - name: Old guard") + "\n      - name: Check that this is still the main head\n";
  expect(() => requireTrustedPublication(movedGuard)).toThrow();
});

it("rejects ignored source paths or filtered PR statuses", () => {
  expect(() => requireEventPolicy(workflow.replace("      - 'docs/**'", "      - 'docs/**'\n      - 'src/**'"))).toThrow();
  expect(() => requireEventPolicy(workflow.replace("  pull_request:\n    branches: [main]\n", "  pull_request:\n    branches: [main]\n    paths-ignore: ['docs/**']\n"))).toThrow();
});
