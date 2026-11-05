import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// This summarizes reviewed labels. It does not infer factual support from text.
export function evaluateAnnotations(data) {
  const fail = (message) => { throw new Error(`Invalid evaluation: ${message}`); };
  const string = (value) => typeof value === "string" && value.trim().length > 0;
  const strings = (value) => Array.isArray(value) && value.every(string) && new Set(value).size === value.length;
  if (!data || data.schemaVersion !== 1 || !string(data.name) || !string(data.annotation) || !Array.isArray(data.cases) || !data.cases.length) fail("missing metadata or cases");
  const totals = { cases: 0, items: 0, incompleteItems: 0, claims: 0, assessed: 0, supported: 0, partial: 0, unsupported: 0, unknown: 0, sourceEligibleClaims: 0, unscoredCitationClaims: 0, missingCitationClaims: 0, requiredReferences: 0, missingReferences: 0, invalidCitationReferences: 0 };
  const caseIds = new Set();
  const cases = data.cases.map((entry) => {
    if (!entry || !string(entry.id) || caseIds.has(entry.id) || !string(entry.language) || !Array.isArray(entry.sources) || !entry.sources.length || !Array.isArray(entry.items) || !entry.items.length) fail("bad case or duplicate case ID");
    caseIds.add(entry.id);
    const sourceIds = new Set();
    for (const source of entry.sources) {
      if (!source || !string(source.id) || !string(source.text) || sourceIds.has(source.id)) fail(`bad source in ${entry.id}`);
      sourceIds.add(source.id);
    }
    const stats = { id: entry.id, items: 0, incompleteItems: 0, claims: 0, assessed: 0, supported: 0, partial: 0, unsupported: 0, unknown: 0, sourceEligibleClaims: 0, unscoredCitationClaims: 0, missingCitationClaims: 0, requiredReferences: 0, missingReferences: 0, invalidCitationReferences: 0 };
    for (const item of entry.items) {
      if (!item || !string(item.text) || !strings(item.citations) || !["complete", "partial"].includes(item.coverage) || !Array.isArray(item.claims) || !item.claims.length) fail(`bad item in ${entry.id}`);
      stats.items++;
      if (item.coverage === "partial") stats.incompleteItems++;
      stats.invalidCitationReferences += item.citations.filter((id) => !sourceIds.has(id)).length;
      const seen = new Set();
      for (const claim of item.claims) {
        if (!claim || !string(claim.text) || !item.text.includes(claim.text) || seen.has(claim.text) || !["supported", "partial", "unsupported", "unknown"].includes(claim.support) || !string(claim.reason)) fail(`bad claim in ${entry.id}`);
        seen.add(claim.text);
        if (claim.requiredSources !== null && (!strings(claim.requiredSources) || !claim.requiredSources.length || claim.requiredSources.some((id) => !sourceIds.has(id)))) fail(`bad required sources in ${entry.id}`);
        if (claim.support === "unknown" && claim.requiredSources !== null) fail(`unknown claim cannot declare required sources in ${entry.id}`);
        if (claim.support === "supported" && (!item.citations.some((id) => sourceIds.has(id)) || (claim.requiredSources !== null && claim.requiredSources.some((id) => !item.citations.includes(id))))) fail(`supported claim has missing required sources in ${entry.id}`);
        stats.claims++;
        stats[claim.support]++;
        if (claim.support !== "unknown") stats.assessed++;
        if (claim.requiredSources !== null) {
          stats.sourceEligibleClaims++;
          stats.requiredReferences += claim.requiredSources.length;
          const missing = claim.requiredSources.filter((id) => !item.citations.includes(id)).length;
          stats.missingReferences += missing;
          if (missing) stats.missingCitationClaims++;
        } else stats.unscoredCitationClaims++;
      }
    }
    totals.cases++;
    for (const key of Object.keys(stats)) if (key !== "id") totals[key] += stats[key];
    return stats;
  });
  const ratio = (n, d) => d ? n / d : null;
  return {
    name: data.name,
    annotation: data.annotation,
    totals,
    metrics: {
      unsupportedOrPartialClaimRate: ratio(totals.unsupported + totals.partial, totals.assessed),
      unsupportedClaimRate: ratio(totals.unsupported, totals.assessed),
      missingRequiredReferenceRate: ratio(totals.missingReferences, totals.requiredReferences),
      claimsMissingCitationRate: ratio(totals.missingCitationClaims, totals.sourceEligibleClaims),
    },
    annotationComplete: totals.incompleteItems === 0 && totals.unknown === 0,
    note: "Rates summarize supplied annotations, not automatic fact checking. Unknown claims and absent required-source labels are excluded from their denominators. Completeness does not establish comparability between runs.",
    cases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/evaluate-citation-annotations.mjs <annotated-json>");
    const data = JSON.parse(await readFile(process.argv[2], "utf8"));
    process.stdout.write(`${JSON.stringify(evaluateAnnotations(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Evaluation failed"}\n`);
    process.exitCode = 1;
  }
}
