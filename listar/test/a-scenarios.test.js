// Purpose: prove every acceptance scenario A01-A18 has an owning automated test or a named human gate.
// Responsibilities: scan real test titles for scenario tags, merge with the human-gate registry,
//   and fail when any scenario would be silently uncovered.
// Rationale: the epic's verification rule is "0 uncovered scenarios"; an aspirational table is not
//   evidence — the map is validated against executable test names in this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarioIds = Array.from({ length: 18 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`);

// Scenarios whose final proof is human/browser evidence; each names its gate ticket.
const HUMAN_GATES = new Map([
  ['A17', 'jams-0rt.1 (real first-use offline device check)'],
]);

function collectTags(dir) {
  const tags = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'browser') {
      for (const [k, v] of collectTags(full)) {
        if (!tags.has(k)) tags.set(k, []);
        tags.get(k).push(v);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.js')) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const line of source.split('\n')) {
      const titleMatch = line.match(/^\s*(?:test|describe)\(\s*'([^']+)'/u) ?? line.match(/^\s*(?:test|describe)\(\s*"([^"]+)"/u);
      if (!titleMatch) continue;
      for (const id of scenarioIds) {
        if (titleMatch[1].includes(id)) {
          if (!tags.has(id)) tags.set(id, []);
          tags.get(id).push(`${path.relative(root, full)}::${titleMatch[1]}`);
        }
      }
    }
  }
  return tags;
}

test('A01-A18: every scenario has automated owners or a named human gate (0 uncovered)', () => {
  const tags = collectTags(path.join(root, 'test'));
  const uncovered = [];
  const report = [];
  for (const id of scenarioIds) {
    const owners = tags.get(id) ?? [];
    const gate = HUMAN_GATES.get(id);
    if (!owners.length && !gate) uncovered.push(id);
    else report.push(`${id}: ${owners.length ? `${owners.length} automated` : ''}${owners.length && gate ? ' + ' : ''}${gate ?? ''}`);
  }
  assert.deepEqual(uncovered, [], `scenarios without automated tests or human gate: ${uncovered.join(', ')}`);
  // Tags must be real: a scenario referenced only by this map file would not count.
  assert.ok(tags.size >= scenarioIds.length - HUMAN_GATES.size);
});
