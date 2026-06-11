---
name: Web Graph Wasm Agent Guidance
description: Guidance for the Next.js + React graph UI and Rust/WASM ForceAtlas2 simulation workflow.
applyTo:
  - 'web/src/**/*.{ts,tsx}'
  - 'wasm-sim/**/*.{rs,ts,tsx,js,mjs,cjs}'
  - 'web/package.json'
  - 'wasm-sim/Cargo.toml'
---

# Web Graph Wasm Agent Guidance

This repository is a Next.js/React graph application that pairs browser rendering with a Rust-compiled WebAssembly simulation layer.

Use this instruction file when working on the graph UI, node/link shaping, layout simulation, or the Rust/WASM boundary.

## Primary architecture

- The Rust/WASM layer owns heavy graph math, force/layout stepping, and any data shaping that must stay off the main thread.
- The React/Next.js layer owns rendering, interaction, search UI, selection state, persistence, and browser-specific concerns.
- Graphology is the shared graph structure contract between the browser state and the simulation layer.
- `react-force-graph-2d` is the browser renderer for the current implementation.

## Workflow expectations

- Prefer incremental, testable changes over broad rewrites.
- Keep graph generation, adjacency shaping, sizing, and tuning centralized in `web/src/lib/graph-data.ts`.
- Keep `web/src/components/GraphView.tsx` focused on rendering, layout configuration, and interaction behavior.
- Treat Rust/WASM changes as performance-sensitive and verify they do not block rendering or introduce avoidable memory churn.
- Prefer appending fetched nodes into the current graph state instead of replacing the full graph when adding search or expansion results.
- Rehydrate node positions from browser storage when available, but keep stale or expired layout state out of the active simulation.

## Rust/WASM guidance

- Keep the compiled Wasm module small, explicit, and predictable.
- Expose a narrow API for stepping layout, setting radii/positions, and retrieving node coordinates.
- Avoid unnecessary serialization between Rust and JavaScript.
- If a worker is introduced, ensure the main thread remains responsive and the worker boundary is documented in the code.
- Validate that any memory ownership or cleanup path is explicit so repeated graph rebuilds do not leak state.

## Layout and spacing guidance

- Tune ForceAtlas2 and renderer spacing through shared constants and shared graph data helpers.
- Prefer force tuning, collision spacing, and reheat/refocus behavior over hardcoded coordinates.
- When nodes are dense, give hubs and high-degree people visual emphasis so the graph reads as clusters rather than a flat pile.
- Keep links visually subordinate to nodes unless a task explicitly calls for stronger path emphasis.

## UI and interaction guidance

- Preserve the current client-rendered graph behavior unless a task explicitly requires a different architecture.
- Keep search, click-to-expand, hover, trace, and persistence flows additive and predictable.
- Avoid blocking the main thread with large initial graph loads when the same experience can be achieved by fetching on demand.
- When updating canvas rendering, ensure nodes remain visually on top of links and that inactive nodes are still legible.

## Data and state guidance

- Prefer typed graph node and link contracts over `any`.
- Keep node identity stable across graph merges so positions and selection can survive incremental updates.
- Persist user-visible layout state only when needed, and use explicit expiry semantics for stale browser state.
- Use browser storage for local session persistence only; do not introduce Redis or other server caches unless the task explicitly adds them.

## Validation

- Run focused error checks after edits that affect the graph UI or simulation boundary.
- Validate both TypeScript and runtime assumptions when changing state flow, layout rebuilds, or link/node rendering.
- If a change touches the Wasm build path, verify the package scripts and build outputs remain aligned with the current repo structure.

## What to avoid

- Do not introduce unrelated styling changes while working on layout or simulation behavior.
- Do not add a new graph architecture unless the task explicitly asks for it.
- Do not copy older Rust/Next.js patterns into this repo without checking the current project structure.
- Do not move graph generation logic into the component layer unless the task requires it.

## Good defaults for this repo

- Keep force-layout tuning data-driven.
- Keep browser rendering fast and side-effect light.
- Keep the Rust/WASM boundary narrow.
- Keep expansion behavior incremental.
- Keep storage-backed layout state resilient but optional.
