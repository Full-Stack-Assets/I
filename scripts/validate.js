#!/usr/bin/env node
/**
 * Static validation for the ContractScan repo — run in CI and locally.
 * Syntax-checks standalone JS, the inline <script> blocks in each HTML file,
 * the deploy shell script, and parses every calibration answer-key JSON.
 *
 *   node scripts/validate.js
 */
const fs = require('fs');
const vm = require('vm');
const cp = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m, e) => { failures++; console.error('  ✗ ' + m + ' — ' + (e.message || e)); };

function checkJsFile(rel) {
  try { cp.execSync('node --check ' + JSON.stringify(path.join(root, rel)), { stdio: 'pipe' }); ok(rel); }
  catch (e) { bad(rel, new Error((e.stderr || e.stdout || e).toString().trim().split('\n').pop())); }
}
function checkInlineHtml(rel) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  if (!blocks.length) return ok(rel + ' (no inline JS)');
  blocks.forEach((b, i) => {
    try { new vm.Script(b); ok(rel + ' block ' + (i + 1)); }
    catch (e) { bad(rel + ' block ' + (i + 1), e); }
  });
}
function checkJson(rel) {
  try { JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); ok(rel); }
  catch (e) { bad(rel, e); }
}
function checkBash(rel) {
  try { cp.execSync('bash -n ' + JSON.stringify(path.join(root, rel)), { stdio: 'pipe' }); ok(rel); }
  catch (e) { bad(rel, new Error((e.stderr || e).toString().trim())); }
}

console.log('Standalone JS:');
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.mjs')).map(f => 'tests/' + f);
['backend/worker.js', 'calibration/run.js', 'scripts/validate.js', ...testFiles].forEach(checkJsFile);

console.log('HTML inline JS:');
['ContractScan.html', 'backend/stats.html', 'landing/index.html'].forEach(checkInlineHtml);

console.log('JSON:');
checkJson('package.json');
fs.readdirSync(path.join(root, 'calibration/expected'))
  .filter(f => f.endsWith('.json'))
  .forEach(f => checkJson('calibration/expected/' + f));

console.log('Shell scripts:');
checkBash('backend/deploy.sh');

console.log(failures ? ('\nFAILED: ' + failures + ' problem(s).') : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
