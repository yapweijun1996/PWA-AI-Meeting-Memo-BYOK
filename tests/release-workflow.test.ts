/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// This contract intentionally targets this repository's small workflow. GitHub
// owns scheduling semantics; these checks protect its security-critical wiring.
const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

it("requires all verification before uploading or publishing, without failure overrides", () => {
  const verify = workflow.split("  verify:\n")[1]?.split("\n  publish:")[0];
  expect(verify).toBeDefined();
  const commands = ["npm ci", "npm run lint", "npm run test:unit", "npm run build",
    "npx playwright install --with-deps chromium webkit", "npm run test:e2e", "npm run test:pwa", "npm run check:artifact"];
  let previous = -1;
  for (const command of commands) {
    const position = verify!.indexOf(`run: ${command}`);
    expect(position, command).toBeGreaterThan(previous);
    previous = position;
  }
  expect(verify!.indexOf("uses: actions/upload-pages-artifact@")).toBeGreaterThan(previous);
  expect(workflow).toContain("    needs: verify");
  expect(workflow).not.toMatch(/continue-on-error:|always\(\)|failure\(\)|\|\|\s*true/);
});

it("checks pull requests with read permissions and restricts deployment to trusted main", () => {
  expect(workflow).toContain("  pull_request:\n    branches: [main]");
  expect(workflow).not.toContain("pull_request_target");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow.match(/github.event_name != 'pull_request' && github.ref == 'refs\/heads\/main'/g)).toHaveLength(2);
  const [verify, publish] = workflow.split("\n  publish:");
  expect(verify).not.toMatch(/pages: write|id-token: write/);
  expect(publish).toContain("pages: write");
  expect(publish).toContain("id-token: write");
  expect(publish).toContain("cancel-in-progress: false");
  expect(publish).toContain('if [ "$latest_sha" = "$GITHUB_SHA" ]');
  expect(verify).toContain("path: dist");
});
