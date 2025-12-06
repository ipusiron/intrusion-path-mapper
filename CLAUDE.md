# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Intrusion Path Mapper** is an educational web application for visualizing and simulating attack paths in simplified facility or network maps. It runs entirely client-side using D3.js for interactive graph visualization and implements Yen's K-shortest paths algorithm to find multiple intrusion routes with risk metrics.

## Architecture

### Core Technology Stack
- **Frontend Only**: Pure HTML/CSS/JavaScript (no build system, no backend)
- **D3.js v7**: Force-directed graph layout and visualization (loaded from CDN)
- **GitHub Pages Deployment**: https://ipusiron.github.io/intrusion-path-mapper/

### Data Flow
```
JSON Input → normalizeData() → buildAdjacency() → yenKShortestPaths()
           → calculatePathMetrics() → renderKPathsResult() → D3.js visualization
```

### Key Components in `js/main.js`

| Function | Lines | Purpose |
|----------|-------|---------|
| `normalizeData()` | 96-120 | Validates/cleans JSON input, clamps vuln/importance to 0-1 |
| `buildAdjacency()` | 283-301 | Converts graph to adjacency list with node penalty costs |
| `dijkstra()` | 303-338 | Single-source shortest path with edge exclusion support |
| `yenKShortestPaths()` | 341-412 | K-shortest paths algorithm |
| `calculatePathMetrics()` | 423-464 | Computes success probability and risk index |
| `drawGraph()` | 145-209 | D3.js force simulation setup |
| `animatePath()` | 678-792 | Step-by-step path animation |

### Data Model
```javascript
// Node
{id: string, label: string, type: string, vuln: 0-1, importance: 0-1, color?: string}

// Edge
{source: string, target: string, weight: number}

// Path cost = edge.weight + nodePenalty * (1 - targetNode.vuln)
// Success probability = product of all node vulns along path
// Risk index = successProb * maxImportance * (1 / sqrt(pathLength))
```

### Node Types and Colors
- `server`: #7cc7ff (blue)
- `device`: #ffd580 (orange)
- `account`: #c3a6ff (purple)
- `person`: #ffb3d9 (pink)
- `gateway`/`room`: #9affc3 (green)

## Development Commands

```bash
# View locally (static files, no build needed)
start index.html          # Windows
open index.html           # macOS

# Or with HTTP server for fetch() to work
python -m http.server 8000
```

## File Structure
```
├── index.html              # UI layout with CSP headers
├── js/main.js              # All application logic (~1050 lines)
├── css/style.css           # Dark theme, glassmorphism effects
└── sample-data/            # 4 preset scenarios (6-14 nodes each)
    ├── sample-facility.json
    ├── sample-office-network.json
    ├── sample-physical-intrusion.json
    └── sample-social-engineering.json
```

## Security Implementation

- **CSP**: Restricts scripts to self and d3js.org CDN
- **Input validation**: File size (5MB), node count (1000), edge count (5000), ID format (alphanumeric)
- **ID sanitization**: Regex `/^[a-zA-Z0-9_-]+$/` enforced

## Important Notes

- D3.js mutates edge objects, converting `source`/`target` from string IDs to object references. Code handles both formats.
- Force simulation performance degrades above ~200 nodes.
- This is an educational tool for defensive security analysis only.
