import {
	Color3,
	Material,
	type Scene,
	ShaderMaterial,
	type Texture,
	Vector2,
	Vector3,
	Vector4,
} from "@babylonjs/core";
import {
	FALLBACK_TERRAIN_COLOR_HEX,
	SUN_DIRECTION,
	TERRARIUM_CHANNEL_RANGE_COUNT,
} from "../constants";
import {
	COLOR_CHANNEL_MASK_BITS,
	COLOR_GREEN_SHIFT_BITS,
	COLOR_RED_SHIFT_BITS,
} from "./constants";
import { fragmentShader, vertexShader } from "./terrain-shaders";

interface Uniform<Value> {
	value: Value;
}

export interface SharedTerrainUniforms {
	uOpacity: Uniform<number>;
	uClipEnabled: Uniform<boolean>;
	uClipBounds: Uniform<Vector4>;
}

export function createSharedUniforms(): SharedTerrainUniforms {
	return {
		uOpacity: { value: 1 },
		uClipEnabled: { value: false },
		uClipBounds: { value: new Vector4() },
	};
}

export class TerrainMaterial extends ShaderMaterial {
	readonly uniforms;

	constructor(
		scene: Scene,
		shared: SharedTerrainUniforms,
		segments: number,
		private readonly fallback: Texture,
	) {
		super(
			"terrain-tile-material",
			scene,
			{ vertexSource: vertexShader, fragmentSource: fragmentShader },
			{
				attributes: ["position", "aSkirt"],
				uniforms: [
					"world",
					"viewProjection",
					"uOrigin",
					"uSize",
					"uSegments",
					"uMorph",
					"uHeightTexel",
					"uHeightUv",
					"uHeightOffset",
					"uImageryUv",
					"uHasImagery",
					"uParentUv",
					"uParentFade",
					"uSunDirection",
					"uOpacity",
					"uClipEnabled",
					"uClipBounds",
					"uFallbackColor",
				],
				samplers: ["uHeight", "uImagery", "uParentImagery"],
			},
		);
		const height: Uniform<Texture | null> = { value: null };
		const imagery: Uniform<Texture | null> = { value: null };
		const parentImagery: Uniform<Texture | null> = { value: null };
		this.uniforms = {
			...shared,
			uHeight: height,
			uImagery: imagery,
			uParentImagery: parentImagery,
			uHasImagery: { value: 0 },
			uParentUv: { value: new Vector3(0, 0, 1) },
			uParentFade: { value: 0 },
			uMorph: { value: 1 },
			uHeightTexel: {
				value: new Vector2(
					1 / TERRARIUM_CHANNEL_RANGE_COUNT,
					1 / TERRARIUM_CHANNEL_RANGE_COUNT,
				),
			},
			uHeightUv: { value: new Vector3(0, 0, 1) },
			uImageryUv: { value: new Vector3(0, 0, 1) },
			uHeightOffset: { value: 0 },
			uOrigin: { value: new Vector2() },
			uSize: { value: 1 },
		};
		this.sideOrientation = Material.CounterClockWiseSideOrientation;
		this.setFloat("uSegments", segments);
		this.setVector3(
			"uSunDirection",
			new Vector3(
				SUN_DIRECTION.x,
				SUN_DIRECTION.y,
				SUN_DIRECTION.z,
			).normalize(),
		);
		this.setColor3(
			"uFallbackColor",
			Color3.FromInts(
				(FALLBACK_TERRAIN_COLOR_HEX >> COLOR_RED_SHIFT_BITS) &
					COLOR_CHANNEL_MASK_BITS,
				(FALLBACK_TERRAIN_COLOR_HEX >> COLOR_GREEN_SHIFT_BITS) &
					COLOR_CHANNEL_MASK_BITS,
				FALLBACK_TERRAIN_COLOR_HEX & COLOR_CHANNEL_MASK_BITS,
			).toLinearSpace(),
		);
		this.setOpacity(shared.uOpacity.value);
		this.sync();
	}

	sync(): void {
		const uniforms = this.uniforms;
		this.setTexture("uHeight", uniforms.uHeight.value ?? this.fallback);
		this.setTexture("uImagery", uniforms.uImagery.value ?? this.fallback);
		this.setTexture(
			"uParentImagery",
			uniforms.uParentImagery.value ?? this.fallback,
		);
		this.setVector2("uOrigin", uniforms.uOrigin.value);
		this.setFloat("uSize", uniforms.uSize.value);
		this.setFloat("uMorph", uniforms.uMorph.value);
		this.setVector2("uHeightTexel", uniforms.uHeightTexel.value);
		this.setVector3("uHeightUv", uniforms.uHeightUv.value);
		this.setFloat("uHeightOffset", uniforms.uHeightOffset.value);
		this.setVector3("uImageryUv", uniforms.uImageryUv.value);
		this.setFloat("uHasImagery", uniforms.uHasImagery.value);
		this.setVector3("uParentUv", uniforms.uParentUv.value);
		this.setFloat("uParentFade", uniforms.uParentFade.value);
		this.setFloat("uOpacity", uniforms.uOpacity.value);
		this.setInt("uClipEnabled", Number(uniforms.uClipEnabled.value));
		this.setVector4("uClipBounds", uniforms.uClipBounds.value);
	}

	setOpacity(opacity: number): void {
		this.uniforms.uOpacity.value = opacity;
		this.alpha = opacity;
		this.transparencyMode =
			opacity < 1 ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_OPAQUE;
		this.disableDepthWrite = opacity < 1;
		this.setFloat("uOpacity", opacity);
	}
}
