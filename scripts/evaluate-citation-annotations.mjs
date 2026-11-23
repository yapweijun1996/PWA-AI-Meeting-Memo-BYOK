import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const fail = (message) => { throw new Error(`Invalid evaluation: ${message}`); };
const string = (value) => typeof value === "string" && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(string) && new Set(value).size === value.length;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

function requiredSourcesForClaim(claim, citations, sourceIds, caseId, benchmark) {
  const declared = benchmark ? claim.requiredSourceAlternatives : claim.requiredSources;
  if (declared === null) return null;
  const alternatives = benchmark ? declared : [declared];
  if (!Array.isArray(alternatives) || !alternatives.length ||
    alternatives.some((set) => !strings(set) || !set.length || set.some((id) => !sourceIds.has(id))))
    fail(`bad required sources in ${caseId}`);
  // One annotated set is sufficient. Pick the nearest set without rewarding an
  // incomplete subset over a complete alternative.
  return alternatives.map((set) => ({ set, missing: set.filter((id) => !citations.includes(id)).length }))
    .sort((left, right) => left.missing - right.missing || left.set.length - right.set.length)[0];
}

function goldFactsForCase(entry) {
  if (!Array.isArray(entry.goldFacts)) fail(`missing gold facts in ${entry.id}`);
  const facts = new Map();
  for (const fact of entry.goldFacts) {
    if (!fact || !string(fact.id) || facts.has(fact.id) || !string(fact.text) || typeof fact.critical !== "boolean")
      fail(`bad gold fact in ${entry.id}`);
    facts.set(fact.id, fact);
  }
  return facts;
}

function factRecall(facts, captured, annotationComplete) {
  const critical = [...facts.values()].filter((fact) => fact.critical);
  const criticalCaptured = critical.filter((fact) => captured.has(fact.id)).length;
  const remaining = [...facts.keys()].filter((id) => !captured.has(id));
  return {
    expected: facts.size,
    captured: captured.size,
    criticalExpected: critical.length,
    criticalCaptured,
    missed: annotationComplete ? remaining : [],
    unresolved: annotationComplete ? [] : remaining,
    recall: ratio(captured.size, facts.size),
    criticalRecall: ratio(criticalCaptured, critical.length),
  };
}

// This summarizes reviewed labels. It does not infer factual support from text.
export function evaluateAnnotations(data) {
  if (!data || ![1, 2].includes(data.schemaVersion) || !string(data.name) || !string(data.annotation) || !Array.isArray(data.cases) || !data.cases.length) fail("missing metadata or cases");
  const benchmark = data.schemaVersion === 2;
  const totals = { cases: 0, items: 0, incompleteItems: 0, claims: 0, assessed: 0, supported: 0, partial: 0, unsupported: 0, unknown: 0, sourceEligibleClaims: 0, unscoredCitationClaims: 0, missingCitationClaims: 0, requiredReferences: 0, missingReferences: 0, invalidCitationReferences: 0 };
  const caseIds = new Set();
  const cases = data.cases.map((entry) => {
    if (!entry || !string(entry.id) || caseIds.has(entry.id) || !string(entry.language) || !Array.isArray(entry.sources) || !entry.sources.length || !Array.isArray(entry.items) || (!benchmark && !entry.items.length)) fail("bad case or duplicate case ID");
    caseIds.add(entry.id);
    const sourceIds = new Set();
    for (const source of entry.sources) {
      if (!source || !string(source.id) || !string(source.text) || sourceIds.has(source.id)) fail(`bad source in ${entry.id}`);
      sourceIds.add(source.id);
    }
    const goldFacts = benchmark ? goldFactsForCase(entry) : new Map();
    const captured = new Set();
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
        const sources = requiredSourcesForClaim(claim, item.citations, sourceIds, entry.id, benchmark);
        if (claim.support === "unknown" && sources) fail(`unknown claim cannot declare required sources in ${entry.id}`);
        if (claim.support === "supported" && (!item.citations.some((id) => sourceIds.has(id)) || sources?.missing)) fail(`supported claim has missing required sources in ${entry.id}`);
        if (benchmark && claim.goldFactId !== null) {
          if (claim.support !== "supported" || !sources || !goldFacts.has(claim.goldFactId))
            fail(`bad captured gold fact in ${entry.id}`);
          captured.add(claim.goldFactId);
        }
        stats.claims++;
        stats[claim.support]++;
        if (claim.support !== "unknown") stats.assessed++;
        if (sources) {
          stats.sourceEligibleClaims++;
          stats.requiredReferences += sources.set.length;
          stats.missingReferences += sources.missing;
          if (sources.missing) stats.missingCitationClaims++;
        } else stats.unscoredCitationClaims++;
      }
    }
    totals.cases++;
    for (const key of Object.keys(stats)) if (key !== "id") totals[key] += stats[key];
    return benchmark ? {
      ...stats,
      language: entry.language,
      facts: factRecall(goldFacts, captured, stats.incompleteItems === 0 && stats.unknown === 0),
    } : stats;
  });
  const sumFacts = (select) => cases.reduce((total, entry) => total + select(entry.facts), 0);
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
    ...(benchmark ? {
      facts: {
        expected: sumFacts((facts) => facts.expected),
        captured: sumFacts((facts) => facts.captured),
        missed: sumFacts((facts) => facts.missed.length),
        unresolved: sumFacts((facts) => facts.unresolved.length),
        criticalExpected: sumFacts((facts) => facts.criticalExpected),
        criticalCaptured: sumFacts((facts) => facts.criticalCaptured),
        macroRecall: ratio(sumFacts((facts) => facts.recall ?? 0), cases.filter((entry) => entry.facts.recall !== null).length),
        criticalRecall: ratio(sumFacts((facts) => facts.criticalCaptured), sumFacts((facts) => facts.criticalExpected)),
      },
    } : {}),
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
