#!/usr/bin/env node
/**
 * ContractScan calibration harness.
 *
 * Runs each contract in calibration/contracts/ through the same prompt + JSON
 * schema the app uses, then checks the model's findings against the planted
 * red flags in calibration/expected/. Prints per-contract recall (did it catch
 * the known issues?) and lists any extra findings for you to judge for precision.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-...  node calibration/run.js
 *   MODEL=claude-sonnet-4-6  node calibration/run.js   # try a cheaper model
 *
 * This is the build plan's "test against 5–10 real contracts" gate. Drop your
 * own real (anonymized) contracts into contracts/ + an expected/<name>.json
 * answer key and re-run. The synthetic ones here are a starting point only.
 */
const fs = require('fs');
const path = require('path');

const MODEL = process.env.MODEL || 'claude-opus-4-8';
const KEY = process.env.ANTHROPIC_API_KEY;

const DIR = __dirname;
const NICHE_CONTEXT = {
  freelance: "The reader is a freelancer or small agency reviewing a contract a CLIENT has sent them. Prioritize risks that hurt the service provider: unlimited liability, IP assignment that's broader than the paid work, unpaid scope creep, payment terms (net-60/90, withheld final payment), kill fees, non-competes, indemnification, and one-sided termination.",
  saas_vendor: "The reader is a small business owner being asked to sign a SaaS or vendor agreement. Prioritize risks that hurt the customer: auto-renewal and cancellation traps, price-increase clauses, data ownership/portability, liability caps that are too low, uptime/SLA gaps, mandatory arbitration, and limitation-of-liability that excludes the vendor's own failures.",
  general: "Review the contract for the risks most likely to harm whoever is being asked to sign it."
};

function buildBody(niche, text) {
  const system =
    "You are ContractScan, an AI contract risk analyzer. You surface potential red-flag clauses for a "
    + "non-lawyer reader. You are informational only and explicitly NOT a lawyer and NOT giving legal advice. "
    + NICHE_CONTEXT[niche] + " "
    + "Be specific and calibrated — do not invent problems or inflate severity. Quote or reference the actual "
    + "section/clause number or heading from the document for each finding. Explain each risk in plain English "
    + "(no legalese) and give a concrete, practical recommendation. "
    + "If the text is not actually a contract, return an empty flagged_clauses array, risk_score 0, and say so in the summary.";
  return {
    model: MODEL, max_tokens: 8000, system,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Analyze this contract:\n\n' + text }] }],
    output_config: { format: { type: 'json_schema', schema: {
      type: 'object',
      properties: {
        risk_score: { type: 'integer' },
        risk_level: { type: 'string', enum: ['Low', 'Moderate', 'High', 'Critical'] },
        summary: { type: 'string' },
        flagged_clauses: { type: 'array', items: {
          type: 'object',
          properties: {
            title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'moderate', 'low'] },
            category: { type: 'string' }, section_reference: { type: 'string' },
            explanation: { type: 'string' }, recommendation: { type: 'string' }
          },
          required: ['title', 'severity', 'category', 'section_reference', 'explanation', 'recommendation'],
          additionalProperties: false
        }}
      },
      required: ['risk_score', 'risk_level', 'summary', 'flagged_clauses'],
      additionalProperties: false
    }}}
  };
}

async function analyze(niche, text) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(buildBody(niche, text))
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'text');
  return JSON.parse(block.text);
}

// A planted flag is "caught" if at least half its keywords appear across the
// model's findings (title + category + explanation + section, lowercased).
function isCaught(flag, findings) {
  const hay = findings.map(f =>
    [f.title, f.category, f.section_reference, f.explanation].join(' ').toLowerCase()).join(' || ');
  const hits = flag.keywords.filter(k => hay.includes(k.toLowerCase())).length;
  return hits >= Math.ceil(flag.keywords.length / 2);
}

async function main() {
  const expectedDir = path.join(DIR, 'expected');
  const files = fs.readdirSync(expectedDir).filter(f => f.endsWith('.json'));
  let totalPlanted = 0, totalCaught = 0;

  for (const ef of files) {
    const exp = JSON.parse(fs.readFileSync(path.join(expectedDir, ef), 'utf8'));
    const text = fs.readFileSync(path.join(DIR, 'contracts', exp.contract), 'utf8');
    console.log('\n=================================================================');
    console.log('Contract:', exp.contract, '· niche:', exp.niche, '· model:', MODEL);
    console.log('=================================================================');

    let result;
    try { result = await analyze(exp.niche, text); }
    catch (e) { console.error('  ERROR:', e.message); continue; }

    const findings = result.flagged_clauses || [];
    console.log('Risk score:', result.risk_score, '(' + result.risk_level + ')');
    console.log('Summary:', result.summary, '\n');

    let caught = 0;
    console.log('Recall against planted red flags:');
    for (const flag of exp.planted_red_flags) {
      const ok = isCaught(flag, findings);
      if (ok) caught++;
      console.log('  ' + (ok ? '✅' : '❌') + ' [' + flag.category + '] ' + flag.note);
    }
    totalPlanted += exp.planted_red_flags.length;
    totalCaught += caught;
    console.log('  → ' + caught + '/' + exp.planted_red_flags.length + ' caught');

    console.log('\nAll model findings (judge these for precision / false positives):');
    findings.forEach(f => console.log('  • [' + f.severity + '] ' + f.title + ' (' + f.section_reference + ')'));
  }

  console.log('\n=================================================================');
  console.log('OVERALL RECALL: ' + totalCaught + '/' + totalPlanted +
              ' (' + (totalPlanted ? Math.round(100 * totalCaught / totalPlanted) : 0) + '%)');
  console.log('Precision is a human call — review the "model findings" lists above for');
  console.log('anything invented, mis-scored, or alarmist before you charge money.');
  console.log('=================================================================');
}

module.exports = { isCaught, buildBody };

// Only hit the API when run directly (not when imported by tests).
if (require.main === module) {
  if (!KEY) { console.error('Set ANTHROPIC_API_KEY in the environment.'); process.exit(1); }
  main();
}
