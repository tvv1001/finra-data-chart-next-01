// 2D canvas drawing helpers for graph nodes (replaces THREE.js geometry)

export function drawFirmNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, isInactive: boolean, hasDisclosure: boolean, opacity = 0.96): void {
	const strokeColor = hasDisclosure ? '#ef4444' : color;
	ctx.save();
	ctx.globalAlpha = (isInactive ? 0.2 : 1) * opacity;

	const points = Array.from({ length: 6 }, (_, i) => {
		const angle = (Math.PI / 3) * i - Math.PI / 6;
		return {
			px: x + r * Math.cos(angle),
			py: y + r * Math.sin(angle),
		};
	});

	ctx.beginPath();
	points.forEach((point, index) => {
		if (index === 0) ctx.moveTo(point.px, point.py);
		else ctx.lineTo(point.px, point.py);
	});
	ctx.closePath();

	ctx.fillStyle = strokeColor + '38';
	ctx.fill();

	ctx.save();
	ctx.clip();
	const glassGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
	glassGrad.addColorStop(0, 'rgba(255,255,255,0.32)');
	glassGrad.addColorStop(0.45, 'rgba(255,255,255,0.08)');
	glassGrad.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = glassGrad;
	ctx.fillRect(x - r, y - r, r * 2, r * 2);
	ctx.restore();

	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1.35;
	ctx.stroke();
	ctx.restore();
}

export function drawPersonNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, isInactive: boolean, hasDisclosure: boolean, opacity = 0.96): void {
	const strokeColor = hasDisclosure ? '#ef4444' : color;
	ctx.save();
	ctx.globalAlpha = (isInactive ? 0.22 : 1) * opacity;

	const glow = ctx.createRadialGradient(x - r * 0.2, y - r * 0.3, 0, x, y, r * 1.5);
	glow.addColorStop(0, strokeColor + '28');
	glow.addColorStop(0.45, strokeColor + '0A');
	glow.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.beginPath();
	ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
	ctx.fillStyle = glow;
	ctx.fill();

	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = strokeColor + '18';
	ctx.fill();

	ctx.save();
	ctx.clip();
	const glassGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
	glassGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
	glassGrad.addColorStop(0.45, 'rgba(255,255,255,0.08)');
	glassGrad.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = glassGrad;
	ctx.fillRect(x - r, y - r, r * 2, r * 2);
	ctx.restore();

	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1.2;
	ctx.stroke();
	ctx.restore();
}
