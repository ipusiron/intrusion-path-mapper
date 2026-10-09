# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Intrusion Path Mapper** is an educational web application for visualizing and simulating attack paths in simplified facility or network maps. It runs entirely client-side, draws the map with D3.js (self-hosted), and finds the top K paths with Yen's K-shortest-paths algorithm in two orders: highest success probability (edge weight `−ln(vuln)`) and lowest cost. The UI is available in Japanese and English.

## Architecture

### Core Technology Stack
- **Frontend only**: HTML/CSS/JavaScript with ES modules (no build system, no backend, no npm dependencies)
- **D3.js 7.9.0**: self-hosted in `vendor/d3/` (ISC License). Used for d3-force, d3-drag and d3-zoom
- **GitHub Pages**: https://ipusiron.github.io/intrusion-path-mapper/ (served from `main` /)

### Modules
| File | Role |
|------|------|
| `js/ipm-core.js` | Pure logic, no DOM: validation/normalization (`normalizeGraph`, `parseGraphText`), export (`serializeGraph`, `exportFileName`), adjacency (`buildAdjacency`), binary-heap `dijkstra`, Yen's `kShortestPaths`, `findPaths`, `pathMetrics`, `commonNodes` (nodes on all paths shown), `targetRisks` (one Dijkstra on `−ln(vuln)` for every node, sorted by risk), `blockImpact` (top success probability after blocking each node of the top path), `minVertexCut` (node-split max flow, Menger), edge editing (`edgesOf`, `addEdge` with `bidirectional`, `updateEdgeWeight`, `removeEdge`; they return new arrays), formatting (`formatPercent`, `formatScore`, `formatCost`), `defaultEndpoints`, `resolveLocale` |
| `js/ipm-messages.js` | UI strings `MESSAGES.ja` / `MESSAGES.en` (same keys). Static HTML uses `data-i18n`, `data-i18n-aria`, `data-i18n-title` |
| `js/main.js` | DOM and D3 only: drawing, zoom/fit, results list, animation, editing dialogs, import/export, language switch |

### Data Flow
```
JSON → parseGraphText()/normalizeGraph() → data (ids as strings)
     → findPaths(data, start, goal, {mode, k, nodePenalty}) → [{path, successProb, risk, hops, cost}]
     → renderKPathsResult() / highlightPath() / animatePath()
```

### Model
```javascript
// Node: {id, label, label_en?, type, vuln: 0-1, importance: 0-1, color?: "#rrggbb"}
// Edge: {source: id, target: id, weight >= 0}   (directed)
// vuln = probability that an attacker at the previous node gets through this node
// successProb = product of vuln over the path, excluding the start node
// risk = successProb * importance(target)
// prob order: edge weight = -ln(vuln(next));  cost order: weight + nodePenalty * (1 - vuln(next))
```

- D3 replaces `source`/`target` with node objects, so `drawGraph()` passes **copies** of the edges to D3. `data.edges` always keeps string ids.
- A new map pre-runs 300 ticks and calls `fitView()`; edits keep the current layout and zoom.
- Any change to the map calls `resetResults()` (old path indices do not match the new map).
- Switching the language re-renders from the stored results; it never recalculates.
- `importance` means the damage if the node is taken over; passages (doors, windows) should be low, or they dominate the risk-by-target list.
- Edges are clickable through transparent wide `.link-hit` lines; keyboard users edit edges from the lists in the node details.
- The what-if slider changes `node.vuln` in place and calls `rerunSearch()` with `lastSearch`; `whatifOriginals` keeps the values for "Reset to" and is cleared on edits and on a new map.

## Development Commands

```bash
npm test                          # node --test (Node 22+, no dependencies)
python -m http.server 8000        # then open http://localhost:8000/ (file:// does not work: ES modules)
```

## Tests (`test/`)
- `core.test.js`: validation, round trips, Yen vs brute-force enumeration of all simple paths (both orders), target risks vs brute force, common nodes, block impact vs brute force, minimality of the vertex cut, edge editing, metrics, formatting
- `html.test.js`: CSP (`'self'` only), no inline handlers or style attributes, ids, `<dialog>`, D3 SHA-256 and license, legend colors
- `contrast.test.js`: WCAG contrast of the CSS variables (4.5:1)
- `i18n.test.js`: ja/en keys and placeholders, no Japanese in English strings, no Japanese literals in `main.js`, sample `label_en`
- `format.test.js`: line length, line counts, control characters, core has no DOM access
- `readme.test.js`: YAML metadata structure, ja/en heading table, numbers recomputed with the core, directory tree covers `git ls-files`

## Security Implementation
- meta CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; ...` (no `'unsafe-inline'`). GitHub Pages cannot send headers, so `frame-ancestors` is not available.
- All imported strings are rendered with `textContent`; IDs must match `/^[A-Za-z0-9_-]{1,100}$/`.
- Limits: 5 MB file, 1,000 nodes, 5,000 edges, 200-character labels.

## Important Notes
- Keep the README tables in sync: `readme.test.js` recomputes them with `ipm-core.js`.
- Do not edit `vendor/d3/` (its SHA-256 is tested; `.gitattributes` keeps line endings unchanged).
- This is an educational tool for defensive security analysis.
