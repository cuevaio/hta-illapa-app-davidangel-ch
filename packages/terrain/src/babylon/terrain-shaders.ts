import {
	IMAGERY_AMBIENT_RATIO,
	IMAGERY_DIFFUSE_RATIO,
	MIN_SKIRT_DEPTH_M,
	SKIRT_DEPTH_RATIO,
} from "../constants";

export const vertexShader = `

attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
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
  vec4 worldPosition = world * vec4(vLocal, 1.0);
#ifdef MULTIVIEW
  gl_Position = gl_ViewID_OVR == 0u ? viewProjection * worldPosition : viewProjectionR * worldPosition;
#else
  gl_Position = viewProjection * worldPosition;
#endif
}
`;

export const fragmentShader = `


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
