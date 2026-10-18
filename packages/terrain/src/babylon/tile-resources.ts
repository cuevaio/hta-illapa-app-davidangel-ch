import { Constants, RawTexture, type Scene, Texture } from "@babylonjs/core";
import { MAX_TEXTURE_ANISOTROPY_RATIO } from "../constants";
import { fromHalfFloat } from "../domain/half-float";
import type { HeightDataResource } from "../domain/height-sampler";
import type { DecodedHeightTile } from "../infrastructure/decode-protocol";
import type { Disposable } from "../infrastructure/tile-layer";

export interface HeightResource extends HeightDataResource, Disposable {
	readonly texture: RawTexture;
}

export interface ImageryResource extends Disposable {
	readonly texture: Texture | null;
}

export class TileResourceFactory {
	constructor(private readonly scene: Scene) {}

	createHeight(tile: DecodedHeightTile): HeightResource {
		const capabilities = this.scene.getEngine().getCaps();
		const halfFloat = capabilities.textureHalfFloat;
		const linearFiltering = halfFloat
			? capabilities.textureHalfFloatLinearFiltering
			: capabilities.textureFloatLinearFiltering;
		const texture = new RawTexture(
			halfFloat ? tile.heights : Float32Array.from(tile.heights, fromHalfFloat),
			tile.width,
			tile.height,
			Constants.TEXTUREFORMAT_R,
			this.scene,
			false,
			false,
			linearFiltering
				? Texture.BILINEAR_SAMPLINGMODE
				: Texture.NEAREST_SAMPLINGMODE,
			halfFloat
				? Constants.TEXTURETYPE_HALF_FLOAT
				: Constants.TEXTURETYPE_FLOAT,
		);
		texture.wrapU = Texture.CLAMP_ADDRESSMODE;
		texture.wrapV = Texture.CLAMP_ADDRESSMODE;
		texture.gammaSpace = false;
		return { texture, tile, dispose: () => texture.dispose() };
	}

	createImagery(bitmap: ImageBitmap): ImageryResource {
		const texture = new Texture(
			`data:terrain-imagery-${this.scene.getUniqueId()}`,
			this.scene,
			{
				buffer: bitmap,
				invertY: false,
				samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
				useSRGBBuffer: false,
			},
		);
		texture.gammaSpace = false;
		texture.wrapU = Texture.CLAMP_ADDRESSMODE;
		texture.wrapV = Texture.CLAMP_ADDRESSMODE;
		texture.anisotropicFilteringLevel = Math.min(
			MAX_TEXTURE_ANISOTROPY_RATIO,
			this.scene.getEngine().getCaps().maxAnisotropy,
		);
		return {
			texture,
			dispose: () => {
				texture.dispose();
				bitmap.close();
			},
		};
	}

	createMissingImagery(): ImageryResource {
		return { texture: null, dispose() {} };
	}
}
