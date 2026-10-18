import type { ICanvas, ICanvasRenderingContext } from "@babylonjs/core";
import {
	TEST_CHARACTER_WIDTH_PX,
	TEST_FONT_ASCENT_PX,
	TEST_FONT_DESCENT_PX,
} from "./constants";

export class LayoutCanvas implements ICanvas {
	private readonly context = new LayoutContext(this);
	constructor(
		public width: number,
		public height: number,
	) {}
	getContext() {
		return this.context;
	}
	toDataURL() {
		return "";
	}
}

class LayoutContext implements ICanvasRenderingContext {
	lineJoin = "miter";
	miterLimit = 0;
	font = "";
	strokeStyle = "";
	fillStyle = "";
	filter = "none";
	globalAlpha = 1;
	shadowColor = "transparent";
	shadowBlur = 0;
	shadowOffsetX = 0;
	shadowOffsetY = 0;
	lineWidth = 1;
	constructor(readonly canvas: ICanvas) {}
	clearRect() {}
	save() {}
	restore() {}
	fillRect() {}
	scale() {}
	rotate() {}
	translate() {}
	strokeRect() {}
	rect() {}
	clip() {}
	putImageData() {}
	arc() {}
	arcTo() {}
	beginPath() {}
	closePath() {}
	moveTo() {}
	lineTo() {}
	quadraticCurveTo() {}
	measureText(text: string) {
		return {
			width: text.length * TEST_CHARACTER_WIDTH_PX,
			actualBoundingBoxLeft: 0,
			actualBoundingBoxRight: text.length * TEST_CHARACTER_WIDTH_PX,
			actualBoundingBoxAscent: TEST_FONT_ASCENT_PX,
			actualBoundingBoxDescent: TEST_FONT_DESCENT_PX,
		};
	}
	stroke() {}
	fill() {}
	drawImage() {}
	getImageData(): never {
		throw new Error("Pixel reads are outside the GUI layout test");
	}
	setLineDash() {}
	fillText() {}
	strokeText() {}
	createLinearGradient(): never {
		throw new Error("Gradients are outside the GUI layout test");
	}
	createRadialGradient(): never {
		throw new Error("Gradients are outside the GUI layout test");
	}
	setTransform() {}
	getTransform(): never {
		throw new Error("Canvas transforms are outside the GUI layout test");
	}
}
