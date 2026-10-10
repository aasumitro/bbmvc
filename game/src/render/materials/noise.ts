// Shared GLSL noise. Every function takes uv in [0, 1) and an integer cell
// count, and wraps its lattice at the tile edge, so baked textures tile
// seamlessly. Hashes are sine-free (Dave Hoskins) to stay stable across GPUs.
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Gradient noise whose lattice repeats every period cells. Range ~[-1, 1].
float noise(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(mod(i, period)) * 2.0 - 1.0, f);
  float b = dot(hash22(mod(i + vec2(1.0, 0.0), period)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(mod(i + vec2(0.0, 1.0), period)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(mod(i + vec2(1.0, 1.0), period)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return 1.6 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Tileable fBm. Mostly within [-0.6, 0.6]; 0 is the mean.
float fbm(vec2 uv, float cells, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * noise(uv * cells, vec2(cells));
    total += amp;
    cells *= 2.0;
    amp *= 0.5;
  }
  return sum / total;
}

// Tileable Voronoi. x = distance to the nearest feature point (cell units),
// y = random id of that cell, z = distance to the nearest cell border.
vec3 voronoi(vec2 uv, float cells) {
  vec2 p = uv * cells;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cell = mod(i + o, vec2(cells));
      float d = length(o + hash22(cell) - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash12(cell + 17.0);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3(f1, id, (f2 - f1) * 0.5);
}

// Thin straight scratches, one per cell at a random angle. Returns 0..1 coverage.
float scratches(vec2 uv, float cells, float width, float seed) {
  vec2 p = uv * cells;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float coverage = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cell = mod(i + o, vec2(cells));
      vec2 h = hash22(cell + seed);
      if (h.y > 0.6) continue;
      vec2 dir = vec2(cos(h.x * 6.2832), sin(h.x * 6.2832));
      vec2 rel = f - o - hash22(cell + seed + 7.3);
      float t = clamp(dot(rel, dir), -0.8, 0.8);
      float d = length(rel - dir * t);
      coverage = max(coverage, 1.0 - smoothstep(0.0, width * cells, d));
    }
  }
  return coverage;
}
`
