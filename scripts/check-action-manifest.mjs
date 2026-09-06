#!/usr/bin/env node
/**
 * Validate action.yml against the GitHub Marketplace listing rules we can
 * check locally (name, description length, runs.using, branding).
 * No YAML dependency: the manifest's top-level scalars are simple enough to
 * read with a small line scanner.
 * @see https://docs.github.com/actions/creating-actions/publishing-actions-in-github-marketplace
 */
import { readFileSync } from 'node:fs';

const MAX_DESC = 125;
const COLORS = new Set([
  'white',
  'yellow',
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'gray-dark',
]);
const raw = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const lines = raw.split('\n');

function topLevel(key) {
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i === -1) return undefined;
  const inline = lines[i].slice(key.length + 1).trim();
  if (inline && !inline.startsWith('>') && !inline.startsWith('|'))
    return inline.replace(/^"|"$/g, '');
  const block = [];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++)
    block.push(lines[j].trim());
  return block.join(' ');
}
function nested(parent, key) {
  const i = lines.findIndex((l) => l.startsWith(`${parent}:`));
  for (
    let j = i + 1;
    i !== -1 && j < lines.length && /^\s+\S/.test(lines[j]);
    j++
  ) {
    const m = lines[j].match(new RegExp(`^\\s+${key}:\\s*"?([^"]+?)"?\\s*$`));
    if (m) return m[1];
  }
  return undefined;
}

const errors = [];
const name = topLevel('name') ?? '';
const description = (topLevel('description') ?? '').replace(/\s+/g, ' ').trim();
if (name.length < 3) errors.push('name: required (>= 3 chars)');
if (description.length < 10) errors.push('description: required (>= 10 chars)');
if (description.length > MAX_DESC)
  errors.push(`description: ${description.length} chars (max ${MAX_DESC})`);
if (!nested('runs', 'using')) errors.push('runs.using: required');
const color = nested('branding', 'color');
if (color && !COLORS.has(color))
  errors.push(`branding.color "${color}" not allowed`);
if (!nested('branding', 'icon'))
  errors.push('branding.icon: required for Marketplace');

if (errors.length) {
  for (const e of errors) console.error(`action.yml: ${e}`);
  process.exit(1);
}
console.log(
  `action.yml OK — "${name}", description ${description.length}/${MAX_DESC} chars`
);
