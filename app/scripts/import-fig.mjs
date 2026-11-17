import { readFileSync, writeFileSync } from 'node:fs';
import { parseFig } from 'openfig-core';
import { figmaNodeId, importFigNode } from '../src/figmaImport.ts';

const [filePath, linkOrId, outputPath] = process.argv.slice(2);
const id = figmaNodeId(linkOrId ?? '');
if (!filePath || !id) throw new Error('Usage: node --experimental-strip-types scripts/import-fig.mjs <file.fig> <figma-link-or-node-id> [output.json]');
const fig = parseFig(new Uint8Array(readFileSync(filePath)));
const result = importFigNode(fig, id);
if (outputPath) writeFileSync(outputPath, JSON.stringify(result.document, null, 2));
console.log(JSON.stringify({ sourceNodes: fig.nodes.length, importedNodes: result.document.nodes.length, root: result.document.nodes[0]?.name, ...result.report, outputPath: outputPath ?? null }, null, 2));
