// 2D canvas drawing helpers for graph nodes (replaces THREE.js geometry)

export function drawFirmNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, isInactive: boolean, hasDisclosure: boolean, opacity = 0.96): void {
	const strokeColor = hasDisclosure ? '#ef4444' : color;
	ctx.save();
	ctx.globalAlpha = (isInactive ? 0.2 : 1) * opacity;
	ctx.beginPath();
	// Diamond (rotated square)
	ctx.moveTo(x, y - r);
	ctx.lineTo(x + r, y);
	ctx.lineTo(x, y + r);
	ctx.lineTo(x - r, y);
	ctx.closePath();
	ctx.fillStyle = strokeColor + '40';
	ctx.fill();
	ctx.save();
	ctx.clip();
	const glassGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
	glassGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
	glassGrad.addColorStop(0.45, 'rgba(255,255,255,0.08)');
	glassGrad.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = glassGrad;
	ctx.fillRect(x - r, y - r, r * 2, r * 2);
	ctx.restore();
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1.25;
	ctx.stroke();
	ctx.restore();
}

export function drawPersonNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, isInactive: boolean, hasDisclosure: boolean, opacity = 0.96): void {
	const strokeColor = hasDisclosure ? '#ef4444' : color;
	ctx.save();
	ctx.globalAlpha = (isInactive ? 0.2 : 1) * opacity;
	// Hexagon
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 6;
		const px = x + r * Math.cos(angle);
		const py = y + r * Math.sin(angle);
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = strokeColor + '40';
	ctx.fill();
	ctx.save();
	ctx.clip();
	const glassGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
	glassGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
	glassGrad.addColorStop(0.45, 'rgba(255,255,255,0.08)');
	glassGrad.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = glassGrad;
	ctx.fillRect(x - r, y - r, r * 2, r * 2);
	ctx.restore();
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1.25;
	ctx.stroke();
	ctx.restore();
}
