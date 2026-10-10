import * as THREE from 'three'
import { brickFacade, curtainWall, panelFacade, shopfront, type SurfaceRecipe } from './recipes.ts'

// Building facades: a baked wall recipe plus the rooms seen through its
// glass. Behind every window pane the fragment shader traces the view ray
// into a box room one bay wide, one storey high and `depth` deep (interior
// mapping), then lights it — or leaves it dark — from a hash of the room.

interface Rooms {
  bay: number // metres across one window bay...
  storey: number // ...and up one storey: the geometry lays its uvs out in these
  depth: number // metres from the glass to the back wall
  lit: number // share of rooms with the lights on, 0..1
  kind: 0 | 1 | 2 | 3 // homes (curtains, TVs), offices (whole floors lit), shops, burnt out (fire)
}

const homes = (lit: number): Rooms => ({ bay: 3.2, storey: 3.3, depth: 4.5, lit, kind: 0 })
const panels = (lit: number): Rooms => ({ bay: 3, storey: 3, depth: 4.5, lit, kind: 0 })
const offices = (lit: number): Rooms => ({ bay: 3, storey: 3.8, depth: 9, lit, kind: 1 })
const shops = (lit: number): Rooms => ({ bay: 4.6, storey: 4.6, depth: 8, lit, kind: 2 })

export const FACADES = {
  redBrick: { recipe: brickFacade({ brick: '#5e2519' }), rooms: homes(0.42) },
  brownBrick: { recipe: brickFacade({ brick: '#4a3024', trim: '#7d766b', frame: '#2f3b33' }), rooms: homes(0.38) },
  creamBrick: { recipe: brickFacade({ brick: '#8c7a5e', mortar: '#5c554b', frame: '#3b2a22', soot: 0.4 }), rooms: homes(0.45) },
  burntBrick: { recipe: brickFacade({ brick: '#3a2219', frame: '#1c1a18', soot: 0.85, burnt: true }), rooms: { ...homes(0.3), kind: 3 } },
  greyPanel: { recipe: panelFacade({ concrete: '#77746d' }), rooms: panels(0.4) },
  beigePanel: { recipe: panelFacade({ concrete: '#8a7d68', frame: '#9c3b24', soot: 0.4 }), rooms: panels(0.35) },
  blueGlass: { recipe: curtainWall({ tint: '#4f7f96', mullion: '#8d969b' }), rooms: offices(0.35) },
  bronzeGlass: { recipe: curtainWall({ tint: '#8a6a45', mullion: '#3a3430' }), rooms: offices(0.3) },
  shops: { recipe: shopfront({ fascia: '#1c2629', pier: '#6d665c' }), rooms: shops(0.6) },
  redShops: { recipe: shopfront({ fascia: '#5a1812', pier: '#4f463d', frame: '#1d1c1b' }), rooms: shops(0.5) },
  lobby: { recipe: shopfront({ fascia: '#262a2d', pier: '#8e8a84', frame: '#8d969b' }), rooms: { ...shops(0.9), kind: 1 } },
} satisfies Record<string, { recipe: SurfaceRecipe; rooms: Rooms }>

export type FacadeStyle = keyof typeof FACADES

// Seconds, advanced by the arena: TVs and fires flicker with it.
export const facadeClock = { value: 0 }

const ROOMS_GLSL = /* glsl */ `
  uniform vec4 uRoom; // bay, storey, depth (metres), share of rooms lit
  uniform float uRoomKind; // 0 homes, 1 offices, 2 shops, 3 burnt out
  uniform float uClock;
  varying vec3 vRoomWorld;
  varying vec3 vRoomNormal;
  float windowGlass;

  float roomHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Light leaving the room behind this pixel of glass; uv counts bays and storeys.
  vec3 roomLight(vec2 uv) {
    vec3 n = normalize(vRoomNormal);
    vec3 view = normalize(vRoomWorld - cameraPosition);
    vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    // the view ray in room units: x across the bay, y up the storey, z into the room
    vec3 ray = vec3(dot(view, across) / uRoom.x, view.y / uRoom.y, max(-dot(view, n), 0.02) / uRoom.z);
    vec2 cell = floor(uv);
    vec3 entry = vec3(fract(uv), 0.0);
    vec3 exits = (step(0.0, ray) - entry) / (ray + 1e-5);
    float t = min(min(exits.x, exits.y), exits.z);
    vec3 hit = entry + ray * t;

    float r1 = roomHash(cell);
    float r2 = roomHash(cell + 17.31);
    float r3 = roomHash(cell + 51.7);
    bool homes = uRoomKind == 0.0;
    bool offices = uRoomKind == 1.0;
    bool shops = uRoomKind == 2.0;
    bool burnt = uRoomKind == 3.0;
    // offices light whole floors, in runs of five bays
    float level = step(1.0 - uRoom.w, offices ? roomHash(vec2(floor(cell.x / 5.0), cell.y) + 3.1) : r1);

    // what the ray meets, and which way that surface faces
    vec3 paint = mix(mix(vec3(0.66, 0.6, 0.48), vec3(0.45, 0.52, 0.47), step(0.5, r2)), mix(vec3(0.62, 0.48, 0.46), vec3(0.44, 0.49, 0.58), step(0.5, r3)), step(0.6, r1));
    if (offices || shops) paint = vec3(0.42, 0.43, 0.44);
    if (burnt) paint = vec3(0.1, 0.085, 0.075);
    vec3 facing;
    vec3 surface;
    if (t == exits.z) {
      facing = vec3(0.0, 0.0, -1.0);
      surface = paint;
    } else if (t == exits.x) {
      facing = vec3(-sign(ray.x), 0.0, 0.0);
      surface = paint * 0.9;
    } else if (ray.y < 0.0) {
      facing = vec3(0.0, 1.0, 0.0);
      surface = burnt ? vec3(0.02) : offices ? vec3(0.2, 0.21, 0.23) : vec3(0.32, 0.2, 0.12) * (0.8 + 0.2 * step(0.5, fract(hit.x * 6.0))); // carpet tiles, floorboards
    } else {
      facing = vec3(0.0, -1.0, 0.0);
      surface = burnt ? vec3(0.03) : vec3(0.82);
    }

    // furniture: dark shapes against the walls, a picture, office desks, shop shelving
    float dark = 0.0;
    if (t == exits.z) {
      dark = step(hit.y, 0.26 + 0.12 * r2) * step(abs(hit.x - 0.25 - 0.5 * r3), 0.2 + 0.1 * r1); // sofa, bed, cabinet
      if (homes && abs(hit.x - 0.7 + 0.4 * r1) < 0.08 && abs(hit.y - 0.6) < 0.07) surface = mix(vec3(0.55, 0.32, 0.2), vec3(0.2, 0.32, 0.5), r3);
      if (shops) dark = max(dark, step(0.5, fract(hit.y * 5.0)) * step(hit.y, 0.8) * 0.8);
    } else if (t == exits.x) {
      dark = step(hit.y, 0.34) * step(0.3 + 0.2 * r2, hit.z) * step(hit.z, 0.55 + 0.4 * r1);
      if (shops) dark = max(dark, step(0.5, fract(hit.y * 5.0)) * step(hit.y, 0.8) * step(0.15, hit.z) * 0.7);
    } else if (offices && ray.y < 0.0) {
      dark = step(0.55, fract(hit.x * 2.0 + 0.25)) * step(0.4, fract(hit.z * 3.0)); // desks
    }
    surface *= 1.0 - dark * 0.85;

    // light: a lamp under the middle of the ceiling (offices and shops: a grid of panels)
    vec3 lampAt = vec3(0.5, 0.94, 0.45);
    vec3 lamp = mix(vec3(1.0, 0.56, 0.26), vec3(0.8, 0.88, 1.0), step(0.82, r2)); // tungsten, the odd fluorescent tube
    if (offices) lamp = vec3(0.78, 0.86, 1.0);
    if (shops) lamp = mix(vec3(1.0, 0.8, 0.55), vec3(0.85, 0.95, 1.0), r2);
    if (homes && level == 0.0 && r3 > 0.86) { // a dark room with the TV on
      lamp = vec3(0.3, 0.45, 1.0);
      lampAt = vec3(0.5, 0.3, 0.92);
      level = 0.25 + 0.15 * sin(uClock * 7.0 + r1 * 40.0) * sin(uClock * 2.3 + r2 * 13.0);
    }
    if (burnt) { // still burning low in the room
      lamp = vec3(1.0, 0.32, 0.06) * 2.2;
      lampAt = vec3(0.5, 0.05, 0.6);
      level *= 0.65 + 0.35 * sin(uClock * 9.0 + r2 * 30.0) * sin(uClock * 5.3 + r3 * 11.0);
    }
    vec3 toLamp = (lampAt - hit) * uRoom.xyz;
    float reach = length(toLamp);
    float shade = 0.3 + 0.7 * max(dot(facing, toLamp / reach), 0.0);
    float light = shade * 2.6 / (1.0 + reach * reach * 0.3);
    if (offices || shops) light = shade * 0.5 + 0.1;
    if (t == exits.y && ray.y > 0.0 && !burnt) { // the fittings themselves
      float fitting = offices || shops ? step(0.7, fract(hit.x * 2.0)) * step(0.75, fract(hit.z * 3.0)) : 1.0 - smoothstep(0.08, 0.14, length(hit.xz - lampAt.xz));
      light += fitting * (offices || shops ? 1.6 : 2.4);
    }
    vec3 radiance = surface * lamp * level * light + surface * 0.004;
    if (burnt) radiance += lamp * level * (1.0 - smoothstep(0.05, 0.4, hit.y)) * (0.6 + 0.4 * sin(hit.x * 23.0 + uClock * 6.0)); // the flames themselves

    if (homes) { // curtains drawn part way from both sides, glowing with the lamp behind
      float drawn = 0.18 + r3 * 0.28;
      float curtain = step(0.45, r2) * (step(entry.x, drawn) + step(1.0 - drawn, entry.x));
      vec3 cloth = mix(vec3(0.6, 0.32, 0.16), vec3(0.3, 0.35, 0.45), r1);
      radiance = mix(radiance, cloth * (lamp * level * 0.7 + 0.004), min(curtain, 1.0));
    } else if (offices && r2 > 0.55) { // blinds
      radiance *= 0.7 + 0.3 * step(0.5, fract(entry.y * 16.0));
    }

    // glass mirrors more and shows less of the room at grazing angles
    float face = clamp(-dot(view, n), 0.0, 1.0);
    radiance *= 1.0 - pow(1.0 - face, 4.0);
    // far off, a room shrinks to a few pixels: fade to the average glow instead of sparkling
    vec3 average = (burnt ? vec3(1.0, 0.34, 0.07) : offices ? vec3(0.78, 0.86, 1.0) : vec3(1.0, 0.68, 0.4)) * uRoom.w * 0.45;
    float blur = clamp(max(fwidth(uv.x), fwidth(uv.y)) * 3.0 - 0.5, 0.0, 1.0);
    return mix(radiance, average, blur);
  }
`

// Installs the rooms on a facade material; chain after addGroundGrime.
// Everything per style travels in uniforms, so all facades share one program.
export function addRooms(shader: THREE.WebGLProgramParametersWithUniforms, rooms: Rooms) {
  shader.uniforms.uRoom = { value: new THREE.Vector4(rooms.bay, rooms.storey, rooms.depth, rooms.lit) }
  shader.uniforms.uRoomKind = { value: rooms.kind }
  shader.uniforms.uClock = facadeClock
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vRoomWorld;\nvarying vec3 vRoomNormal;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRoomWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRoomNormal = mat3(modelMatrix) * objectNormal;',
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${ROOMS_GLSL}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\nwindowGlass = 1.0 - diffuseColor.a;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += windowGlass * roomLight(vMapUv);')
}
