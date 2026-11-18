import { readFileSync, writeFileSync } from 'node:fs';
import { parseFig } from 'openfig-core';
import { figmaNodeId, importFigNode } from '../src/figmaImport.ts';
import { walkPage } from '../src/model.ts';

const [filePath, linkOrId, outputPath] = process.argv.slice(2);
const id = figmaNodeId(linkOrId ?? '');
if (!filePath || !id) throw new Error('Usage: node --experimental-strip-types scripts/import-fig.mjs <file.fig> <figma-link-or-node-id> [output.json]');
const fig = parseFig(new Uint8Array(readFileSync(filePath)));
const result = importFigNode(fig, id);
if (outputPath) writeFileSync(outputPath, JSON.stringify(result.document, null, 2));
const imported = walkPage(result.document.pages[0]);
const { issues, ...counts } = result.report;
const byKind = Object.fromEntries([...new Set(issues.map((item) => item.kind))].map((kind) => [kind, issues.filter((item) => item.kind === kind).length]));
console.log(JSON.stringify({ sourceNodes: fig.nodes.length, importedNodes: imported.length, root: imported[0]?.name, ...counts, issuesByKind: byKind, assets: result.assets.length, outputPath: outputPath ?? null }, null, 2));
