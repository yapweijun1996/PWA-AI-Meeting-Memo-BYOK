import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
// @ts-expect-error The read-only Node CLI is an untyped JavaScript module.
import { evaluateAnnotations } from "../scripts/evaluate-citation-annotations.mjs";

const fixturePath = "tests/fixtures/evidence-eval.synthetic.json";
type EvalCase = { id: string; items: { citations: string[]; coverage: string; claims: { requiredSources: string[] | null }[] }[] };
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { cases: EvalCase[] };

describe("offline citation annotation metrics", () => {
  it("counts annotated unsupported claims and missing required sources separately", () => {
    const result = evaluateAnnotations(fixture);
    expect(result.totals).toMatchObject({ cases: 17, items: 17, claims: 18, assessed: 17, supported: 5, partial: 2, unsupported: 10, unknown: 1, sourceEligibleClaims: 8, unscoredCitationClaims: 10, missingCitationClaims: 3, requiredReferences: 9, missingReferences: 3, invalidCitationReferences: 1 });
    expect(result.metrics.unsupportedOrPartialClaimRate).toBe(12 / 17);
    expect(result.metrics.missingRequiredReferenceRate).toBe(3 / 9);
    expect(result.metrics.claimsMissingCitationRate).toBe(3 / 8);
    expect(result.annotationComplete).toBe(false);
    expect(result.cases.find((entry: { id: string }) => entry.id === "historical-revision").missingReferences).toBe(1);
  });

  it("reports unknown and incomplete annotations instead of treating them as passes", () => {
    const input = structuredClone(fixture);
    const entry = input.cases.find((value) => value.id === "uncertain-review");
    if (!entry) throw new Error("Missing uncertainty fixture");
    input.cases = [entry];
    entry.items[0].coverage = "partial";
    const result = evaluateAnnotations(input);
    expect(result.totals).toMatchObject({ unknown: 1, assessed: 0, incompleteItems: 1, unscoredCitationClaims: 1 });
    expect(result.metrics.unsupportedOrPartialClaimRate).toBeNull();
    expect(result.metrics.missingRequiredReferenceRate).toBeNull();
    expect(result.annotationComplete).toBe(false);
  });

  it("rejects inconsistent annotations but counts an invented citation as invalid", () => {
    const bad = structuredClone(fixture);
    bad.cases[0].items[0].claims[0].requiredSources = ["missing@1"];
    expect(() => evaluateAnnotations(bad)).toThrow("bad required sources");
    const invalid = structuredClone(fixture);
    invalid.cases[0].items[0].citations.push("not-a-source@1");
    expect(evaluateAnnotations(invalid).totals.invalidCitationReferences).toBe(2);
    const contradiction = structuredClone(fixture);
    contradiction.cases[0].items[0].citations = [];
    expect(() => evaluateAnnotations(contradiction)).toThrow("supported claim has missing required sources");
    const alternative = structuredClone(fixture);
    alternative.cases[0].items[0].claims[0].requiredSources = null;
    expect(evaluateAnnotations(alternative).totals.unscoredCitationClaims).toBe(11);
    alternative.cases[0].items[0].citations = [];
    expect(() => evaluateAnnotations(alternative)).toThrow("supported claim has missing required sources");
  });

  it("runs the local CLI and fails for missing input", () => {
    const output = JSON.parse(execFileSync(process.execPath, ["scripts/evaluate-citation-annotations.mjs", fixturePath], { encoding: "utf8" }));
    expect(output.totals.missingReferences).toBe(3);
    const failed = spawnSync(process.execPath, ["scripts/evaluate-citation-annotations.mjs"], { encoding: "utf8" });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("Usage:");
  });
});
