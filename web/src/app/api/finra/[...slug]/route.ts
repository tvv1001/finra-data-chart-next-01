import { NextResponse } from 'next/server';

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function countGraphStats(graph: { visibleNodes?: unknown[]; visibleLinks?: unknown[] }) {
	const nodes = asArray(graph.visibleNodes);
	const links = asArray(graph.visibleLinks);
	const people = nodes.filter((node) => typeof node === 'object' && node !== null && 'kind' in node && (node as { kind?: string }).kind === 'individual').length;
	const firms = nodes.filter((node) => typeof node === 'object' && node !== null && 'kind' in node && (node as { kind?: string }).kind === 'firm').length;

	return {
		counts: {
			people,
			firms,
			links: links.length,
			totalNodes: nodes.length,
			totalLinks: links.length,
		},
		meta: {
			totalIndividuals: people,
			totalFirms: firms,
			totalLinks: links.length,
		},
	};
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const slug = url.pathname.split('/').filter(Boolean).slice(2);
	const origin = url.origin;

	if (slug[0] === 'cache-stats') {
		const graphRes = await fetch(new URL('/api/graph/search?all=true', origin), { cache: 'no-store' });
		if (!graphRes.ok) {
			return NextResponse.json({ counts: { people: 0, firms: 0, links: 0 } }, { status: 200 });
		}
		const graph = await graphRes.json();
		return NextResponse.json(countGraphStats(graph), { status: 200 });
	}

	if (slug[0] === 'graph') {
		const requestedLimit = Number(url.searchParams.get('limit') ?? url.searchParams.get('count') ?? '120');
		const requestedPeople = Number(url.searchParams.get('people') ?? '7');
		const requestedFirms = Number(url.searchParams.get('firms') ?? '4');
		const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 500) : 120;
		const safePeople = Number.isFinite(requestedPeople) && requestedPeople > 0 ? Math.floor(requestedPeople) : 7;
		const safeFirms = Number.isFinite(requestedFirms) && requestedFirms > 0 ? Math.floor(requestedFirms) : 4;

		const graphUrl = new URL('/api/graph/search', origin);
		graphUrl.searchParams.set('count', String(safeLimit));
		graphUrl.searchParams.set('people', String(safePeople));
		graphUrl.searchParams.set('firms', String(safeFirms));
		const graphRes = await fetch(graphUrl, { cache: 'no-store' });
		if (!graphRes.ok) {
			return NextResponse.json({ nodes: [], links: [], meta: { totalNodes: 0, totalLinks: 0 } }, { status: 200 });
		}

		const graph = await graphRes.json();
		const nodes =
			Array.isArray(graph.visibleNodes) ? graph.visibleNodes
			: Array.isArray(graph.nodes) ? graph.nodes
			: [];
		const links =
			Array.isArray(graph.visibleLinks) ? graph.visibleLinks
			: Array.isArray(graph.links) ? graph.links
			: [];

		return NextResponse.json(
			{
				nodes,
				links,
				meta: {
					totalNodes: nodes.length,
					totalLinks: links.length,
					people: nodes.filter((node) => typeof node === 'object' && node !== null && 'kind' in node && (node as { kind?: string }).kind === 'individual').length,
					firms: nodes.filter((node) => typeof node === 'object' && node !== null && 'kind' in node && (node as { kind?: string }).kind === 'firm').length,
				},
			},
			{ status: 200 },
		);
	}

	if (slug[0] === 'search' || slug[0] === 'sec-search' || slug[0] === 'graph-search') {
		const proxyUrl = new URL('/api/graph/search', origin);
		const query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? '';
		if (query) proxyUrl.searchParams.set('q', query);
		if (url.searchParams.get('firm')) proxyUrl.searchParams.set('firm', url.searchParams.get('firm')!);
		if (url.searchParams.get('rows')) proxyUrl.searchParams.set('rows', url.searchParams.get('rows')!);
		if (url.searchParams.get('limit')) proxyUrl.searchParams.set('limit', url.searchParams.get('limit')!);
		const proxyRes = await fetch(proxyUrl, { cache: 'no-store' });
		return proxyRes;
	}

	if (slug[0] === 'nodes-by-ids') {
		const ids = url.searchParams.get('ids') ?? '';
		const proxyUrl = new URL('/api/graph/nodes', origin);
		if (ids) proxyUrl.searchParams.set('ids', ids);
		const proxyRes = await fetch(proxyUrl, { cache: 'no-store' });
		return proxyRes;
	}

	if (slug[0] === 'profile') {
		return NextResponse.json({ profile: slug[1] ?? 'custom', nodes: [], links: [] }, { status: 200 });
	}

	if (slug[0] === 'seeds') {
		return NextResponse.json({ seeds: [] }, { status: 200 });
	}

	if (slug[0] === 'individual' || slug[0] === 'firm') {
		return NextResponse.json({ id: slug[1] ?? '', name: slug[1] ?? '', summary: 'Local compatibility fallback.' }, { status: 200 });
	}

	return NextResponse.json({ ok: true, route: 'finra-compat', slug }, { status: 200 });
}
