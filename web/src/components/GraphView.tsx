'use client';

import React, { useCallback, useEffect, FormEvent, useMemo, useRef, useState } from 'react';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import Graph from 'graphology';

import {
	createGraphDataset,
	expandSelection,
	getDisplayedStats,
	getEndpointId,
	getKindLabel,
	getLinkKey,
	projectGraphData,
	isNodeInactive,
	createAdjacencyMap,
	createLinksByNodeId,
	type BadgeTone,
	type GraphDataset,
	type GraphLink,
	type GraphNode,
} from '@/lib/graph-data';

import { drawFirmNode, drawPersonNode } from '@/lib/geometry';

// --- Constants & Config ---
const CLICK_REVEAL_HOPS = 3;
const VISIBLE_NODE_IDS_STORAGE_KEY = 'graph-visible-node-ids-startup-leaders-v1';
const NODE_POSITION_STORAGE_KEY = 'graph-node-positions-v1';
const NODE_POSITION_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 5;
// react-force-graph-2d radius = sqrt(nodeVal × NODE_REL_SIZE). Setting this to 100
// (vs default 4) makes the smallest node 5× bigger while preserving relative scale.
const NODE_REL_SIZE = 100;
const SIM_LINK_DISTANCE = 880;
const SIM_CHARGE_STRENGTH = -720;
const DRAG_CHILD_OFFSET_SCALE = 0.88;

type InitialGraphState = {
	dataset: GraphDataset;
	visibleNodeIds: Set<string>;
	selectedNodeId: string | null;
	visitedNodeIds: Set<string>;
	needsInitialLoad: boolean;
	storedPositions: Map<string, { x: number; y: number }>;
};

function loadStoredNodePositions(): Map<string, { x: number; y: number }> {
	if (typeof window === 'undefined') return new Map();
	try {
		const raw = window.localStorage.getItem(NODE_POSITION_STORAGE_KEY);
		if (!raw) return new Map();
		const parsed = JSON.parse(raw) as { savedAt?: string; positions?: Record<string, { x: number; y: number }> };
		const savedAt = parsed?.savedAt ? Date.parse(parsed.savedAt) : Number.NaN;
		if (!Number.isFinite(savedAt) || Date.now() - savedAt > NODE_POSITION_TTL_MS) {
			window.localStorage.removeItem(NODE_POSITION_STORAGE_KEY);
			return new Map();
		}
		return new Map(Object.entries(parsed.positions ?? {}).filter(([, pos]) => Number.isFinite(pos?.x) && Number.isFinite(pos?.y)));
	} catch {
		return new Map();
	}
}

function computeInitialState(): InitialGraphState {
	const dataset = createGraphDataset();
	if (typeof window === 'undefined') {
		return { dataset, visibleNodeIds: new Set(), selectedNodeId: null, visitedNodeIds: new Set(), needsInitialLoad: false, storedPositions: new Map() };
	}
	const storedPositions = loadStoredNodePositions();
	const pathMatch = window.location.pathname.match(/^\/node\/([^/]+)$/);
	if (pathMatch) {
		const nodeId = pathMatch[1];
		if (dataset.nodeById.has(nodeId)) {
			return { dataset, visibleNodeIds: expandSelection(dataset, nodeId), selectedNodeId: nodeId, visitedNodeIds: new Set(), needsInitialLoad: false, storedPositions };
		}
	}
	try {
		const raw = window.localStorage.getItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		if (raw) {
			const stored = JSON.parse(raw) as { nodeIds?: string[]; selectedNodeId?: string; visitedNodeIds?: string[] };
			if (stored?.nodeIds?.length) {
				return {
					dataset,
					visibleNodeIds: new Set(stored.nodeIds),
					selectedNodeId: stored.selectedNodeId ?? null,
					visitedNodeIds: new Set(stored.visitedNodeIds ?? []),
					needsInitialLoad: false,
					storedPositions,
				};
			}
		}
	} catch {}
	return { dataset, visibleNodeIds: new Set(), selectedNodeId: null, visitedNodeIds: new Set(), needsInitialLoad: false, storedPositions };
}

export default function GraphView() {
	// Compute initial state once via lazy useState (avoids ref-during-render)
	const [{ dataset: initDataset, visibleNodeIds: initVisible, selectedNodeId: initSelected, visitedNodeIds: initVisited, needsInitialLoad, storedPositions }] =
		useState(computeInitialState);

	const [dataset, setDataset] = useState<GraphDataset>(() => initDataset);
	const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
	const [ForceGraph2D, setForceGraph2D] = useState<typeof import('react-force-graph-2d').default | null>(null);

	const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => initVisible);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => initSelected);
	const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(() => initVisited);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [statusMessage, setStatusMessage] = useState(() =>
		needsInitialLoad ? 'Search to load nodes into the graph.' : 'Ready. Search a name like "thornton" to display the graph.',
	);
	const [showInfo, setShowInfo] = useState(true);
	const [showLog, setShowLog] = useState(false);
	const [traceMode, setTraceMode] = useState(false);
	const [showLegend, setShowLegend] = useState(false);
	const [menuOpen, setMenuOpen] = useState(true);
	const [panelPinned, setPanelPinned] = useState(true);

	const dragChildOffsetsRef = useRef<{ node: GraphNode & NodeObject; dx: number; dy: number }[]>([]);
	const hasAppliedStoredPositionsRef = useRef(false);
	const searchStreamTimeoutsRef = useRef<number[]>([]);

	// WASM force simulation refs
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const wasmSimRef = useRef<any>(undefined);
	const wasmLoadedRef = useRef(false);
	const nodeIndexMapRef = useRef<Map<string, number>>(new Map());

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const activeNodeId = hoveredNodeId ?? selectedNodeId;
	const activeNode = activeNodeId ? (dataset.nodeById.get(activeNodeId) ?? null) : null;
	const displayedStats = useMemo(() => getDisplayedStats(visibleGraph), [visibleGraph]);

	const highlightedNodeIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		if (traceMode && selectedNodeId) return expandSelection(dataset, selectedNodeId);
		return new Set([activeNodeId]);
	}, [activeNodeId, dataset, selectedNodeId, traceMode]);

	// Render layer: 0 = inactive (drawn first/back), 1 = regular, 2 = hub, 3 = selected/highlighted (drawn last/front)
	const getNodeRenderLayer = useCallback(
		(node: GraphNode): number => {
			if (isNodeInactive(node)) return 0;
			if (node.id === selectedNodeId || highlightedNodeIds.has(node.id)) return 3;
			if (node.isHub) return 2;
			return 1;
		},
		[selectedNodeId, highlightedNodeIds],
	);

	// Sorted copy so canvas draws back→front: inactive first, hubs/selected last.
	// Same node object references are preserved so FA2 positions are not lost.
	const layeredGraph = useMemo(
		() => ({
			...visibleGraph,
			nodes: [...visibleGraph.nodes].sort((a, b) => getNodeRenderLayer(a) - getNodeRenderLayer(b)),
		}),
		[visibleGraph, getNodeRenderLayer],
	);

	const highlightedLinkIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		return new Set(
			visibleGraph.links
				.filter((link) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					if (traceMode) {
						return highlightedNodeIds.has(source) && highlightedNodeIds.has(target);
					}
					return source === activeNodeId || target === activeNodeId;
				})
				.map((link) => getLinkKey(link)),
		);
	}, [activeNodeId, highlightedNodeIds, traceMode, visibleGraph.links]);

	type WasmBindgenModule = {
		GraphSimulation: new () => {
			free(): void;
			add_nodes_with_positions(p: Float32Array): void;
			add_edge(s: number, t: number): void;
			set_radii(r: Float32Array): void;
			build(ld: number, cs: number): void;
			tick(n: number): void;
			step(): void;
			get_positions(): Float32Array;
			reheat(): void;
		};
	};

	const softenHoverColor = useCallback((color: string, alpha = 0.3): string => {
		if (color.startsWith('rgba(')) {
			return color.replace(/rgba\(([^)]+,\s*)[0-9.]+\)/, `rgba($1${alpha})`);
		}
		if (color.startsWith('rgb(')) {
			return color.replace(/^rgb\(([^)]+)\)$/, `rgba($1, ${alpha})`);
		}
		if (color.startsWith('#')) {
			return color;
		}
		return color;
	}, []);

	// Load the 2D renderer dynamically (avoids SSR)
	useEffect(() => {
		import('react-force-graph-2d').then((m) => setForceGraph2D(() => m.default));
	}, []);

	// Disable all d3 internal forces — WASM sim drives layout via onEngineTick
	useEffect(() => {
		if (!graphRef.current) return;
		const fg = graphRef.current;
		fg.d3Force('charge', null);
		fg.d3Force('link', null);
		fg.d3Force('center', null);
		fg.d3Force('collide', null);
	}, [ForceGraph2D]);

	// Load wasm_sim.js once on mount
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const script = document.createElement('script');
		script.src = '/wasm-sim/wasm_sim.js';
		script.onload = () => {
			wasmLoadedRef.current = true;
		};
		document.head.appendChild(script);
		return () => {
			try {
				document.head.removeChild(script);
			} catch {}
		};
	}, []);

	// Build (or rebuild) the WASM sim whenever the graph data changes
	useEffect(() => {
		if (dataset.graphData.nodes.length === 0) return;
		let cancelled = false;

		const buildSim = async () => {
			// Wait for wasm_sim.js to finish loading
			if (!wasmLoadedRef.current) {
				await new Promise<void>((resolve) => {
					const interval = setInterval(() => {
						if (wasmLoadedRef.current) {
							clearInterval(interval);
							resolve();
						}
					}, 50);
				});
			}
			if (cancelled) return;

			const globalScope = globalThis as typeof globalThis & { wasm_bindgen?: unknown };
			const wbg = (() => {
				try {
					return Function('return wasm_bindgen')() as unknown;
				} catch {
					return globalScope.wasm_bindgen;
				}
			})();
			if (!wbg) throw new Error('wasm_bindgen is not available');
			const wasmModule =
				typeof wbg === 'function' ? (await (wbg as (opts: { module_or_path: string }) => Promise<unknown>)({ module_or_path: '/wasm-sim/wasm_sim_bg.wasm' }), wbg) : wbg;
			if (cancelled) return;

			// Free the previous simulation
			wasmSimRef.current?.free?.();

			const nodes = dataset.graphData.nodes;
			const indexMap = new Map<string, number>();
			nodes.forEach((n, i) => indexMap.set(n.id, i));
			nodeIndexMapRef.current = indexMap;

			const sim: {
				add_nodes_with_positions(p: Float32Array): void;
				add_edge(s: number, t: number): void;
				set_radii(r: Float32Array): void;
				build(ld: number, cs: number): void;
				tick(n: number): void;
				step(): void;
				get_positions(): Float32Array;
				reheat(): void;
				free(): void;
			} = new (wasmModule as WasmBindgenModule).GraphSimulation();

			// Seed positions from current node.x/y (preserves layout on graph expansion)
			const initPos = new Float32Array(nodes.length * 2);
			nodes.forEach((n, i) => {
				initPos[i * 2] = n.x !== undefined && n.x !== null && isFinite(n.x as number) ? (n.x as number) : (Math.random() - 0.5) * 3000;
				initPos[i * 2 + 1] = n.y !== undefined && n.y !== null && isFinite(n.y as number) ? (n.y as number) : (Math.random() - 0.5) * 3000;
			});
			sim.add_nodes_with_positions(initPos);

			// Per-node collision radii matching visual pixel radii
			const radii = new Float32Array(nodes.length);
			nodes.forEach((n, i) => {
				radii[i] = Math.sqrt((n.size ?? 5) * NODE_REL_SIZE);
			});
			sim.set_radii(radii);

			// Edges
			for (const link of dataset.graphData.links) {
				const srcId = getEndpointId(link.source);
				const tgtId = getEndpointId(link.target);
				const si = indexMap.get(srcId);
				const ti = indexMap.get(tgtId);
				if (si !== undefined && ti !== undefined) sim.add_edge(si, ti);
			}

			// Build forces and warm up
			sim.build(SIM_LINK_DISTANCE, SIM_CHARGE_STRENGTH);
			sim.tick(30);

			if (cancelled) {
				sim.free();
				return;
			}
			wasmSimRef.current = sim;
		};

		buildSim().catch(console.error);

		return () => {
			cancelled = true;
			wasmSimRef.current?.free?.();
			wasmSimRef.current = undefined;
		};
	}, [dataset]);

	useEffect(() => {
		if (hasAppliedStoredPositionsRef.current) return;
		hasAppliedStoredPositionsRef.current = true;
		for (const [nodeId, position] of storedPositions) {
			const node = dataset.nodeById.get(nodeId);
			if (!node) continue;
			node.x = position.x;
			node.y = position.y;
		}
	}, [dataset, storedPositions]);

	const mergeGraphData = useCallback(
		(incoming: { nodes: GraphNode[]; links: GraphLink[] }) => {
			setDataset((currentDataset) => {
				const nodeMap = new Map(currentDataset.graphData.nodes.map((node) => [node.id, node]));
				for (const node of incoming.nodes) {
					const existing = nodeMap.get(node.id);
					if (existing) {
						nodeMap.set(node.id, { ...existing, ...node });
					} else {
						nodeMap.set(node.id, node);
					}
				}
				const mergedNodes = Array.from(nodeMap.values());
				const linkMap = new Map<string, GraphLink>();
				const addLink = (link: GraphLink) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					const key = source < target ? `${source}:${target}` : `${target}:${source}`;
					if (!linkMap.has(key)) linkMap.set(key, link);
				};
				for (const link of currentDataset.graphData.links) addLink(link);
				for (const link of incoming.links) addLink(link);
				const mergedLinks = Array.from(linkMap.values());

				// Rebuild Graphology graph for adjacency/data lookups (no FA2-specific attributes)
				const graph = new Graph({ multi: false, type: 'undirected', allowSelfLoops: false });
				const spread = 3000;
				for (const node of mergedNodes) {
					const stored = storedPositions.get(node.id);
					const prevX = currentDataset.graph.hasNode(node.id) ? (currentDataset.graph.getNodeAttribute(node.id, 'x') as number | undefined) : undefined;
					const prevY = currentDataset.graph.hasNode(node.id) ? (currentDataset.graph.getNodeAttribute(node.id, 'y') as number | undefined) : undefined;
					graph.addNode(node.id, {
						...node,
						x: stored?.x ?? prevX ?? (Math.random() - 0.5) * spread,
						y: stored?.y ?? prevY ?? (Math.random() - 0.5) * spread,
					});
				}
				for (const link of mergedLinks) {
					const src = getEndpointId(link.source);
					const tgt = getEndpointId(link.target);
					if (src !== tgt && graph.hasNode(src) && graph.hasNode(tgt) && !graph.hasEdge(src, tgt)) {
						graph.addEdge(src, tgt, link);
					}
				}

				return {
					...currentDataset,
					graph,
					graphData: { nodes: mergedNodes, links: mergedLinks },
					adjacency: createAdjacencyMap(mergedLinks),
					linksByNodeId: createLinksByNodeId(mergedLinks),
					nodeById: new Map(mergedNodes.map((node) => [node.id, node])),
				};
			});
		},
		[storedPositions],
	);

	const clearSearchStreamTimers = useCallback(() => {
		for (const timeoutId of searchStreamTimeoutsRef.current) {
			window.clearTimeout(timeoutId);
		}
		searchStreamTimeoutsRef.current = [];
	}, []);

	const reheatLayout = useCallback(() => {
		wasmSimRef.current?.reheat?.();
		graphRef.current?.d3ReheatSimulation?.();
	}, []);

	const streamSearchResults = useCallback(
		(result: { visibleNodes: GraphNode[]; visibleLinks: GraphLink[]; visibleNodeIds: string[]; primaryMatchId?: string; message?: string }, query: string) => {
			clearSearchStreamTimers();
			const nodeBatchSize = result.visibleNodes.length > 60 ? 12 : 8;
			let nodeCursor = 0;
			let emittedNodeIds = new Set<string>();

			const emitNextBatch = () => {
				const nextNodes = result.visibleNodes.slice(nodeCursor, nodeCursor + nodeBatchSize);
				const nextNodeIds = new Set(nextNodes.map((node) => node.id));
				const cumulativeNodeIds = new Set([...emittedNodeIds, ...nextNodeIds]);
				const nextLinks = result.visibleLinks.filter((link) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					return cumulativeNodeIds.has(source) && cumulativeNodeIds.has(target);
				});

				if (nextNodes.length === 0 && nextLinks.length === 0) return;

				mergeGraphData({ nodes: nextNodes, links: nextLinks });
				setVisibleNodeIds((prev) => {
					const next = new Set(prev);
					for (const id of result.visibleNodeIds) next.add(id);
					return next;
				});
				setStatusMessage(nodeCursor + nextNodes.length >= result.visibleNodes.length ? (result.message ?? `Loaded results for “${query}”.`) : `Streaming results for “${query}”…`);
				reheatLayout();

				emittedNodeIds = new Set([...emittedNodeIds, ...nextNodeIds]);
				nodeCursor += nextNodes.length;

				if (nodeCursor < result.visibleNodes.length) {
					const timeoutId = window.setTimeout(emitNextBatch, 120);
					searchStreamTimeoutsRef.current.push(timeoutId);
				}
			};

			emitNextBatch();
		},
		[clearSearchStreamTimers, mergeGraphData, reheatLayout],
	);

	const persistNodePositions = useCallback(() => {
		if (typeof window === 'undefined') return;
		try {
			const positions: Record<string, { x: number; y: number }> = {};
			for (const node of visibleGraph.nodes) {
				if (node.x === undefined || node.y === undefined) continue;
				positions[node.id] = { x: node.x, y: node.y };
			}
			window.localStorage.setItem(
				NODE_POSITION_STORAGE_KEY,
				JSON.stringify({ savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + NODE_POSITION_TTL_MS).toISOString(), positions }),
			);
		} catch {}
	}, [visibleGraph.nodes]);

	// Persist state to localStorage
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(
				VISIBLE_NODE_IDS_STORAGE_KEY,
				JSON.stringify({
					nodeIds: Array.from(visibleNodeIds),
					selectedNodeId: selectedNodeId ?? null,
					visitedNodeIds: Array.from(visitedNodeIds),
					savedAt: new Date().toISOString(),
				}),
			);
		} catch {}
	}, [visibleNodeIds, selectedNodeId, visitedNodeIds]);

	const handleNodeClick = useCallback(
		(node: GraphNode | undefined) => {
			if (!node) return;

			const revealConnectedNodes = (startIds: string[], hops: number): Set<string> => {
				const adj = dataset.adjacency;
				let currentLayer = [...startIds];
				const visited = new Set(startIds);
				for (let i = 0; i < hops; i++) {
					const nextLayer: string[] = [];
					for (const id of currentLayer) {
						for (const neighbor of adj.get(id) ?? []) {
							if (!visited.has(neighbor)) {
								visited.add(neighbor);
								nextLayer.push(neighbor);
							}
						}
					}
					currentLayer = nextLayer;
				}
				return visited;
			};

			// Pin selected node (skip WASM lerp for this node while pinned)
			if (selectedNodeId) {
				const prev = dataset.nodeById.get(selectedNodeId);
				if (prev) {
					prev.fx = undefined;
					prev.fy = undefined;
				}
			}
			node.fx = node.x;
			node.fy = node.y;

			setSelectedNodeId(node.id);
			setVisitedNodeIds((prev) => new Set(prev).add(node.id));
			setMenuOpen(true);
			setShowInfo(true);

			const revealDepth = node.kind === 'individual' ? CLICK_REVEAL_HOPS : 2;
			const revealed = revealConnectedNodes([node.id], revealDepth);
			setVisibleNodeIds((prev) => {
				const next = new Set(prev);
				revealed.forEach((id) => next.add(id));
				return next;
			});
		},
		[dataset, selectedNodeId],
	);

	const handleBackgroundClick = useCallback(() => {
		if (selectedNodeId) {
			const node = dataset.nodeById.get(selectedNodeId);
			if (node) {
				node.fx = undefined;
				node.fy = undefined;
			}
		}
		setSelectedNodeId(null);
		setHoveredNodeId(null);
	}, [dataset, selectedNodeId]);

	const handleSearchSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const query = searchQuery.trim();
			if (!query) return;
			try {
				clearSearchStreamTimers();
				const response = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`);
				const result = (await response.json()) as { visibleNodes: GraphNode[]; visibleLinks: GraphLink[]; visibleNodeIds: string[]; primaryMatchId?: string };
				streamSearchResults(result, query);
			} catch {}
		},
		[clearSearchStreamTimers, searchQuery, streamSearchResults],
	);

	const lastDragNodeIdRef = useRef<string | null>(null);

	const onNodeDrag = useCallback(
		(node: GraphNode) => {
			if (lastDragNodeIdRef.current !== node.id) {
				lastDragNodeIdRef.current = node.id;
				const neighborIds = dataset.adjacency.get(node.id) ?? new Set<string>();
				const children: typeof dragChildOffsetsRef.current = [];
				neighborIds.forEach((id) => {
					const neighborNode = visibleGraph.nodes.find((n) => n.id === id);
					if (neighborNode && neighborNode !== node) {
						children.push({
							node: neighborNode as GraphNode & NodeObject,
							dx: (neighborNode.x ?? 0) - (node.x ?? 0),
							dy: (neighborNode.y ?? 0) - (node.y ?? 0),
						});
					}
				});
				dragChildOffsetsRef.current = children;
			}
			dragChildOffsetsRef.current.forEach((child) => {
				child.node.fx = (node.x ?? 0) + child.dx * DRAG_CHILD_OFFSET_SCALE;
				child.node.fy = (node.y ?? 0) + child.dy * DRAG_CHILD_OFFSET_SCALE;
			});
		},
		[dataset, visibleGraph.nodes],
	);

	const onNodeDragEnd = useCallback(() => {
		dragChildOffsetsRef.current.forEach((child) => {
			child.node.fx = undefined;
			child.node.fy = undefined;
		});
		if (selectedNodeId) {
			const selectedNode = dataset.nodeById.get(selectedNodeId);
			if (selectedNode) {
				selectedNode.fx = selectedNode.x;
				selectedNode.fy = selectedNode.y;
			}
		}
		dragChildOffsetsRef.current = [];
		lastDragNodeIdRef.current = null;
		wasmSimRef.current?.reheat?.();
		persistNodePositions();
	}, [dataset, persistNodePositions, selectedNodeId]);

	const handleResetSession = useCallback(() => {
		setVisibleNodeIds(new Set());
		setSelectedNodeId(null);
		if (typeof window !== 'undefined') window.localStorage.removeItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		if (typeof window !== 'undefined') window.localStorage.removeItem(NODE_POSITION_STORAGE_KEY);
		setSearchQuery('');
	}, []);

	useEffect(() => {
		const save = () => persistNodePositions();
		window.addEventListener('beforeunload', save);
		window.addEventListener('pagehide', save);
		return () => {
			window.removeEventListener('beforeunload', save);
			window.removeEventListener('pagehide', save);
		};
	}, [persistNodePositions]);

	// Step WASM sim each frame and lerp node positions toward sim output.
	// Mutates node objects in-place — intentional react-force-graph-2d pattern.
	/* eslint-disable react-hooks/immutability */
	const onEngineTickFn = useCallback(() => {
		const sim = wasmSimRef.current;
		if (!sim) return;
		sim.step();
		const positions: Float32Array = sim.get_positions();
		const indexMap = nodeIndexMapRef.current;
		const LERP = 0.08;
		for (const node of visibleGraph.nodes) {
			if (node.fx !== undefined && node.fx !== null) continue;
			const idx = indexMap.get(node.id);
			if (idx === undefined) continue;
			const tx = positions[idx * 2];
			const ty = positions[idx * 2 + 1];
			node.x = (node.x ?? tx) + (tx - (node.x ?? tx)) * LERP;
			node.y = (node.y ?? ty) + (ty - (node.y ?? ty)) * LERP;
		}
	}, [visibleGraph.nodes]);
	/* eslint-enable react-hooks/immutability */

	return (
		<div
			className='h-screen w-screen overflow-hidden text-slate-100'
			style={{ background: dataset.visual.backgroundColor }}>
			<header className='absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl'>
				<div className='flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6'>
					<div className='flex flex-1 flex-wrap items-center gap-4'>
						<h1 className='text-2xl font-semibold tracking-[0.24em] text-white'>FINRA</h1>
						<form
							className='flex min-w-70 flex-1 flex-wrap items-center gap-2'
							onSubmit={handleSearchSubmit}>
							<div className='min-w-55 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 shadow-inner shadow-slate-950/40'>
								<input
									className='w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400'
									placeholder='firm, person, CRD/SEC#'
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
							</div>
							<button
								className='rounded-xl bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300'
								type='submit'>
								Fetch Nodes
							</button>
							<button
								className='rounded-xl bg-transparent px-3 py-2 text-sm font-medium text-slate-100/80 hover:text-white transition border border-white/10'
								type='button'
								onClick={() => setVisitedNodeIds(new Set())}>
								Clear visited
							</button>
							{statusMessage && <span className='text-sm text-slate-300'>{statusMessage}</span>}
						</form>
					</div>
					<div className='flex items-center gap-3'>
						<button
							className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10'
							onClick={() => setMenuOpen(!menuOpen)}
							type='button'>
							Toggle menu
						</button>
					</div>
				</div>
			</header>

			<div className='flex h-full pt-22'>
				{menuOpen && (
					<aside
						className='z-20 flex h-full w-90 shrink-0 flex-col overflow-y-auto border-r px-4 py-4 lg:px-5'
						style={{ background: dataset.visual.panelBackground, borderColor: dataset.visual.panelBorder }}>
						<div className='grid grid-cols-4 gap-2'>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => setPanelPinned(!panelPinned)}
								type='button'>
								{panelPinned ? 'Unpin' : 'Pin'} panel
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => graphRef.current?.zoomToFit(500)}
								type='button'>
								Center
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => wasmSimRef.current?.reheat?.()}
								type='button'>
								Refresh
							</button>
						</div>
						<div className='mt-4 flex flex-wrap gap-2'>
							<button
								className={`rounded-full px-3 py-1.5 text-xs font-medium ${traceMode ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
								onClick={() => setTraceMode(!traceMode)}
								type='button'>
								Trace Mode
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={handleBackgroundClick}
								type='button'>
								Clear Highlight
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={handleResetSession}
								type='button'>
								Reset Session
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={() => setShowLegend(!showLegend)}
								type='button'>
								Legend
							</button>
						</div>

						{showLegend && (
							<div className='mt-4 rounded-2xl border border-white/10 bg-white/5 p-4'>
								{dataset.legend.map((entry) => (
									<div
										className='flex items-start gap-3 py-1'
										key={entry.label}>
										<span
											className='mt-1 h-3 w-3 rounded-full'
											style={{ backgroundColor: entry.color }}
										/>
										<div>
											<div className='text-sm font-medium text-white'>{entry.label}</div>
											<div className='text-xs text-slate-400'>{entry.description}</div>
										</div>
									</div>
								))}
							</div>
						)}

						<div className='mt-5 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/35'>
							{activeNode ?
								<>
									<div className='flex items-center gap-2 text-sm text-slate-400'>
										<span>{hoveredNodeId && hoveredNodeId !== selectedNodeId ? 'Preview:' : 'Selected:'}</span>
										<span className='font-semibold text-slate-100'>{activeNode.title}</span>
									</div>
									<div className='mt-1 text-sm text-slate-300'>{activeNode.identifierLine}</div>
									<div className='mt-3 flex flex-wrap gap-2'>
										{activeNode.badges.map((badge) => (
											<span
												className={getBadgeClassName(badge.tone)}
												key={`${activeNode.id}-${badge.label}`}>
												{badge.label}
											</span>
										))}
									</div>
									<div className='mt-4 flex gap-3 rounded-2xl bg-slate-950/40 p-3'>
										<div className='flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/15 text-lg font-semibold text-sky-200'>{activeNode.marker}</div>
										<div>
											<div className='text-sm text-slate-200'>{activeNode.summary}</div>
											<div className='mt-1 text-xs uppercase tracking-[0.22em] text-slate-500'>{getKindLabel(activeNode.kind)}</div>
										</div>
									</div>
									<div className='mt-4 flex flex-wrap gap-2 items-center'>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowInfo(!showInfo)}
											type='button'>
											Info {showInfo ? '▾' : '▸'}
										</button>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowLog(!showLog)}
											type='button'>
											Log {showLog ? '▾' : '▸'}
										</button>
									</div>
									{showInfo && (
										<div className='mt-4 space-y-4'>
											{activeNode.externalLinks.map((link) => (
												<a
													key={link.href}
													className='rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-200'
													href={link.href}
													target='_blank'
													rel='noreferrer'>
													↗ {link.label}
												</a>
											))}
											{activeNode.detailSections.map((section) => (
												<div
													className='rounded-2xl border border-white/10 bg-slate-950/35 p-4'
													key={section.title}>
													<div className='mb-2 text-sm font-semibold text-white'>{section.title}</div>
													{section.items?.map((item) => (
														<div
															className='grid grid-cols-[120px_1fr] gap-3 py-1 text-sm'
															key={item.label}>
															<div className='text-slate-400'>{item.label}</div>
															<div className='text-slate-100'>{item.value}</div>
														</div>
													))}
												</div>
											))}
										</div>
									)}
								</>
							:	<div className='text-sm text-slate-300'>Search or select a node to view details.</div>}
						</div>
					</aside>
				)}

				<main className='relative flex-1'>
					{ForceGraph2D && (
						<ForceGraph2D
							ref={graphRef}
							graphData={layeredGraph}
							backgroundColor={dataset.visual.backgroundColor}
							nodeRelSize={NODE_REL_SIZE}
							nodeVal={(node: GraphNode) => node.size ?? 5}
							nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
								const r = Math.sqrt((node.size ?? 5) * NODE_REL_SIZE);
								const nx = node.x ?? 0;
								const ny = node.y ?? 0;
								const isInactive = isNodeInactive(node);
								const isSelected = selectedNodeId === node.id;
								const isHighlighted = highlightedNodeIds.has(node.id);
								const isHub = node.isHub;
								const isHubPerson = isHub && node.kind === 'individual';

								// Layer 3: selected/highlighted — glowing halo drawn beneath the node
								if (isSelected) {
									const haloR = r + 5;
									const grad = ctx.createRadialGradient(nx, ny, r * 0.5, nx, ny, haloR + 4);
									grad.addColorStop(0, 'rgba(255,255,255,0.35)');
									grad.addColorStop(1, 'rgba(255,255,255,0)');
									ctx.beginPath();
									ctx.arc(nx, ny, haloR + 4, 0, Math.PI * 2);
									ctx.fillStyle = grad;
									ctx.fill();
								} else if (isHighlighted) {
									ctx.beginPath();
									ctx.arc(nx, ny, r + 3, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,255,255,0.45)';
									ctx.lineWidth = 1.5;
									ctx.stroke();
								} else if (isHubPerson) {
									const orbitR = r + 10;
									const grad = ctx.createRadialGradient(nx, ny, r * 0.5, nx, ny, orbitR + 10);
									grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
									grad.addColorStop(0.6, 'rgba(59, 130, 246, 0.10)');
									grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
									ctx.beginPath();
									ctx.arc(nx, ny, orbitR + 10, 0, Math.PI * 2);
									ctx.fillStyle = grad;
									ctx.fill();
									ctx.beginPath();
									ctx.arc(nx, ny, orbitR, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,255,255,0.28)';
									ctx.lineWidth = 1.1;
									ctx.setLineDash([5, 6]);
									ctx.stroke();
									ctx.setLineDash([]);
								} else if (isHub && !isInactive) {
									// Layer 2: hub ring
									ctx.beginPath();
									ctx.arc(nx, ny, r + 2, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,200,60,0.4)';
									ctx.lineWidth = 1;
									ctx.stroke();
								}

								let color: string;
								if (isSelected) color = dataset.visual.nodeColors[node.kind] ?? dataset.visual.activeNodeColor;
								else if (isHighlighted) color = softenHoverColor(dataset.visual.neighborNodeColor, 0.3);
								else if (isInactive)
									color = '#4b5563'; // layer 1 — muted gray
								else if (isHubPerson)
									color = '#60a5fa'; // hub person — brighter solar blue
								else if (isHub)
									color = '#fbbf24'; // layer 2 hub — amber
								else color = dataset.visual.nodeColors[node.kind] ?? '#fff';

								const drawFn = node.kind === 'firm' ? drawFirmNode : drawPersonNode;
								drawFn(ctx, nx, ny, r, color, isInactive, node.hasDisclosure ?? false, 0.96);

								if (isInactive) {
									ctx.save();
									ctx.beginPath();
									ctx.arc(nx, ny, r + 5, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,255,255,0.70)';
									ctx.lineWidth = 1.6;
									ctx.stroke();
									ctx.restore();
								}

								// Labels visible sooner on zoom and kept inside the node silhouette when possible.
								const minReadableScale = 0.22;
								if (globalScale >= minReadableScale) {
									const maxLabelWidth = Math.max(r * 1.65, 20);
									const baseFontSize = Math.max(Math.min(10, r * 0.42) / Math.max(globalScale, 1), 2.75) * 2;
									const fontSize = Math.max(baseFontSize, 3.5);
									ctx.font = `${isSelected || isHub ? 'bold ' : ''}${fontSize}px Sans-Serif`;
									ctx.textAlign = 'center';
									ctx.textBaseline = 'middle';
									ctx.globalAlpha = isInactive ? 0.45 : 0.92;
									ctx.fillStyle = dataset.visual.nodeLabelColor;
									const words = node.label.split(/\s+/).filter(Boolean);
									const lines: string[] = [];
									let currentLine = '';
									for (const word of words) {
										const nextLine = currentLine ? `${currentLine} ${word}` : word;
										if (ctx.measureText(nextLine).width <= maxLabelWidth || !currentLine) {
											currentLine = nextLine;
										} else {
											lines.push(currentLine);
											currentLine = word;
										}
									}
									if (currentLine) lines.push(currentLine);
									const wrappedLines = lines.length > 3 ? [lines[0], lines[1], `${lines.slice(2).join(' ')}…`] : lines;
									const lineHeight = fontSize * 0.95;
									const startY = ny - ((wrappedLines.length - 1) * lineHeight) / 2;
									wrappedLines.forEach((line, index) => {
										ctx.fillText(line, nx, startY + index * lineHeight);
									});
									ctx.globalAlpha = 1;
								}
							}}
							nodeCanvasObjectMode={() => 'replace'}
							nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
								const r = Math.sqrt((node.size ?? 5) * NODE_REL_SIZE) + 3;
								ctx.fillStyle = color;
								ctx.beginPath();
								ctx.arc(node.x ?? 0, node.y ?? 0, r + 2, 0, Math.PI * 2);
								ctx.fill();
							}}
							nodeLabel='label'
							linkWidth={0}
							linkColor={() => 'rgba(0,0,0,0)'}
							linkDirectionalArrowLength={0}
							linkDirectionalArrowRelPos={1}
							linkCanvasObjectMode={() => 'before'}
							linkCanvasObject={(link: GraphLink, ctx: CanvasRenderingContext2D) => {
								const source = typeof link.source === 'string' ? dataset.nodeById.get(link.source) : link.source;
								const target = typeof link.target === 'string' ? dataset.nodeById.get(link.target) : link.target;
								if (!source || !target) return;
								const sx = source.x ?? 0;
								const sy = source.y ?? 0;
								const tx = target.x ?? 0;
								const ty = target.y ?? 0;
								const isHighlighted = highlightedLinkIds.has(getLinkKey(link));
								ctx.save();
								ctx.beginPath();
								ctx.moveTo(sx, sy);
								ctx.lineTo(tx, ty);
								ctx.lineWidth = isHighlighted ? 1.2 : 0.8;
								ctx.strokeStyle =
									isHighlighted ? 'rgba(255,255,255,1)'
									: link.relationship === 'employment' ? 'rgba(56,189,248,1)'
									: link.relationship === 'disclosure' ? 'rgba(148,163,184,1)'
									: link.relationship === 'control' ? 'rgba(244,67,54,1)'
									: 'rgba(255,255,255,1)';
								ctx.stroke();
								ctx.restore();
							}}
							onEngineTick={onEngineTickFn}
							onNodeClick={handleNodeClick}
							onNodeHover={(node: GraphNode | null) => setHoveredNodeId(node?.id ?? null)}
							onBackgroundClick={handleBackgroundClick}
							onNodeDrag={onNodeDrag}
							onNodeDragEnd={onNodeDragEnd}
							enableNodeDrag
							d3AlphaDecay={0}
							d3VelocityDecay={1}
						/>
					)}
					<div className='absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-5 py-2 text-sm text-slate-200'>
						Displayed: {displayedStats.people} People · {displayedStats.firms} Firms · {displayedStats.links} Links
					</div>
				</main>
			</div>
		</div>
	);
}

function getBadgeClassName(tone: BadgeTone): string {
	switch (tone) {
		case 'success':
			return 'rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200';
		case 'warning':
			return 'rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-200';
		case 'danger':
			return 'rounded-full bg-rose-400/15 px-3 py-1 text-xs font-medium text-rose-200';
		case 'info':
			return 'rounded-full bg-sky-400/15 px-3 py-1 text-xs font-medium text-sky-200';
		default:
			return 'rounded-full bg-slate-400/10 px-3 py-1 text-xs font-medium text-slate-200';
	}
}
