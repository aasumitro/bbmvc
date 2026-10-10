import * as THREE from 'three'

// A tileable surface described in GLSL: `Surface surface(vec2 uv)` returns
// albedo (linear), height (metres), roughness, metalness and occlusion for a
// uv in [0, 1). bake.ts renders it once into textures; nothing here runs per frame.
export interface SurfaceRecipe {
  key: string
  glsl: string
  uniforms: Record<string, THREE.IUniform>
  size: number // bake resolution in texels
  tile: number // metres covered by one texture tile
}

const color = (hex: string) => ({ value: new THREE.Color(hex) })
const float = (value: number) => ({ value })

export interface PlatingOptions {
  paint: string
  patch: string // second paint: blotches and mismatched salvage plates
  bare?: string // tint of exposed metal
  rust?: number // 0..1
  wear?: number // 0..1 paint loss
  rows?: number // plate rows per tile
  rivets?: boolean
  size?: number
}

// Riveted armour plates: seams, warped plates, chipped paint, rust bleeding through.
export function plating({ paint, patch, bare = '#8a8680', rust = 0.5, wear = 0.5, rows = 6, rivets = true, size = 1024 }: PlatingOptions): SurfaceRecipe {
  return {
    key: `plating:${paint}:${patch}:${bare}:${rust}:${wear}:${rows}:${rivets}:${size}`,
    size,
    tile: 3,
    uniforms: {
      uPaint: color(paint),
      uPatch: color(patch),
      uBare: color(bare),
      uRust: float(rust),
      uWear: float(wear),
      uRows: float(rows),
      uRivets: float(rivets ? 1 : 0),
    },
    glsl: /* glsl */ `
      uniform vec3 uPaint;
      uniform vec3 uPatch;
      uniform vec3 uBare;
      uniform float uRust;
      uniform float uWear;
      uniform float uRows;
      uniform float uRivets;

      const float RIVET_RADIUS = 0.017;

      // Distance to the nearest rivet; rivets run along each plate border.
      float rivetDistance(vec2 pm, vec2 size) {
        const float spacing = 0.11;
        const float inset = 0.035;
        vec2 pitch = size / max(vec2(1.0), floor(size / spacing));
        vec2 r = (floor(pm / pitch) + 0.5) * pitch;
        float d = min(length(pm - vec2(r.x, inset)), length(pm - vec2(r.x, size.y - inset)));
        return min(d, min(length(pm - vec2(inset, r.y)), length(pm - vec2(size.x - inset, r.y))));
      }

      Surface surface(vec2 uv) {
        // Brick layout: uRows rows per tile, 2-4 plates per row, random row offset.
        float row = floor(uv.y * uRows);
        float cols = 2.0 + floor(hash12(vec2(row, 1.7)) * 3.0);
        float gx = uv.x * cols + hash12(vec2(row, 9.1));
        vec2 plate = vec2(mod(floor(gx), cols), row);
        vec2 size = vec2(uTile / cols, uTile / uRows);
        vec2 pm = vec2(fract(gx), fract(uv.y * uRows)) * size;
        float edge = min(min(pm.x, size.x - pm.x), min(pm.y, size.y - pm.y));
        float plateRand = hash12(plate + 4.3);

        // Relief: seams, slightly warped plates, dents, rivet domes.
        float seam = 1.0 - smoothstep(0.002, 0.009, edge);
        vec2 tilt = hash22(plate + 2.2) - 0.5;
        float rd = rivetDistance(pm, size);
        float rivet = uRivets * sqrt(max(0.0, 1.0 - rd * rd / (RIVET_RADIUS * RIVET_RADIUS)));
        float h = -seam * 0.003 + dot(pm - size * 0.5, tilt) * 0.006 + fbm(uv, 4.0, 4) * 0.0025 + rivet * 0.007;

        // Metal under the paint, going from bare steel to rust.
        float rustAmt = smoothstep(0.7 - uRust * 0.45, 0.78 - uRust * 0.45, fbm(uv + 0.31, 6.0, 5) + 0.5);
        vec3 rust = mix(RUST_DARK, RUST_LIGHT, clamp(fbm(uv, 24.0, 4) * 0.9 + 0.5, 0.0, 1.0));
        vec3 metal = mix(uBare, rust, rustAmt);

        // Paint: salvaged plates differ slightly, blotches in the second colour.
        vec3 paint = uPaint * (0.8 + 0.4 * plateRand);
        float blotch = smoothstep(0.03, 0.08, fbm(uv + 0.71, 3.0, 5));
        paint = mix(paint, uPatch, max(blotch, step(0.84, plateRand)));

        // Paint loss concentrates along seams and around rivets.
        float exposed = max(1.0 - smoothstep(0.0, 0.05, edge), uRivets * (1.0 - smoothstep(RIVET_RADIUS, RIVET_RADIUS * 2.4, rd)));
        float threshold = 1.0 - uWear * (0.3 + 0.6 * exposed);
        float chip = smoothstep(threshold, threshold + 0.03, fbm(uv + 0.13, 20.0, 5) + 0.5);
        float bare = max(chip, step(plateRand, 0.08));

        // Rust runs down from chips; grime settles low on each plate and in seams.
        float streak = smoothstep(0.15, 0.7, noise(vec2(uv.x * 48.0, uv.y * 4.0), vec2(48.0, 4.0))) * uRust;
        paint = mix(paint, rust * 1.3, streak * 0.55);
        float grime = clamp(smoothstep(0.3, 0.0, pm.y / size.y) * 0.4 + seam * 0.6 + fbm(uv + 0.5, 5.0, 4), 0.0, 1.0);
        float scratch = scratches(uv, 14.0, 0.0005, 3.0) * (1.0 - bare);

        vec3 albedo = mix(paint, metal, bare);
        albedo = mix(albedo, uBare * 1.3, scratch);
        albedo = mix(albedo, GRIME, grime * 0.65);
        float roughness = mix(0.5 + 0.15 * (fbm(uv, 12.0, 3) + 0.5), mix(0.38, 0.9, rustAmt), bare);
        roughness = mix(mix(roughness, 0.3, scratch), 0.92, grime * 0.4);
        float metalness = max(bare * mix(1.0, 0.2, rustAmt), scratch);
        float ao = 1.0 - seam * 0.5 - uRivets * (1.0 - smoothstep(RIVET_RADIUS, RIVET_RADIUS * 1.6, rd)) * (1.0 - rivet) * 0.35;
        return Surface(albedo, h + (1.0 - bare) * 0.0003, roughness, metalness, ao);
      }
    `,
  }
}

export interface SteelOptions {
  bare?: string
  rust?: number // 0..1
  stripes?: [string, string] // diagonal hazard paint
  holes?: number // perforations per tile (even), 0 = solid sheet
  size?: number
}

// Bare steel for frames, tubes, blades and rims: mill-scale variation, rust
// pitting, scratches; optionally hazard-striped or perforated.
export function steel({ bare = '#6f6b66', rust = 0.4, stripes, holes = 0, size = 1024 }: SteelOptions = {}): SurfaceRecipe {
  return {
    key: `steel:${bare}:${rust}:${stripes?.join(',') ?? ''}:${holes}:${size}`,
    size,
    tile: 2,
    uniforms: {
      uBare: color(bare),
      uRust: float(rust),
      uStripeA: color(stripes?.[0] ?? '#000000'),
      uStripeB: color(stripes?.[1] ?? '#000000'),
      uStripes: float(stripes ? 10 : 0),
      uHoles: float(holes),
    },
    glsl: /* glsl */ `
      uniform vec3 uBare;
      uniform float uRust;
      uniform vec3 uStripeA;
      uniform vec3 uStripeB;
      uniform float uStripes;
      uniform float uHoles;

      Surface surface(vec2 uv) {
        vec3 steel = uBare * (0.7 + 0.6 * (fbm(uv, 10.0, 4) + 0.5));
        float rustAmt = smoothstep(0.7 - uRust * 0.5, 0.8 - uRust * 0.5, fbm(uv + 0.47, 5.0, 6) + 0.5 + fbm(uv, 40.0, 4) * 0.3);
        vec3 pits = voronoi(uv, 80.0);
        vec3 rust = mix(RUST_DARK, RUST_LIGHT, clamp(fbm(uv + 0.2, 30.0, 4) + 0.5, 0.0, 1.0));
        rust *= (0.55 + 0.6 * smoothstep(0.0, 0.5, pits.x)) * (0.8 + 0.4 * (fbm(uv + 0.8, 10.0, 3) + 0.5));
        float h = fbm(uv, 12.0, 4) * 0.0015 + rustAmt * (0.0008 - (1.0 - smoothstep(0.0, 0.35, pits.x)) * 0.0012);

        vec3 albedo = mix(steel, rust, rustAmt);
        float roughness = mix(0.3 + 0.25 * (fbm(uv, 16.0, 3) + 0.5), 0.88, rustAmt);
        float metalness = mix(1.0, 0.15, rustAmt);
        float ao = 1.0;

        if (uStripes > 0.0) {
          vec3 stripe = mix(uStripeA, uStripeB, step(0.5, fract((uv.x + uv.y) * uStripes)));
          float chip = smoothstep(0.7 - uRust * 0.25, 0.74 - uRust * 0.25, fbm(uv + 0.9, 16.0, 5) + 0.5);
          float paint = 1.0 - max(chip, rustAmt * 0.8);
          albedo = mix(albedo, stripe * (0.85 + 0.3 * (fbm(uv, 6.0, 3) + 0.5)), paint);
          roughness = mix(roughness, 0.6, paint);
          metalness *= 1.0 - paint;
          h += paint * 0.0003;
        }

        float scratch = scratches(uv, 16.0, 0.0005, 1.0) * (1.0 - rustAmt);
        albedo = mix(albedo, uBare * 1.5, scratch);
        roughness = mix(roughness, 0.25, scratch);
        metalness = mix(metalness, 1.0, scratch);

        if (uHoles > 0.0) {
          vec2 g = uv * uHoles;
          g.x += 0.5 * mod(floor(g.y), 2.0);
          float hole = 1.0 - smoothstep(0.27, 0.3, length(fract(g) - 0.5));
          albedo = mix(albedo, vec3(0.004), hole);
          h -= hole * 0.006;
          roughness = mix(roughness, 1.0, hole);
          metalness *= 1.0 - hole;
          ao = mix(ao, 0.1, hole);
        }
        return Surface(albedo, h, roughness, metalness, ao);
      }
    `,
  }
}

export interface CorrugatedOptions {
  paint: string
  rust?: number
  size?: number
}

// Corrugated sheet (containers, sheds, fences): ribs along u, sun-bleached
// ridges, dirt in the valleys, rust streaks.
export function corrugated({ paint, rust = 0.5, size = 1024 }: CorrugatedOptions): SurfaceRecipe {
  return {
    key: `corrugated:${paint}:${rust}:${size}`,
    size,
    tile: 4,
    uniforms: { uPaint: color(paint), uRust: float(rust), uRibs: float(15) },
    glsl: /* glsl */ `
      uniform vec3 uPaint;
      uniform float uRust;
      uniform float uRibs;

      Surface surface(vec2 uv) {
        float f = fract(uv.x * uRibs);
        float rib = smoothstep(0.08, 0.22, f) - smoothstep(0.58, 0.72, f);
        float h = rib * 0.028 + fbm(uv, 3.0, 4) * 0.008 + fbm(uv, 24.0, 3) * 0.0004;

        vec3 paint = uPaint * (0.8 + 0.3 * rib) * (0.85 + 0.3 * (fbm(uv + 0.4, 4.0, 4) + 0.5));
        float streak = smoothstep(0.1, 0.7, noise(vec2(uv.x * 64.0, uv.y * 3.0), vec2(64.0, 3.0)));
        // rust runs down the ribs in streaks more than it blooms in patches
        float rustAmt = smoothstep(0.76 - uRust * 0.35, 0.82 - uRust * 0.35, fbm(uv + 0.21, 6.0, 5) * 0.6 + 0.5 + streak * 0.35 * uRust);
        vec3 rust = mix(RUST_DARK, RUST_LIGHT, clamp(fbm(uv, 28.0, 4) + 0.5, 0.0, 1.0));
        float chip = smoothstep(0.76, 0.8, fbm(uv + 0.6, 18.0, 5) + 0.5 + rib * 0.08);
        float bare = max(rustAmt, chip);
        float grime = clamp(fbm(uv + 0.8, 3.0, 4) + 0.3, 0.0, 1.0) * (1.0 - rib);

        vec3 albedo = mix(paint, rust, bare);
        albedo = mix(albedo, rust * 1.3, streak * uRust * 0.45 * (1.0 - bare));
        albedo = mix(albedo, GRIME, grime * 0.55);
        float roughness = mix(mix(0.55, 0.88, bare), 0.95, grime * 0.5);
        return Surface(albedo, h, roughness, bare * 0.25, 1.0 - (1.0 - rib) * 0.25);
      }
    `,
  }
}

export interface ConcreteOptions {
  tint?: string
  stripe?: string // diagonal painted stripes, e.g. on barriers
  cracks?: number // 0..1, how much of the surface has cracked
}

// Cast concrete: pores, hairline cracks, water stains; optional painted stripes.
export function concrete({ tint = '#8d8983', stripe, cracks = 1 }: ConcreteOptions = {}): SurfaceRecipe {
  return {
    key: `concrete:${tint}:${stripe ?? ''}:${cracks}`,
    size: 1024,
    tile: 3,
    uniforms: { uTint: color(tint), uStripe: color(stripe ?? '#000000'), uStripes: float(stripe ? 6 : 0), uCracks: float(cracks) },
    glsl: /* glsl */ `
      uniform vec3 uTint;
      uniform vec3 uStripe;
      uniform float uStripes;
      uniform float uCracks;

      Surface surface(vec2 uv) {
        float large = fbm(uv, 3.0, 5);
        float fine = fbm(uv, 48.0, 3);
        vec3 pores = voronoi(uv, 140.0);
        float pore = (1.0 - smoothstep(0.0, 0.18, pores.x)) * step(0.65, pores.y);
        float crack = (1.0 - smoothstep(0.0, 0.015, voronoi(uv, 5.0).z)) * smoothstep(0.0, 0.2, fbm(uv + 0.3, 6.0, 4) + 0.1 - (1.0 - uCracks) * 0.4);
        float stain = smoothstep(0.1, 0.5, noise(vec2(uv.x * 40.0, uv.y * 3.0), vec2(40.0, 3.0))) * 0.35;

        float h = large * 0.004 + fine * 0.0008 - pore * 0.0015 - crack * 0.003;
        vec3 albedo = uTint * (0.8 + 0.35 * (large + 0.5)) * (0.92 + 0.16 * (fine + 0.5));
        albedo *= (1.0 - pore * 0.4 - crack * 0.6) * (1.0 - stain * 0.45);
        float roughness = 0.88 + fine * 0.1;

        if (uStripes > 0.0) {
          float wear = smoothstep(0.62, 0.68, fbm(uv + 0.5, 14.0, 5) + 0.5 + crack);
          float paint = step(0.5, fract((uv.x - uv.y) * uStripes)) * (1.0 - wear);
          albedo = mix(albedo, uStripe * (0.8 + 0.4 * (large + 0.5)), paint);
          roughness = mix(roughness, 0.7, paint);
        }
        return Surface(albedo, h, roughness, 0.0, 1.0 - crack * 0.6 - pore * 0.4);
      }
    `,
  }
}

// Tyre rubber with dried dust.
export function rubber(): SurfaceRecipe {
  return {
    key: 'rubber',
    size: 512,
    tile: 1,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        float dust = smoothstep(0.0, 0.35, fbm(uv + 0.5, 4.0, 5) + 0.1);
        float h = fbm(uv, 64.0, 3) * 0.0006 + dust * 0.0008;
        vec3 albedo = mix(vec3(0.021) * (0.85 + 0.3 * (fbm(uv, 12.0, 4) + 0.5)), vec3(0.12, 0.09, 0.065), dust * 0.7);
        return Surface(albedo, h, mix(0.8, 0.95, dust), 0.0, 1.0);
      }
    `,
  }
}

// Packed arena dirt with stones and pebbles. Wetness is applied on top per
// pixel by the ground material, not baked here.
export function mud(): SurfaceRecipe {
  return {
    key: 'mud',
    size: 1024,
    tile: 5,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        float large = fbm(uv, 3.0, 6);
        float mid = fbm(uv + 0.37, 12.0, 4);
        vec3 stones = voronoi(uv, 60.0);
        float stone = step(0.95, stones.y) * (1.0 - smoothstep(0.2, 0.42, stones.x));
        vec3 pebbles = voronoi(uv + 0.5, 180.0);
        float pebble = step(0.85, pebbles.y) * (1.0 - smoothstep(0.15, 0.35, pebbles.x));
        float h = large * 0.02 + mid * 0.008 + fbm(uv, 96.0, 2) * 0.0015 + stone * 0.006 + pebble * 0.0015;

        vec3 albedo = mix(vec3(0.045, 0.031, 0.022), vec3(0.1, 0.066, 0.043), smoothstep(-0.3, 0.35, large + mid * 0.5));
        albedo = mix(albedo, vec3(0.07, 0.062, 0.055) * (0.5 + 0.6 * stones.y), stone);
        albedo = mix(albedo, vec3(0.07, 0.06, 0.05), pebble * 0.5);
        float ao = 1.0 - clamp(-large * 1.5, 0.0, 0.35) - pebble * 0.08;
        return Surface(albedo, h, 0.95, 0.0, ao);
      }
    `,
  }
}

// --- city surfaces ------------------------------------------------------------

// Road asphalt: bitumen with stone aggregate, hairline cracks, tar-sealed
// crack lines. Wetness comes from the ground layout, as with the yard mud.
export function asphalt(): SurfaceRecipe {
  return {
    key: 'asphalt',
    size: 1024,
    tile: 4,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        float large = fbm(uv, 3.0, 5);
        float mid = fbm(uv + 0.29, 16.0, 4);
        vec3 grit = voronoi(uv, 240.0);
        float stone = step(0.55, grit.y) * (1.0 - smoothstep(0.15, 0.45, grit.x));
        // cracks and the tar that seals them only run where the surface has aged: a few long lines, not a web
        float crack = (1.0 - smoothstep(0.0, 0.006, voronoi(uv + 0.17, 3.0).z)) * smoothstep(0.2, 0.35, fbm(uv + 0.6, 2.0, 4));
        float sealed = (1.0 - smoothstep(0.0, 0.02, voronoi(uv + 0.51, 2.0).z)) * smoothstep(0.22, 0.3, fbm(uv + 0.9, 2.0, 3));
        float h = large * 0.004 + mid * 0.001 + stone * 0.0015 - crack * 0.002 + sealed * 0.0005;
        vec3 albedo = mix(vec3(0.03, 0.029, 0.028), vec3(0.065, 0.062, 0.058), smoothstep(-0.35, 0.35, large + mid * 0.6));
        albedo = mix(albedo, vec3(0.12, 0.115, 0.108) * (0.7 + 0.6 * grit.y), stone * 0.8);
        albedo *= 1.0 - crack * 0.6;
        albedo = mix(albedo, vec3(0.012), sealed * 0.9);
        float roughness = mix(0.9 - stone * 0.15, 0.6, sealed);
        return Surface(albedo, h, roughness, 0.0, 1.0 - crack * 0.5);
      }
    `,
  }
}

// Sidewalk: 1.5 m cast slabs, each settled at its own tilt, with joints,
// pores, old gum and the odd crack.
export function pavement(): SurfaceRecipe {
  return {
    key: 'pavement',
    size: 1024,
    tile: 3,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        vec2 g = uv * 2.0;
        vec2 slab = mod(floor(g), 2.0);
        vec2 f = fract(g);
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.5;
        float joint = 1.0 - smoothstep(0.004, 0.012, edge);
        float r = hash12(slab + 3.1);
        vec2 tilt = hash22(slab + 8.3) - 0.5;
        float large = fbm(uv, 4.0, 5);
        float fine = fbm(uv, 64.0, 3);
        vec3 pores = voronoi(uv, 180.0);
        float pore = (1.0 - smoothstep(0.0, 0.2, pores.x)) * step(0.7, pores.y);
        vec3 spots = voronoi(uv + 0.4, 14.0);
        float gum = (1.0 - smoothstep(0.08, 0.3, spots.x)) * step(0.9, spots.y);
        float crack = (1.0 - smoothstep(0.0, 0.01, voronoi(uv + 0.2, 3.0).z)) * step(0.1, fbm(uv + 0.8, 2.0, 3) + 0.05);
        vec3 albedo = vec3(0.3, 0.29, 0.27) * (0.85 + 0.25 * r) * (0.8 + 0.4 * (large + 0.5)) * (0.93 + 0.14 * (fine + 0.5));
        albedo *= 1.0 - joint * 0.55 - pore * 0.3 - crack * 0.5;
        albedo = mix(albedo, vec3(0.05, 0.047, 0.045), gum * 0.8);
        float h = dot(f - 0.5, tilt) * 0.004 + large * 0.002 + fine * 0.0005 - joint * 0.004 - pore * 0.001 - crack * 0.002;
        return Surface(albedo, h, 0.86 + fine * 0.08, 0.0, 1.0 - joint * 0.4 - crack * 0.3);
      }
    `,
  }
}

// Worn road paint: aggregate shows through where tyres have scrubbed it off.
export function roadPaint(paint: string): SurfaceRecipe {
  return {
    key: `roadPaint:${paint}`,
    size: 512,
    tile: 2,
    uniforms: { uPaint: color(paint) },
    glsl: /* glsl */ `
      uniform vec3 uPaint;

      Surface surface(vec2 uv) {
        float wear = smoothstep(0.1, 0.35, fbm(uv + 0.3, 6.0, 5) + 0.25 * fbm(uv, 30.0, 3));
        vec3 grit = voronoi(uv, 120.0);
        float chip = step(0.6, grit.y) * (1.0 - smoothstep(0.1, 0.4, grit.x));
        float bare = max(wear, chip * 0.8);
        vec3 albedo = mix(uPaint * (0.85 + 0.2 * (fbm(uv, 12.0, 3) + 0.5)), vec3(0.04), bare);
        return Surface(albedo, (1.0 - bare) * 0.0006, mix(0.6, 0.88, bare), 0.0, 1.0);
      }
    `,
  }
}

// Dry, patchy lawn going to dirt.
export function grass(): SurfaceRecipe {
  return {
    key: 'grass',
    size: 1024,
    tile: 4,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        float large = fbm(uv, 3.0, 5);
        float blades = fbm(uv, 90.0, 3);
        float cover = smoothstep(-0.12, 0.2, fbm(uv + 0.4, 5.0, 5));
        vec3 albedo = mix(vec3(0.045, 0.06, 0.022), vec3(0.11, 0.085, 0.04), smoothstep(-0.3, 0.3, large));
        albedo *= 0.7 + 0.6 * (blades + 0.5);
        albedo = mix(vec3(0.06, 0.045, 0.032) * (0.8 + 0.4 * (blades + 0.5)), albedo, cover);
        float h = blades * 0.004 * cover + large * 0.01;
        return Surface(albedo, h, 0.95, 0.0, 0.75 + 0.25 * (blades + 0.5));
      }
    `,
  }
}

// Furrowed bark for the dead street trees.
export function bark(): SurfaceRecipe {
  return {
    key: 'bark',
    size: 256,
    tile: 1,
    uniforms: {},
    glsl: /* glsl */ `
      Surface surface(vec2 uv) {
        float ridges = noise(vec2(uv.x * 24.0, uv.y * 3.0), vec2(24.0, 3.0));
        float fine = fbm(uv, 32.0, 3);
        vec3 albedo = vec3(0.05, 0.04, 0.033) * (0.65 + 0.7 * (ridges * 0.5 + 0.5)) * (0.85 + 0.3 * (fine + 0.5));
        return Surface(albedo, ridges * 0.006 + fine * 0.001, 0.92, 0.0, 0.75 + 0.25 * ridges);
      }
    `,
  }
}

// --- facades ------------------------------------------------------------------
// One texture tile is one bay by one storey; facade geometry counts bays and
// storeys in its uvs (scaled by FACADE_TILE). Each recipe marks its window
// glass (the global `glass`), where the facade shader shows lit rooms.

export const FACADE_TILE = 3.2 // metres per tile, used for normal-map slopes

const RECT_GLSL = /* glsl */ `
  // Coverage of the rectangle r = (x0, y0, x1, y1), antialiased over soft.
  float rect(vec2 p, vec4 r, float soft) {
    vec2 inside = smoothstep(r.xy - soft, r.xy + soft, p) * (1.0 - smoothstep(r.zw - soft, r.zw + soft, p));
    return inside.x * inside.y;
  }
`

export interface BrickFacadeOptions {
  brick: string
  mortar?: string
  trim?: string // stone sills and lintels
  frame?: string // painted window frames
  soot?: number // 0..1 city grime over the whole wall
  burnt?: boolean // gutted by fire: no glass, soot plumes over every window
}

// Brick tenement wall: running bond, stone sill and lintel, a sash window.
export function brickFacade({ brick, mortar = '#6f685e', trim = '#8f887c', frame = '#d9d2c4', soot = 0.25, burnt = false }: BrickFacadeOptions): SurfaceRecipe {
  return {
    key: `brickFacade:${brick}:${mortar}:${trim}:${frame}:${soot}:${burnt}`,
    size: 1024,
    tile: FACADE_TILE,
    uniforms: { uBrick: color(brick), uMortar: color(mortar), uTrim: color(trim), uFrame: color(frame), uSoot: float(soot), uBurnt: float(burnt ? 1 : 0) },
    glsl: /* glsl */ `
      uniform vec3 uBrick;
      uniform vec3 uMortar;
      uniform vec3 uTrim;
      uniform vec3 uFrame;
      uniform float uSoot;
      uniform float uBurnt;
      ${RECT_GLSL}

      Surface surface(vec2 uv) {
        // running bond: 14 bricks across a bay, 42 courses up a storey
        float course = floor(uv.y * 42.0);
        float run = uv.x * 14.0 + 0.5 * mod(course, 2.0);
        vec2 cell = vec2(mod(floor(run), 14.0), course);
        vec2 f = vec2(fract(run), fract(uv.y * 42.0));
        vec2 edge = min(f, 1.0 - f) * vec2(uTile / 14.0, uTile / 42.0);
        float mortar = 1.0 - smoothstep(0.004, 0.008, min(edge.x, edge.y));
        float r = hash12(cell + 1.7);
        vec3 brick = uBrick * (0.7 + 0.55 * r) * (0.88 + 0.24 * (fbm(uv, 32.0, 3) + 0.5));
        brick = mix(brick, uBrick * 0.45, step(0.94, hash12(cell + 8.1)));
        vec3 albedo = mix(brick, uMortar * (0.85 + 0.3 * (fbm(uv + 0.4, 48.0, 2) + 0.5)), mortar);
        float h = -mortar * 0.006 + fbm(uv + 0.2, 64.0, 2) * 0.001;
        float roughness = mix(0.82, 0.95, mortar);
        float metalness = 0.0;
        float ao = 1.0 - mortar * 0.35;

        const vec4 OPENING = vec4(0.3, 0.27, 0.7, 0.8);
        float opening = rect(uv, OPENING, 0.002);
        float sill = rect(uv, vec4(0.275, 0.235, 0.725, 0.27), 0.002);
        float lintel = rect(uv, vec4(0.285, 0.8, 0.715, 0.84), 0.002);
        float pane = rect(uv, OPENING + vec4(0.03, 0.03, -0.03, -0.03), 0.002) * (1.0 - rect(uv, vec4(0.3, 0.525, 0.7, 0.545), 0.001));

        // rain carries soot down from every sill; fire blackens the wall above each opening
        float streak = smoothstep(0.25, 0.8, noise(vec2(uv.x * 36.0, uv.y * 2.0), vec2(36.0, 2.0)));
        float below = rect(uv, vec4(0.28, 0.0, 0.72, 0.235), 0.03) * smoothstep(0.0, 0.235, uv.y);
        float scorch = uBurnt * rect(uv, vec4(0.2, 0.76, 0.8, 1.02), 0.12) * (0.65 + 0.5 * fbm(uv, 8.0, 4));
        float dirt = clamp(streak * below * 0.8 + uSoot * (fbm(uv + 0.6, 4.0, 5) + 0.4) + scorch, 0.0, 1.0);
        albedo = mix(albedo, vec3(0.03, 0.025, 0.022), dirt * 0.85);

        float trim = max(sill, lintel);
        vec3 stone = uTrim * (0.8 + 0.35 * (fbm(uv, 24.0, 3) + 0.5));
        albedo = mix(albedo, mix(stone, vec3(0.03), dirt * 0.6), trim);
        h = mix(h, 0.02 + fbm(uv, 30.0, 2) * 0.001, trim);
        roughness = mix(roughness, 0.8, trim);

        albedo = mix(albedo, uFrame * mix(1.0, 0.12, uBurnt), opening);
        h = mix(h, -0.05, opening);
        roughness = mix(roughness, 0.55, opening);
        ao = mix(ao, 0.75, opening);
        albedo = mix(albedo, mix(vec3(0.016, 0.019, 0.022), vec3(0.006), uBurnt), pane);
        h = mix(h, -0.08, pane);
        roughness = mix(roughness, mix(0.05, 0.95, uBurnt), pane);
        metalness = mix(metalness, 0.35 * (1.0 - uBurnt), pane);
        glass = pane;
        return Surface(albedo, h, roughness, metalness, ao);
      }
    `,
  }
}

export interface PanelFacadeOptions {
  concrete: string
  frame?: string
  soot?: number
}

// Prefab housing block: one precast panel per bay and storey, sealed joints,
// a two-casement window, rain stains fanning out below it.
export function panelFacade({ concrete, frame = '#cfcac0', soot = 0.3 }: PanelFacadeOptions): SurfaceRecipe {
  return {
    key: `panelFacade:${concrete}:${frame}:${soot}`,
    size: 1024,
    tile: FACADE_TILE,
    uniforms: { uConcrete: color(concrete), uFrame: color(frame), uSoot: float(soot) },
    glsl: /* glsl */ `
      uniform vec3 uConcrete;
      uniform vec3 uFrame;
      uniform float uSoot;
      ${RECT_GLSL}

      Surface surface(vec2 uv) {
        float large = fbm(uv, 3.0, 5);
        float fine = fbm(uv, 48.0, 3);
        vec3 pores = voronoi(uv, 120.0);
        float pore = (1.0 - smoothstep(0.0, 0.2, pores.x)) * step(0.7, pores.y);
        vec2 edge = min(uv, 1.0 - uv) * uTile;
        float joint = 1.0 - smoothstep(0.008, 0.016, min(edge.x, edge.y));
        vec3 albedo = uConcrete * (0.82 + 0.3 * (large + 0.5)) * (0.93 + 0.14 * (fine + 0.5)) * (1.0 - pore * 0.35);
        albedo = mix(albedo, vec3(0.05), joint * 0.8);
        float h = large * 0.002 + fine * 0.0006 - pore * 0.001 - joint * 0.01;
        float roughness = 0.9;
        float metalness = 0.0;
        float ao = 1.0 - joint * 0.5;

        const vec4 OPENING = vec4(0.18, 0.3, 0.82, 0.78);
        float opening = rect(uv, OPENING, 0.002);
        float pane = rect(uv, OPENING + vec4(0.025, 0.03, -0.025, -0.03), 0.002) * (1.0 - rect(uv, vec4(0.49, 0.3, 0.51, 0.78), 0.001));
        float streak = smoothstep(0.2, 0.75, noise(vec2(uv.x * 30.0, uv.y * 2.0), vec2(30.0, 2.0)));
        float below = rect(uv, vec4(0.16, 0.0, 0.84, 0.3), 0.04) * smoothstep(0.0, 0.3, uv.y);
        float dirt = clamp(streak * below + uSoot * (fbm(uv + 0.3, 5.0, 4) + 0.3), 0.0, 1.0);
        albedo = mix(albedo, vec3(0.04, 0.035, 0.03), dirt * 0.7);

        albedo = mix(albedo, uFrame, opening);
        h = mix(h, -0.04, opening);
        roughness = mix(roughness, 0.5, opening);
        ao = mix(ao, 0.8, opening);
        albedo = mix(albedo, vec3(0.016, 0.019, 0.022), pane);
        h = mix(h, -0.07, pane);
        roughness = mix(roughness, 0.05, pane);
        metalness = mix(metalness, 0.35, pane);
        glass = pane;
        return Surface(albedo, h, roughness, metalness, ao);
      }
    `,
  }
}

export interface CurtainWallOptions {
  tint: string // glass
  mullion: string
}

// Office curtain wall: two vision panes per bay over a spandrel hiding the
// floor slab, in anodised mullions. Each pane is warped a little, so the
// reflections break up the way real glazing does.
export function curtainWall({ tint, mullion }: CurtainWallOptions): SurfaceRecipe {
  return {
    key: `curtainWall:${tint}:${mullion}`,
    size: 512,
    tile: FACADE_TILE,
    uniforms: { uTint: color(tint), uMullion: color(mullion) },
    glsl: /* glsl */ `
      uniform vec3 uTint;
      uniform vec3 uMullion;

      Surface surface(vec2 uv) {
        float mx = min(min(uv.x, 1.0 - uv.x), abs(uv.x - 0.5)) * uTile;
        float my = min(min(uv.y, 1.0 - uv.y), abs(uv.y - 0.22)) * uTile;
        float mullion = 1.0 - smoothstep(0.03, 0.04, min(mx, my));
        float spandrel = (1.0 - step(0.22, uv.y)) * (1.0 - mullion);
        float vision = (1.0 - mullion) * (1.0 - spandrel);
        vec2 warp = hash22(vec2(step(0.5, uv.x), step(0.22, uv.y)) + 3.3) - 0.5;
        float h = mullion * 0.03 + (1.0 - mullion) * dot(uv - 0.5, warp) * 0.004;
        vec3 albedo = mix(uTint * 0.05, uTint * 0.09, spandrel);
        albedo = mix(albedo, uMullion * (0.85 + 0.3 * (fbm(uv, 20.0, 3) + 0.5)), mullion);
        float roughness = mix(mix(0.03, 0.1, spandrel), 0.35, mullion);
        glass = vision;
        return Surface(albedo, h, roughness, mix(0.75, 1.0, mullion), 1.0 - mullion * 0.2);
      }
    `,
  }
}

export interface ShopfrontOptions {
  fascia: string // sign band
  pier: string // masonry between the shops
  frame?: string
}

// Ground-floor shop: masonry piers, a display window with its door, a
// fascia band for the sign under a moulded lip.
export function shopfront({ fascia, pier, frame = '#2b2c2d' }: ShopfrontOptions): SurfaceRecipe {
  return {
    key: `shopfront:${fascia}:${pier}:${frame}`,
    size: 1024,
    tile: FACADE_TILE,
    uniforms: { uFascia: color(fascia), uPier: color(pier), uFrame: color(frame) },
    glsl: /* glsl */ `
      uniform vec3 uFascia;
      uniform vec3 uPier;
      uniform vec3 uFrame;
      ${RECT_GLSL}

      Surface surface(vec2 uv) {
        float large = fbm(uv, 4.0, 4);
        vec3 albedo = uPier * (0.8 + 0.35 * (large + 0.5)) * (0.9 + 0.2 * (fbm(uv, 40.0, 3) + 0.5));
        float h = large * 0.002;
        float roughness = 0.85;
        float metalness = 0.0;
        float ao = 1.0;

        float fascia = step(0.8, uv.y) * (1.0 - step(0.955, uv.y));
        albedo = mix(albedo, uFascia * (0.85 + 0.3 * (fbm(uv + 0.3, 12.0, 3) + 0.5)), fascia);
        roughness = mix(roughness, 0.6, fascia);
        float lip = step(0.955, uv.y);
        h = mix(h, 0.03, lip);

        const vec4 WINDOW = vec4(0.08, 0.07, 0.92, 0.76);
        float frame = rect(uv, WINDOW, 0.002);
        float door = rect(uv, vec4(0.61, 0.07, 0.83, 0.74), 0.002);
        float pane = max(rect(uv, vec4(0.095, 0.1, 0.595, 0.74), 0.002), rect(uv, vec4(0.845, 0.1, 0.905, 0.74), 0.002));
        pane = max(pane, rect(uv, vec4(0.625, 0.08, 0.815, 0.7), 0.002));
        float kick = rect(uv, vec4(0.08, 0.07, 0.92, 0.1), 0.002) * (1.0 - door);
        albedo = mix(albedo, uFrame * (0.9 + 0.2 * (fbm(uv, 30.0, 2) + 0.5)), frame);
        h = mix(h, -0.03, frame);
        roughness = mix(roughness, 0.4, frame);
        metalness = mix(metalness, 0.8, frame);
        albedo = mix(albedo, vec3(0.02), kick);
        albedo = mix(albedo, vec3(0.016, 0.019, 0.022), pane);
        h = mix(h, -0.05, pane);
        roughness = mix(roughness, 0.04, pane);
        metalness = mix(metalness, 0.35, pane);
        glass = pane;
        return Surface(albedo, h, roughness, metalness, ao);
      }
    `,
  }
}
