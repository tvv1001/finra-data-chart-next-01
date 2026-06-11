type LayoutNode = { id: string | number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null };
type LayoutLink = { source: string | number; target: string | number };

let animationFrame = 0;
let running = false;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function stepSimulation(nodes: LayoutNode[], links: LayoutLink[], width: number, height: number) {
	const centerX = width / 2;
	const centerY = height / 2;

	for (const node of nodes) {
		const x = node.x ?? centerX;
		const y = node.y ?? centerY;
		const vx = (node.vx ?? 0) * 0.88;
		const vy = (node.vy ?? 0) * 0.88;

		node.vx = vx;
		node.vy = vy;
		node.x = clamp(x + vx, 0, width);
		node.y = clamp(y + vy, 0, height);
	}

	for (const link of links) {
		const source = nodes.find((node) => String(node.id) === String(link.source));
		const target = nodes.find((node) => String(node.id) === String(link.target));
		if (!source || !target) continue;

		const dx = (target.x ?? centerX) - (source.x ?? centerX);
		const dy = (target.y ?? centerY) - (source.y ?? centerY);
		const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
		const force = 0.015;
		const nx = (dx / distance) * force;
		const ny = (dy / distance) * force;

		source.vx = (source.vx ?? 0) + nx;
		source.vy = (source.vy ?? 0) + ny;
		target.vx = (target.vx ?? 0) - nx;
		target.vy = (target.vy ?? 0) - ny;
	}

	return nodes.map((node) => ({ id: node.id, x: node.x ?? centerX, y: node.y ?? centerY }));
}

export function startForceWorker(
	nodes: LayoutNode[],
	links: LayoutLink[],
	width: number,
	height: number,
	onTick: (tickNodes: Array<{ id: string | number; x: number; y: number }>) => void,
) {
	running = true;

	const tick = () => {
		if (!running) return;
		const tickNodes = stepSimulation(nodes, links, width, height);
		onTick(tickNodes);
		animationFrame = window.setTimeout(tick, 16);
	};

	tick();

	return () => {
		running = false;
		window.clearTimeout(animationFrame);
	};
}

export function stopForceWorker() {
	running = false;
	if (animationFrame) window.clearTimeout(animationFrame);
	animationFrame = 0;
}
