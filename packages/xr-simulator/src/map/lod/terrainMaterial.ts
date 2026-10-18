import { Color3, ShaderLanguage, ShaderMaterial, ShaderStore, Vector2, Vector3, Vector4, type BaseTexture, type Scene } from '@babylonjs/core';

/**
 * Streamed-tile material: heights from a per-tile R16F texture displaced in the vertex
 * shader, CDLOD geomorph, skirts, and our hypsometric tint + hillshade (src/map/shading.ts)
 * in the fragment shader, with a cross-fade from the ancestor it replaced and EXP2 fog.
 * WGSL on WebGPU (no GLSL→WGSL transpiler download) and GLSL ES 3 on WebGL2 (Quest).
 * With the CONTEXT define (map context around a simulation, src/map/MapContext.ts) the tile
 * follows its mesh's world matrix and discards the fragments inside `uHole` (local km), where
 * the simulated patch is drawn instead; the overview compiles without it, exactly as before.
 *
 * Satellite imagery (S7, src/map/imagery): with uImageryOn the colour is the provider imagery
 * (its own tile or an ancestor's sub-rectangle, uImageryUv) lit by a subtle hillshade
 * (uImageryRelief) instead of the hypsometric tint; the cross-fade source has its own imagery
 * (uParentImagery*). Tiles past the terrain's max z11 reuse an ancestor's height texture
 * through uHeightUv (offset, scale) and uHeightSize (that texture's tile side, km). With
 * uImageryOn = uParentImageryOn = 0 and uHeightUv = (0, 0, 1) the colour is exactly the
 * previous hypsometric path.
 *
 * Weather (S8, src/map/weather): with the WEATHER define the fragment shader drapes the weather
 * textures, sampled by Web Mercator UV: uTileWorld = (minX, minY, size) of the tile in the unit
 * square, each layer's box (x0, y0, w, h) in the same square. Order: cloud shadow, temperature
 * + rain (premultiplied, cross-faded from uWxPrev by uWxMix.x), CAPE hatched in screen space
 * (alpha = category), draped clouds (map context), then the wind trails / lightning overlay.
 * uWxOn = 0 leaves the colour exactly as without it; without the define nothing changes at all.
 */

const NAME = 'peruTile';

const UNIFORMS = [
  'world', 'uHole', 'viewProjection', 'cameraPosition', 'uOrigin', 'uSize', 'uSegments', 'uMorph', 'uHeightTexel', 'uHeightOffset', 'uExaggeration',
  'uSkirtDepth', 'uParentUv', 'uParentFade', 'uParentTexel', 'uParentOffset', 'uParentSize', 'uFogColor', 'uFogDensity', 'uHillshadeZ',
  'uHeightUv', 'uHeightSize', 'uImageryOn', 'uImageryUv', 'uParentImageryOn', 'uParentImageryUv', 'uImageryRelief',
];
const SAMPLERS = ['uHeight', 'uParentHeight', 'uImagery', 'uParentImagery'];
const WEATHER_UNIFORMS = ['uTileWorld', 'uWxOn', 'uWxBounds', 'uWxMix', 'uWxOverlayRect', 'uWxCloudRect'];
const WEATHER_SAMPLERS = ['uWx', 'uWxPrev', 'uWxCape', 'uWxOverlay', 'uWxClouds'];

/** Shader options of a tile material: CONTEXT (map context) and WEATHER (S8) variants. */
export function tileMaterialOptions(context: boolean, weather: boolean): { uniforms: string[]; samplers: string[]; defines: string[] } {
  return {
    uniforms: weather ? [...UNIFORMS, ...WEATHER_UNIFORMS] : [...UNIFORMS],
    samplers: weather ? [...SAMPLERS, ...WEATHER_SAMPLERS] : [...SAMPLERS],
    defines: [...(context ? ['CONTEXT'] : []), ...(weather ? ['WEATHER'] : [])],
  };
}

const HYPSO_GLSL = `
vec3 hypsometric(float h) {
  if (h <= 0.0) return mix(vec3(0.10, 0.26, 0.42), vec3(0.04, 0.12, 0.24), clamp(-h / 3000.0, 0.0, 1.0));
  vec3 c = vec3(0.16, 0.42, 0.22);
  c = mix(c, vec3(0.38, 0.55, 0.28), smoothstep(0.0, 600.0, h));
  c = mix(c, vec3(0.62, 0.60, 0.36), smoothstep(600.0, 1800.0, h));
  c = mix(c, vec3(0.62, 0.48, 0.34), smoothstep(1800.0, 3200.0, h));
  c = mix(c, vec3(0.50, 0.42, 0.38), smoothstep(3200.0, 4300.0, h));
  c = mix(c, vec3(0.93, 0.94, 0.96), smoothstep(4700.0, 5400.0, h));
  return c;
}`;

const VERTEX_GLSL = `precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec2 uOrigin;
uniform float uSize;
uniform float uSegments;
uniform float uMorph;
uniform vec2 uHeightTexel;
uniform float uHeightOffset;
uniform float uExaggeration;
uniform float uSkirtDepth;
uniform vec3 uHeightUv;
uniform sampler2D uHeight;
varying vec2 vUv;
varying vec3 vWorld;
varying vec2 vLocal;

float heightAt(vec2 uv) {
  vec2 st = uHeightTexel * 0.5 + (uHeightUv.xy + uv * uHeightUv.z) * (1.0 - uHeightTexel);
  return max(texture2D(uHeight, st).r + uHeightOffset, 0.0);
}

// Parent's coarser surface: odd vertices interpolated from their even neighbours along the
// parent's triangulation (diagonal (i+1, j)-(i, j+1)).
float coarseHeightAt(vec2 uv, float fine) {
  vec2 odd = mod(floor(uv * uSegments + 0.5), 2.0);
  float s = 1.0 / uSegments;
  if (odd.x > 0.5 && odd.y > 0.5) return 0.5 * (heightAt(uv + vec2(s, -s)) + heightAt(uv + vec2(-s, s)));
  if (odd.x > 0.5) return 0.5 * (heightAt(uv - vec2(s, 0.0)) + heightAt(uv + vec2(s, 0.0)));
  if (odd.y > 0.5) return 0.5 * (heightAt(uv - vec2(0.0, s)) + heightAt(uv + vec2(0.0, s)));
  return fine;
}

void main(void) {
  vec2 uv = position.xz;
  vUv = uv;
  float fine = heightAt(uv);
  float h = uMorph >= 1.0 ? fine : mix(coarseHeightAt(uv, fine), fine, uMorph);
  float y = h * 0.001 * uExaggeration - position.y * uSkirtDepth;
  vec3 local = vec3(uOrigin.x + uv.x * uSize, y, uOrigin.y - uv.y * uSize);
  vLocal = local.xz;
#ifdef CONTEXT
  vec4 placed = world * vec4(local, 1.0);
  vWorld = placed.xyz;
  gl_Position = viewProjection * placed;
#else
  vWorld = local;
  gl_Position = viewProjection * vec4(local, 1.0);
#endif
}`;

const FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uHeight;
uniform sampler2D uParentHeight;
uniform vec2 uHeightTexel;
uniform float uHeightOffset;
uniform float uSize;
uniform float uMorph;
uniform vec3 uParentUv;
uniform float uParentFade;
uniform vec2 uParentTexel;
uniform float uParentOffset;
uniform float uParentSize;
uniform vec3 cameraPosition;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uHillshadeZ;
uniform vec4 uHole;
uniform vec3 uHeightUv;
uniform float uHeightSize;
uniform sampler2D uImagery;
uniform sampler2D uParentImagery;
uniform float uImageryOn;
uniform vec3 uImageryUv;
uniform float uParentImageryOn;
uniform vec3 uParentImageryUv;
uniform float uImageryRelief;
varying vec2 vUv;
varying vec3 vWorld;
varying vec2 vLocal;
${HYPSO_GLSL}

#ifdef WEATHER
uniform vec3 uTileWorld;
uniform float uWxOn;
uniform vec4 uWxBounds;
uniform vec4 uWxMix;
uniform vec4 uWxOverlayRect;
uniform vec4 uWxCloudRect;
uniform sampler2D uWx;
uniform sampler2D uWxPrev;
uniform sampler2D uWxCape;
uniform sampler2D uWxOverlay;
uniform sampler2D uWxClouds;

float wxInside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }

// uWxMix = (temperature/rain fade, CAPE opacity, cloud shadow, draped cloud opacity).
vec3 applyWeather(vec3 base, vec2 w, vec4 cloud) {
  vec3 color = base * (1.0 - uWxMix.z * cloud.a);
  vec2 g = (w - uWxBounds.xy) / uWxBounds.zw;
  float inG = wxInside(g);
  vec2 gc = clamp(g, 0.0, 1.0);
  vec4 s = mix(texture2D(uWxPrev, gc), texture2D(uWx, gc), uWxMix.x) * inG;
  color = color * (1.0 - s.a) + s.rgb;
  vec4 cape = texture2D(uWxCape, gc);
  float level = floor(cape.a * 3.0 + 0.5) * inG;
  if (level > 0.5 && uWxMix.y > 0.0) {
    float spacing = level > 2.5 ? 5.0 : (level > 1.5 ? 8.0 : 11.0);
    float fill = level > 2.5 ? 0.4 : (level > 1.5 ? 0.26 : 0.12);
    float line = step(fract((gl_FragCoord.x + gl_FragCoord.y) / spacing), 0.3);
    color = mix(color, cape.rgb, mix(fill, 0.85, line) * uWxMix.y);
  }
  color = mix(color, cloud.rgb, cloud.a * uWxMix.w);
  vec2 o = (w - uWxOverlayRect.xy) / uWxOverlayRect.zw;
  vec4 ov = texture2D(uWxOverlay, clamp(o, 0.0, 1.0)) * wxInside(o);
  return color * (1.0 - ov.a) + ov.rgb;
}
#endif

float rawHeight(sampler2D t, vec2 texel, float offset, vec2 uv) {
  vec2 st = texel * 0.5 + clamp(uv, 0.0, 1.0) * (1.0 - texel);
  return texture2D(t, st).r + offset;
}

// shading.ts: central differences, sun from the NW at 45 degrees, slopes x uHillshadeZ.
// Returns (height, lambert); sea keeps the flat-ground lambert.
vec2 relief(sampler2D t, vec2 texel, float offset, float sizeKm, vec2 uv, float spread) {
  float h = rawHeight(t, texel, offset, uv);
  if (h <= 0.0) return vec2(h, 0.70710678);
  vec2 d = texel * spread;
  float hW = max(rawHeight(t, texel, offset, uv - vec2(d.x, 0.0)), 0.0);
  float hE = max(rawHeight(t, texel, offset, uv + vec2(d.x, 0.0)), 0.0);
  float hN = max(rawHeight(t, texel, offset, uv - vec2(0.0, d.y)), 0.0);
  float hS = max(rawHeight(t, texel, offset, uv + vec2(0.0, d.y)), 0.0);
  float spacing = 2.0 * sizeKm * 1000.0 * d.x;
  float dEast = (hE - hW) / spacing * uHillshadeZ;
  float dNorth = (hN - hS) / spacing * uHillshadeZ;
  float lambert = max(0.0, (0.5 * dEast - 0.5 * dNorth + 0.70710678) / length(vec3(dEast, dNorth, 1.0)));
  return vec2(h, lambert);
}

// Imagery already has baked shadows: flat ground keeps it unchanged (0.3 + 0.99 * 0.7071 = 1).
vec3 colorOf(vec2 r, float imageryOn, vec3 img) {
  if (imageryOn > 0.5) return r.x <= 0.0 ? img : img * mix(1.0, 0.3 + 0.99 * r.y, uImageryRelief);
  vec3 c = hypsometric(r.x);
  if (r.x <= 0.0) return c;
  return c * (0.3 + 0.85 * r.y);
}

void main(void) {
  // Sampled first and unconditionally: mipmap derivatives need uniform control flow.
  vec3 img = texture2D(uImagery, uImageryUv.xy + vUv * uImageryUv.z).rgb;
  vec3 parentImg = texture2D(uParentImagery, uParentImageryUv.xy + vUv * uParentImageryUv.z).rgb;
#ifdef WEATHER
  vec2 wxWorld = uTileWorld.xy + vUv * uTileWorld.z;
  vec2 wxCloudUv = (wxWorld - uWxCloudRect.xy) / uWxCloudRect.zw;
  vec4 wxCloud = texture2D(uWxClouds, clamp(wxCloudUv, 0.0, 1.0)) * wxInside(wxCloudUv);
#endif
#ifdef CONTEXT
  if (vLocal.x > uHole.x && vLocal.x < uHole.z && vLocal.y > uHole.y && vLocal.y < uHole.w) discard;
#endif
  // Normals follow the geomorph: at morph 0 the differences span the parent's texel spacing.
  vec3 color = colorOf(relief(uHeight, uHeightTexel, uHeightOffset, uHeightSize, uHeightUv.xy + vUv * uHeightUv.z, 2.0 - uMorph), uImageryOn, img);
  if (uParentFade > 0.0) {
    vec3 parent = colorOf(relief(uParentHeight, uParentTexel, uParentOffset, uParentSize, uParentUv.xy + vUv * uParentUv.z, 1.0), uParentImageryOn, parentImg);
    color = mix(color, parent, uParentFade);
  }
#ifdef WEATHER
  if (uWxOn > 0.5) color = applyWeather(color, wxWorld, wxCloud);
#endif
  float f = 1.0 - exp(-pow(length(vWorld - cameraPosition) * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(color, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}`;

const VERTEX_WGSL = `attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform uOrigin: vec2f;
uniform uSize: f32;
uniform uSegments: f32;
uniform uMorph: f32;
uniform uHeightTexel: vec2f;
uniform uHeightOffset: f32;
uniform uExaggeration: f32;
uniform uSkirtDepth: f32;
uniform uHeightUv: vec3f;
var uHeightSampler: sampler;
var uHeight: texture_2d<f32>;
varying vUv: vec2f;
varying vWorld: vec3f;
varying vLocal: vec2f;

fn heightAt(uv: vec2f) -> f32 {
  let st = uniforms.uHeightTexel * 0.5 + (uniforms.uHeightUv.xy + uv * uniforms.uHeightUv.z) * (vec2f(1.0) - uniforms.uHeightTexel);
  return max(textureSampleLevel(uHeight, uHeightSampler, st, 0.0).r + uniforms.uHeightOffset, 0.0);
}

fn coarseHeightAt(uv: vec2f, fine: f32) -> f32 {
  let odd = floor(uv * uniforms.uSegments + vec2f(0.5)) % vec2f(2.0);
  let s = 1.0 / uniforms.uSegments;
  if (odd.x > 0.5 && odd.y > 0.5) { return 0.5 * (heightAt(uv + vec2f(s, -s)) + heightAt(uv + vec2f(-s, s))); }
  if (odd.x > 0.5) { return 0.5 * (heightAt(uv - vec2f(s, 0.0)) + heightAt(uv + vec2f(s, 0.0))); }
  if (odd.y > 0.5) { return 0.5 * (heightAt(uv - vec2f(0.0, s)) + heightAt(uv + vec2f(0.0, s))); }
  return fine;
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let uv = vertexInputs.position.xz;
  let fine = heightAt(uv);
  var h = fine;
  if (uniforms.uMorph < 1.0) { h = mix(coarseHeightAt(uv, fine), fine, uniforms.uMorph); }
  let y = h * 0.001 * uniforms.uExaggeration - vertexInputs.position.y * uniforms.uSkirtDepth;
  let local = vec3f(uniforms.uOrigin.x + uv.x * uniforms.uSize, y, uniforms.uOrigin.y - uv.y * uniforms.uSize);
  vertexOutputs.vUv = uv;
  vertexOutputs.vLocal = local.xz;
#ifdef CONTEXT
  let placed = uniforms.world * vec4f(local, 1.0);
  vertexOutputs.vWorld = placed.xyz;
  vertexOutputs.position = uniforms.viewProjection * placed;
#else
  vertexOutputs.vWorld = local;
  vertexOutputs.position = uniforms.viewProjection * vec4f(local, 1.0);
#endif
}`;

const FRAGMENT_WGSL = `uniform uHeightTexel: vec2f;
uniform uHeightOffset: f32;
uniform uSize: f32;
uniform uMorph: f32;
uniform uParentUv: vec3f;
uniform uParentFade: f32;
uniform uParentTexel: vec2f;
uniform uParentOffset: f32;
uniform uParentSize: f32;
uniform cameraPosition: vec3f;
uniform uFogColor: vec3f;
uniform uFogDensity: f32;
uniform uHillshadeZ: f32;
uniform uHole: vec4f;
uniform uHeightUv: vec3f;
uniform uHeightSize: f32;
uniform uImageryOn: f32;
uniform uImageryUv: vec3f;
uniform uParentImageryOn: f32;
uniform uParentImageryUv: vec3f;
uniform uImageryRelief: f32;
var uHeightSampler: sampler;
var uHeight: texture_2d<f32>;
var uParentHeightSampler: sampler;
var uParentHeight: texture_2d<f32>;
var uImagerySampler: sampler;
var uImagery: texture_2d<f32>;
var uParentImagerySampler: sampler;
var uParentImagery: texture_2d<f32>;
varying vUv: vec2f;
varying vWorld: vec3f;
varying vLocal: vec2f;

#ifdef WEATHER
uniform uTileWorld: vec3f;
uniform uWxOn: f32;
uniform uWxBounds: vec4f;
uniform uWxMix: vec4f;
uniform uWxOverlayRect: vec4f;
uniform uWxCloudRect: vec4f;
var uWxSampler: sampler;
var uWx: texture_2d<f32>;
var uWxPrevSampler: sampler;
var uWxPrev: texture_2d<f32>;
var uWxCapeSampler: sampler;
var uWxCape: texture_2d<f32>;
var uWxOverlaySampler: sampler;
var uWxOverlay: texture_2d<f32>;
var uWxCloudsSampler: sampler;
var uWxClouds: texture_2d<f32>;

fn wxInside(uv: vec2f) -> f32 { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }

fn applyWeather(base: vec3f, w: vec2f, cloud: vec4f, frag: vec2f) -> vec3f {
  var color = base * (1.0 - uniforms.uWxMix.z * cloud.a);
  let g = (w - uniforms.uWxBounds.xy) / uniforms.uWxBounds.zw;
  let inG = wxInside(g);
  let gc = clamp(g, vec2f(0.0), vec2f(1.0));
  let s = mix(textureSampleLevel(uWxPrev, uWxPrevSampler, gc, 0.0), textureSampleLevel(uWx, uWxSampler, gc, 0.0), uniforms.uWxMix.x) * inG;
  color = color * (1.0 - s.a) + s.rgb;
  let cape = textureSampleLevel(uWxCape, uWxCapeSampler, gc, 0.0);
  let level = floor(cape.a * 3.0 + 0.5) * inG;
  if (level > 0.5 && uniforms.uWxMix.y > 0.0) {
    var spacing = 11.0;
    var fill = 0.12;
    if (level > 1.5) { spacing = 8.0; fill = 0.26; }
    if (level > 2.5) { spacing = 5.0; fill = 0.4; }
    let line = step(fract((frag.x + frag.y) / spacing), 0.3);
    color = mix(color, cape.rgb, mix(fill, 0.85, line) * uniforms.uWxMix.y);
  }
  color = mix(color, cloud.rgb, cloud.a * uniforms.uWxMix.w);
  let o = (w - uniforms.uWxOverlayRect.xy) / uniforms.uWxOverlayRect.zw;
  let ov = textureSampleLevel(uWxOverlay, uWxOverlaySampler, clamp(o, vec2f(0.0), vec2f(1.0)), 0.0) * wxInside(o);
  return color * (1.0 - ov.a) + ov.rgb;
}
#endif

fn hypsometric(h: f32) -> vec3f {
  if (h <= 0.0) { return mix(vec3f(0.10, 0.26, 0.42), vec3f(0.04, 0.12, 0.24), clamp(-h / 3000.0, 0.0, 1.0)); }
  var c = vec3f(0.16, 0.42, 0.22);
  c = mix(c, vec3f(0.38, 0.55, 0.28), smoothstep(0.0, 600.0, h));
  c = mix(c, vec3f(0.62, 0.60, 0.36), smoothstep(600.0, 1800.0, h));
  c = mix(c, vec3f(0.62, 0.48, 0.34), smoothstep(1800.0, 3200.0, h));
  c = mix(c, vec3f(0.50, 0.42, 0.38), smoothstep(3200.0, 4300.0, h));
  c = mix(c, vec3f(0.93, 0.94, 0.96), smoothstep(4700.0, 5400.0, h));
  return c;
}

fn rawHeight(t: texture_2d<f32>, s: sampler, texel: vec2f, offset: f32, uv: vec2f) -> f32 {
  let st = texel * 0.5 + clamp(uv, vec2f(0.0), vec2f(1.0)) * (vec2f(1.0) - texel);
  return textureSampleLevel(t, s, st, 0.0).r + offset;
}

fn relief(t: texture_2d<f32>, s: sampler, texel: vec2f, offset: f32, sizeKm: f32, uv: vec2f, spread: f32) -> vec2f {
  let h = rawHeight(t, s, texel, offset, uv);
  if (h <= 0.0) { return vec2f(h, 0.70710678); }
  let d = texel * spread;
  let hW = max(rawHeight(t, s, texel, offset, uv - vec2f(d.x, 0.0)), 0.0);
  let hE = max(rawHeight(t, s, texel, offset, uv + vec2f(d.x, 0.0)), 0.0);
  let hN = max(rawHeight(t, s, texel, offset, uv - vec2f(0.0, d.y)), 0.0);
  let hS = max(rawHeight(t, s, texel, offset, uv + vec2f(0.0, d.y)), 0.0);
  let spacing = 2.0 * sizeKm * 1000.0 * d.x;
  let dEast = (hE - hW) / spacing * uniforms.uHillshadeZ;
  let dNorth = (hN - hS) / spacing * uniforms.uHillshadeZ;
  let lambert = max(0.0, (0.5 * dEast - 0.5 * dNorth + 0.70710678) / length(vec3f(dEast, dNorth, 1.0)));
  return vec2f(h, lambert);
}

fn colorOf(r: vec2f, imageryOn: f32, img: vec3f) -> vec3f {
  if (imageryOn > 0.5) {
    if (r.x <= 0.0) { return img; }
    return img * mix(1.0, 0.3 + 0.99 * r.y, uniforms.uImageryRelief);
  }
  let c = hypsometric(r.x);
  if (r.x <= 0.0) { return c; }
  return c * (0.3 + 0.85 * r.y);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUv;
  // Sampled first and unconditionally: mipmap derivatives need uniform control flow.
  let img = textureSample(uImagery, uImagerySampler, uniforms.uImageryUv.xy + uv * uniforms.uImageryUv.z).rgb;
  let parentImg = textureSample(uParentImagery, uParentImagerySampler, uniforms.uParentImageryUv.xy + uv * uniforms.uParentImageryUv.z).rgb;
#ifdef WEATHER
  let wxWorld = uniforms.uTileWorld.xy + uv * uniforms.uTileWorld.z;
  let wxCloudUv = (wxWorld - uniforms.uWxCloudRect.xy) / uniforms.uWxCloudRect.zw;
  let wxCloud = textureSample(uWxClouds, uWxCloudsSampler, clamp(wxCloudUv, vec2f(0.0), vec2f(1.0))) * wxInside(wxCloudUv);
#endif
#ifdef CONTEXT
  let lp = fragmentInputs.vLocal;
  if (lp.x > uniforms.uHole.x && lp.x < uniforms.uHole.z && lp.y > uniforms.uHole.y && lp.y < uniforms.uHole.w) { discard; }
#endif
  let hUv = uniforms.uHeightUv.xy + uv * uniforms.uHeightUv.z;
  var color = colorOf(relief(uHeight, uHeightSampler, uniforms.uHeightTexel, uniforms.uHeightOffset, uniforms.uHeightSize, hUv, 2.0 - uniforms.uMorph),
    uniforms.uImageryOn, img);
  if (uniforms.uParentFade > 0.0) {
    let parent = colorOf(relief(uParentHeight, uParentHeightSampler, uniforms.uParentTexel, uniforms.uParentOffset, uniforms.uParentSize,
      uniforms.uParentUv.xy + uv * uniforms.uParentUv.z, 1.0), uniforms.uParentImageryOn, parentImg);
    color = mix(color, parent, uniforms.uParentFade);
  }
#ifdef WEATHER
  if (uniforms.uWxOn > 0.5) { color = applyWeather(color, wxWorld, wxCloud, fragmentInputs.position.xy); }
#endif
  let f = 1.0 - exp(-pow(length(fragmentInputs.vWorld - uniforms.cameraPosition) * uniforms.uFogDensity, 2.0));
  fragmentOutputs.color = vec4f(mix(color, uniforms.uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}`;

let registered = false;
function register(): void {
  if (registered) return;
  registered = true;
  ShaderStore.ShadersStore[`${NAME}VertexShader`] = VERTEX_GLSL;
  ShaderStore.ShadersStore[`${NAME}FragmentShader`] = FRAGMENT_GLSL;
  ShaderStore.ShadersStoreWGSL[`${NAME}VertexShader`] = VERTEX_WGSL;
  ShaderStore.ShadersStoreWGSL[`${NAME}FragmentShader`] = FRAGMENT_WGSL;
}

export interface TerrainLook {
  exaggeration: number;
  fogColor: Color3;
  fogDensity: number;
  hillshadeZ: number;
}

/** Hillshade strength over satellite imagery (0 = imagery only, 1 = full relief lighting): subtle. */
export const IMAGERY_RELIEF = 0.5;

/** No hole: min > max never contains a point. */
export const NO_HOLE: readonly [number, number, number, number] = [1, 1, -1, -1];

/**
 * One material per drawn tile (pooled): per-tile uniforms cannot be shared on WebGPU.
 * `context`: CONTEXT variant (world matrix + hole), `weather`: WEATHER variant, see the header
 * (its textures and uniforms are bound by the renderer).
 */
export function createTileMaterial(scene: Scene, id: number, segments: number, look: TerrainLook, dummy: BaseTexture, dummyImagery: BaseTexture, context = false, weather = false): ShaderMaterial {
  register();
  const opts = tileMaterialOptions(context, weather);
  const m = new ShaderMaterial(`peru-tile-${id}`, scene, { vertex: NAME, fragment: NAME }, {
    attributes: ['position'],
    uniforms: opts.uniforms,
    samplers: opts.samplers,
    defines: opts.defines,
    shaderLanguage: scene.getEngine().isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  });
  m.setVector4('uHole', new Vector4(...NO_HOLE));
  m.backFaceCulling = false;
  m.setFloat('uSegments', segments);
  m.setFloat('uMorph', 1);
  m.setVector3('uParentUv', new Vector3(0, 0, 1));
  m.setFloat('uParentFade', 0);
  m.setVector2('uParentTexel', new Vector2(0.5, 0.5));
  m.setFloat('uParentOffset', 0);
  m.setFloat('uParentSize', 1);
  m.setTexture('uHeight', dummy);
  m.setTexture('uParentHeight', dummy);
  m.setVector3('uHeightUv', new Vector3(0, 0, 1));
  m.setFloat('uHeightSize', 1);
  m.setTexture('uImagery', dummyImagery);
  m.setTexture('uParentImagery', dummyImagery);
  m.setFloat('uImageryOn', 0);
  m.setFloat('uParentImageryOn', 0);
  m.setVector3('uImageryUv', new Vector3(0, 0, 1));
  m.setVector3('uParentImageryUv', new Vector3(0, 0, 1));
  m.setFloat('uImageryRelief', IMAGERY_RELIEF);
  applyLook(m, look);
  return m;
}

export function applyLook(m: ShaderMaterial, look: TerrainLook): void {
  m.setFloat('uExaggeration', look.exaggeration);
  m.setColor3('uFogColor', look.fogColor);
  m.setFloat('uFogDensity', look.fogDensity);
  m.setFloat('uHillshadeZ', look.hillshadeZ);
}
