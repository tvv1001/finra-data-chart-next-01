const NODE_ROUTE_BASE = '/node';

function canonicalizeRouteNodeId(nodeId: string) {
	const normalizedNodeId = String(nodeId || '').trim();
	if (!normalizedNodeId) return '';

	const rawId = normalizedNodeId
		.replace(/^finra:/i, '')
		.replace(/^sec:/i, '')
		.replace(/^individual:/i, 'person:')
		.replace(/^person_/i, 'person:')
		.replace(/^firm_/i, 'firm:');

	if (/^person:/i.test(rawId)) {
		return `person:${rawId.slice('person:'.length).trim()}`;
	}
	if (/^firm:/i.test(rawId)) {
		return `firm:${rawId.slice('firm:'.length).trim()}`;
	}

	return normalizedNodeId;
}

function toNodeRouteSlug(nodeId: string) {
	const canonicalNodeId = canonicalizeRouteNodeId(nodeId);
	if (!canonicalNodeId) return '';

	if (/^(person|firm):/i.test(canonicalNodeId)) {
		const [kind, ...rest] = canonicalNodeId.split(':');
		const value = rest.join(':').trim();
		return value ? `${kind.toLowerCase()}-${value}` : kind.toLowerCase();
	}

	const separatorIndex = canonicalNodeId.indexOf(':');
	if (separatorIndex < 0) return encodeURIComponent(canonicalNodeId);
	const prefix = canonicalNodeId.slice(0, separatorIndex).trim();
	const rawSuffix = canonicalNodeId.slice(separatorIndex + 1).trim();
	if (!prefix || !rawSuffix) return encodeURIComponent(canonicalNodeId);
	return `${encodeURIComponent(prefix)}-${encodeURIComponent(rawSuffix)}`;
}

function fromNodeRouteSlug(slug: string) {
	const normalizedSlug = String(slug || '').trim();
	if (!normalizedSlug) return null;

	const legacyParts = normalizedSlug.split('-');
	if (legacyParts.length >= 3 && /^(finra|sec)$/i.test(legacyParts[0]) && /^(individual|person|firm)$/i.test(legacyParts[1])) {
		const canonicalType = legacyParts[1] === 'individual' || legacyParts[1] === 'person' ? 'person' : 'firm';
		const canonicalValue = legacyParts.slice(2).join('-');
		if (canonicalValue) {
			return canonicalizeRouteNodeId(`${canonicalType}:${canonicalValue}`);
		}
	}

	const canonicalSlug = normalizedSlug.replace(/^person-/i, 'person:').replace(/^firm-/i, 'firm:');

	try {
		const decodedSlug = decodeURIComponent(canonicalSlug);
		if (decodedSlug.includes(':')) {
			return canonicalizeRouteNodeId(decodedSlug);
		}
	} catch {}

	const separatorIndex = normalizedSlug.indexOf('-');
	if (separatorIndex < 0) {
		try {
			return canonicalizeRouteNodeId(decodeURIComponent(normalizedSlug));
		} catch {
			return canonicalizeRouteNodeId(normalizedSlug);
		}
	}

	const encodedPrefix = normalizedSlug.slice(0, separatorIndex).trim();
	const encodedSuffix = normalizedSlug.slice(separatorIndex + 1).trim();
	if (!encodedPrefix || !encodedSuffix) {
		try {
			return canonicalizeRouteNodeId(decodeURIComponent(normalizedSlug));
		} catch {
			return canonicalizeRouteNodeId(normalizedSlug);
		}
	}

	try {
		return canonicalizeRouteNodeId(`${decodeURIComponent(encodedPrefix)}:${decodeURIComponent(encodedSuffix)}`);
	} catch {
		return canonicalizeRouteNodeId(`${encodedPrefix}:${encodedSuffix}`);
	}
}

export function buildNodeRoutePath(nodeId: string | null | undefined) {
	const normalizedNodeId = String(nodeId || '').trim();
	if (!normalizedNodeId) return '/';
	return `${NODE_ROUTE_BASE}/${toNodeRouteSlug(normalizedNodeId)}`;
}

export function buildNodeRouteHref(nodeId: string | null | undefined, search = '') {
	const path = buildNodeRoutePath(nodeId);
	const normalizedSearch = search.startsWith('?') || !search ? search : `?${search}`;
	return `${path}${normalizedSearch}`;
}

export function parseNodeIdFromPathname(pathname: string | null | undefined) {
	const normalizedPathname = String(pathname || '').trim();
	if (!normalizedPathname || normalizedPathname === '/') return null;
	const match = /^\/node\/([^/]+?)\/?$/.exec(normalizedPathname);
	if (!match) return null;
	return fromNodeRouteSlug(match[1]);
}
