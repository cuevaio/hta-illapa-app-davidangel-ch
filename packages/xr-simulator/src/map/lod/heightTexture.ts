import { Constants, RawTexture, type Scene, Texture } from "@babylonjs/core";

/**
 * R16F height texture from half-float bits. Half floats are filterable in WebGL2 core and
 * in WebGPU (r16float), unlike 32-bit floats, so both engines sample them bilinearly.
 */
export function createHeightTexture(
	scene: Scene,
	bits: Uint16Array,
	width: number,
	height: number,
): RawTexture {
	const tex = RawTexture.CreateRTexture(
		bits,
		width,
		height,
		scene,
		false,
		false,
		Texture.BILINEAR_SAMPLINGMODE,
		Constants.TEXTURETYPE_HALF_FLOAT,
	);
	tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
	return tex;
}
