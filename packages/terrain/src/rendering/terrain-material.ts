import {
	Color,
	type IUniform,
	ShaderMaterial,
	type Texture,
	Vector2,
	Vector3,
	Vector4,
} from "three";
import {
	FALLBACK_TERRAIN_COLOR_HEX,
	IMAGERY_AMBIENT_RATIO,
	IMAGERY_DIFFUSE_RATIO,
	MIN_SKIRT_DEPTH_M,
	SKIRT_DEPTH_RATIO,
	SUN_DIRECTION,
	TERRARIUM_CHANNEL_RANGE_COUNT,
} from "../constants";

export interface SharedTerrainUniforms {
	[name: string]: IUniform;
	uSunDirection: IUniform<Vector3>;
	uOpacity: IUniform<number>;
	uClipEnabled: IUniform<boolean>;
	uClipBounds: IUniform<Vector4>;
}

export function createSharedUniforms(): SharedTerrainUniforms {
	return {
		uOpacity: { value: 1 },
		uSunDirection: {
			value: new Vector3(
				SUN_DIRECTION.x,
				SUN_DIRECTION.y,
				SUN_DIRECTION.z,
			).normalize(),
		},
		uClipEnabled: { value: false },
		uClipBounds: { value: new Vector4() },
	};
}

const vertexShader = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSkirt;
uniform sampler2D uHeight;
uniform vec2 uHeightTexel;
uniform vec3 uHeightUv;
uniform float uHeightOffset;
uniform vec2 uOrigin;
uniform float uSize;
uniform float uSegments;
uniform float uMorph;
varying vec2 vUv;
varying vec3 vLocal;

float heightAt(vec2 uv) {
  // Map tile edges onto edge texel centers.
  vec2 sampleUv = uHeightTexel * 0.5 + clamp(uHeightUv.xy + uv * uHeightUv.z, 0.0, 1.0) * (1.0 - uHeightTexel);
  return texture2D(uHeight, sampleUv).r + uHeightOffset;
}

// Height of the parent's coarser surface at this vertex. The parent grid has
// half the resolution and lands on even child indices, so odd vertices are
// interpolated from their even neighbours along the parent's triangulation
// (cells are split along the diagonal from (i + 1, j) to (i, j + 1)).
float coarseHeightAt(vec2 uv, float fineHeight) {
  vec2 odd = mod(floor(uv * uSegments + 0.5), 2.0);
  float gridStep = 1.0 / uSegments;
  if (odd.x > 0.5 && odd.y > 0.5) return 0.5 * (heightAt(uv + vec2(gridStep, -gridStep)) + heightAt(uv + vec2(-gridStep, gridStep)));
  if (odd.x > 0.5) return 0.5 * (heightAt(uv - vec2(gridStep, 0.0)) + heightAt(uv + vec2(gridStep, 0.0)));
  if (odd.y > 0.5) return 0.5 * (heightAt(uv - vec2(0.0, gridStep)) + heightAt(uv + vec2(0.0, gridStep)));
  return fineHeight;
}

void main() {
  vec2 uv = position.xz;
  vUv = uv;
  float fineHeight = heightAt(uv);
  float elevation = uMorph >= 1.0 ? fineHeight : mix(coarseHeightAt(uv, fineHeight), fineHeight, uMorph);
  float skirtDepth = max(uSize * ${SKIRT_DEPTH_RATIO}, ${MIN_SKIRT_DEPTH_M.toFixed(1)});
  elevation -= aSkirt * skirtDepth;
  vLocal = vec3(uOrigin.x + uv.x * uSize, elevation, uOrigin.y + uv.y * uSize);
  vec4 mvPosition = modelViewMatrix * vec4(vLocal, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uHeight;
uniform sampler2D uImagery;
uniform vec3 uImageryUv;
uniform float uHasImagery;
uniform sampler2D uParentImagery;
uniform vec3 uParentUv;
uniform float uParentFade;
uniform float uMorph;
uniform vec2 uHeightTexel;
uniform vec3 uHeightUv;
uniform float uHeightOffset;
uniform float uSize;
uniform vec3 uSunDirection;
uniform float uOpacity;
uniform bool uClipEnabled;
uniform vec4 uClipBounds;
uniform vec3 uFallbackColor;
varying vec2 vUv;
varying vec3 vLocal;

float rawHeight(vec2 uv) {
  vec2 sampleUv = uHeightTexel * 0.5 + clamp(uHeightUv.xy + uv * uHeightUv.z, 0.0, 1.0) * (1.0 - uHeightTexel);
  return texture2D(uHeight, sampleUv).r + uHeightOffset;
}

void main() {
  if (uClipEnabled && (any(lessThan(vLocal.xz, uClipBounds.xy)) || any(greaterThan(vLocal.xz, uClipBounds.zw)))) discard;
  #include <logdepthbuf_fragment>
  // Normals follow the geomorph: at morph 0 the differences span two texels,
  // matching the parent's coarser texel spacing.
  vec2 sampleStep = uHeightTexel / uHeightUv.z * (2.0 - uMorph);
  float heightLeft = rawHeight(vUv - vec2(sampleStep.x, 0.0));
  float heightRight = rawHeight(vUv + vec2(sampleStep.x, 0.0));
  float heightNorth = rawHeight(vUv - vec2(0.0, sampleStep.y));
  float heightSouth = rawHeight(vUv + vec2(0.0, sampleStep.y));
  vec2 spacing = 2.0 * uSize * sampleStep;
  vec3 normal = normalize(vec3(-(heightRight - heightLeft) / spacing.x, 1.0, -(heightSouth - heightNorth) / spacing.y));
  float diffuse = max(dot(normal, uSunDirection), 0.0);
  // Imagery already contains baked shadows; apply gentle relief lighting.
  float lighting = ${IMAGERY_AMBIENT_RATIO} + ${IMAGERY_DIFFUSE_RATIO} * diffuse;
  vec3 color = uFallbackColor * lighting;
  if (uHasImagery > 0.5) color = texture2D(uImagery, uImageryUv.xy + vUv * uImageryUv.z).rgb * lighting;
  if (uParentFade > 0.0) {
    vec3 parentColor = texture2D(uParentImagery, uParentUv.xy + vUv * uParentUv.z).rgb * lighting;
    color = mix(color, parentColor, uParentFade);
  }
  gl_FragColor = vec4(color, uOpacity);
}
`;

export interface TileUniforms extends SharedTerrainUniforms {
	uHeight: IUniform<Texture | null>;
	uImagery: IUniform<Texture | null>;
	uHasImagery: IUniform<number>;
	uParentImagery: IUniform<Texture | null>;
	uParentUv: IUniform<Vector3>;
	uParentFade: IUniform<number>;
	uMorph: IUniform<number>;
	uSegments: IUniform<number>;
	uHeightTexel: IUniform<Vector2>;
	uHeightUv: IUniform<Vector3>;
	uImageryUv: IUniform<Vector3>;
	uHeightOffset: IUniform<number>;
	uOrigin: IUniform<Vector2>;
	uSize: IUniform<number>;
	uFallbackColor: IUniform<Color>;
}

export class TerrainMaterial extends ShaderMaterial {
	declare uniforms: TileUniforms;

	constructor(shared: SharedTerrainUniforms, segments: number) {
		const uniforms: TileUniforms = {
			...shared,
			uHeight: { value: null },
			uImagery: { value: null },
			uHasImagery: { value: 0 },
			uParentImagery: { value: null },
			uParentUv: { value: new Vector3(0, 0, 1) },
			uParentFade: { value: 0 },
			uMorph: { value: 1 },
			uSegments: { value: segments },
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
			uFallbackColor: { value: new Color(FALLBACK_TERRAIN_COLOR_HEX) },
		};
		super({ vertexShader, fragmentShader, uniforms });
		this.setOpacity(shared.uOpacity.value);
	}
	setOpacity(opacity: number): void {
		const transparent = opacity < 1;
		if (this.transparent !== transparent) this.needsUpdate = true;
		this.opacity = opacity;
		this.uniforms.uOpacity.value = opacity;
		this.transparent = transparent;
		this.depthWrite = !transparent;
	}
}
