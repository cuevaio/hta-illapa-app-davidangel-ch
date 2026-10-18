import {
	DataTexture,
	HalfFloatType,
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	RedFormat,
	Texture,
	type WebGLRenderer,
} from "three";
import { MAX_TEXTURE_ANISOTROPY_RATIO } from "../constants";
import type { HeightDataResource } from "../domain/height-sampler";
import type { DecodedHeightTile } from "../infrastructure/decode-protocol";
import type { Disposable } from "../infrastructure/tile-layer";

export interface HeightResource extends HeightDataResource, Disposable {
	readonly texture: DataTexture;
}

export interface ImageryResource extends Disposable {
	/** Null when imagery failed to load; the shader uses a neutral surface color. */
	readonly texture: Texture | null;
}

/** Creates GPU resources and uploads them immediately so first render does not stall. */
export class TileResourceFactory {
	constructor(private readonly renderer: WebGLRenderer) {}

	/** Uploads heights as an R16F texture (half of Float32); WebGL2 always filters it linearly. */
	createHeight(tile: DecodedHeightTile): HeightResource {
		const texture = new DataTexture(
			tile.heights,
			tile.width,
			tile.height,
			RedFormat,
			HalfFloatType,
		);
		texture.minFilter = LinearFilter;
		texture.magFilter = LinearFilter;
		texture.generateMipmaps = false;
		texture.flipY = false;
		texture.needsUpdate = true;
		this.renderer.initTexture(texture);
		return { texture, tile, dispose: () => texture.dispose() };
	}

	createImagery(bitmap: ImageBitmap): ImageryResource {
		const texture = new Texture(bitmap);
		texture.flipY = false;
		texture.colorSpace = NoColorSpace;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.magFilter = LinearFilter;
		texture.anisotropy = Math.min(
			MAX_TEXTURE_ANISOTROPY_RATIO,
			this.renderer.capabilities.getMaxAnisotropy(),
		);
		texture.needsUpdate = true;
		this.renderer.initTexture(texture);
		return {
			texture,
			dispose: () => {
				texture.dispose();
				bitmap.close();
			},
		};
	}

	createMissingImagery(): ImageryResource {
		return { texture: null, dispose: () => {} };
	}
}
