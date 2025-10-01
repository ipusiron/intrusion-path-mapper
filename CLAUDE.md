# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Intrusion Path Mapper** is an educational web application for visualizing and simulating attack paths in simplified facility or network maps. It runs entirely client-side using D3.js for interactive graph visualization and implements Dijkstra's algorithm for finding optimal intrusion paths based on vulnerability scores and node importance.

## Architecture

### Core Technology Stack
- **Frontend Only**: Pure HTML/CSS/JavaScript application with no backend
- **D3.js v7**: Force-directed graph layout and visualization (loaded from CDN)
- **Client-side Processing**: All data processing happens in the browser
- **GitHub Pages Deployment**: Static site hosted at https://ipusiron.github.io/intrusion-path-mapper/

### Key Components

**Main Application (`js/main.js`):**
- **Graph Visualization**: D3.js force simulation with draggable nodes (lines 104-169)
- **Dijkstra Implementation**: Custom shortest path algorithm considering node vulnerability and edge weights (lines 221-253)
- **Data Management**: JSON import/export functionality for graph data (lines 29-52, 294-310)
- **UI State Management**: Controls for selecting start/goal nodes and path analysis parameters

**Data Model:**
- **Nodes**: `{id, label, type, vuln (0-1), importance (0-1)}`
- **Edges**: `{source, target, weight}`
- **Path Cost Calculation**: Edge weight + node penalty based on vulnerability score

### File Structure
```
/
├── index.html           # Main HTML with UI layout
├── js/main.js          # Core application logic
├── css/style.css       # Dark theme styling
└── sample-data/
    └── sample-facility.json  # Example graph data
```

## Development Commands

Since this is a static client-side application, there are no build or test commands. Development workflow:

```bash
# View the application locally
# Option 1: Open index.html directly in browser
start index.html  # Windows
open index.html   # macOS

# Option 2: Serve with a local HTTP server (if available)
python -m http.server 8000  # Then visit http://localhost:8000
```

## Key Implementation Details

### Graph Rendering Flow
1. Data loaded from JSON or sample file (`normalizeData` function validates and cleans input)
2. D3 force simulation creates interactive layout with collision detection
3. Nodes colored by type (server, device, gateway, etc.)
4. Edge arrows indicate directionality

### Path Finding Algorithm
The Dijkstra implementation in `js/main.js:221-253` uses:
- Adjacency list representation built from nodes/edges
- Optional node penalty factor (configurable 0-2) that increases cost based on `(1 - vulnerability)`
- Returns both total cost and node sequence for the optimal path
- Highlights matching edges with CSS classes "highlight" and "pulse"

### JSON Format Requirements
```json
{
  "nodes": [
    {"id": "unique_id", "label": "Display Name", "type": "server|device|gateway", "vuln": 0.0-1.0, "importance": 0.0-1.0}
  ],
  "edges": [
    {"source": "node_id", "target": "node_id", "weight": numeric_cost}
  ],
  "meta": {"title": "Optional Graph Title"},
  "attack_goals": ["optional_default_targets"]
}
```

## Important Considerations

- **Security Note**: This is an educational tool for defensive security analysis only. The code simulates attack paths to help understand and improve security postures.
- **Browser Compatibility**: Requires modern browser with ES6+ support and SVG rendering
- **Performance**: Force simulation may slow with >100 nodes; consider disabling animation for large graphs
- **Data Privacy**: All processing is client-side; no data leaves the browser