import * as THREE from 'three'
import { getRenderer } from '../renderer.ts'
import { bakeSurface, type BakedSurface } from './bake.ts'
import { createBannerTexture, createBillboardTexture, createEmblemTexture, createGlowTexture, createGrateTexture, createNeonTexture } from './canvasTextures.ts'
import { addRooms, FACADES, type FacadeStyle } from './facade.ts'
import { addGroundGrime } from './groundGrime.ts'
import { asphalt, bark, concrete, corrugated, grass, mud, pavement, plating, roadPaint, rubber, steel, type SurfaceRecipe } from './recipes.ts'

// Every material in the game comes from here. Each is built once (textures
// baked on first use) and shared by all assets for the rest of the session,
// so never dispose them from scene code.

// Headless (the game server builds the arenas for their colliders, not their
// looks): no GPU, so recipes aren't baked and their materials come without
// texture maps. Told apart by there being no `window`: the server's DOM shim
// (server/headless.ts) defines `document` only.
const headless = typeof window === 'undefined'

const cache = new Map<string, THREE.Material>()

function memo<T extends THREE.Material>(key: string, create: () => T): T {
  let material = cache.get(key) as T | undefined
  if (!material) {
    material = create()
    material.name = key
    cache.set(key, material)
  }
  return material
}

const baked = new Map<string, BakedSurface>()

// A material on a recipe's textures, which are baked once and shared.
function standard(recipe: SurfaceRecipe, parameters: THREE.MeshStandardMaterialParameters) {
  if (headless) return new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, ...parameters })
  let textures = baked.get(recipe.key)
  if (!textures) {
    textures = bakeSurface(getRenderer(), recipe)
    baked.set(recipe.key, textures)
  }
  return new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    aoMap: textures.ormMap,
    roughnessMap: textures.ormMap,
    metalnessMap: textures.ormMap,
    roughness: 1,
    metalness: 1,
    ...parameters,
  })
}

// Extra `parameters` (e.g. vertexColors) make separate materials sharing the
// recipe's textures. `grime` off for surfaces that are the ground themselves
// (sidewalks, road paint): the mud band would cover them whole.
function surface(recipe: SurfaceRecipe, parameters: THREE.MeshStandardMaterialParameters = {}, grime = true) {
  return memo(recipe.key + JSON.stringify(parameters) + (grime ? '' : ':clean'), () => {
    const material = standard(recipe, parameters)
    if (grime) material.onBeforeCompile = addGroundGrime
    return material
  })
}

// Facade walls: their geometry carries bay/storey uvs, and the rooms behind
// the glass light up (facade.ts).
function facade(style: FacadeStyle) {
  return memo(`facade:${style}`, () => {
    const { recipe, rooms } = FACADES[style]
    const material = withOwnUVs(standard(recipe, {}))
    material.onBeforeCompile = (shader) => {
      addGroundGrime(shader)
      addRooms(shader, rooms)
    }
    return material
  })
}

let glowTexture: THREE.Texture | undefined

// Additive glow sprites and signs: HDR colour (above 1 blooms), no depth writes.
function additive(key: string, map: () => THREE.Texture, color: string, intensity: number) {
  return memo(key, () =>
    withOwnUVs(
      new THREE.MeshBasicMaterial({
        map: map(),
        color: new THREE.Color(color).multiplyScalar(intensity),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false, // fogging an additive glow brightens it toward the haze instead of fading it
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    ),
  )
}

// Materials whose geometry carries its own 0..1 uvs (decals, banners) opt out
// of the metre-based box projection applied when meshes are merged.
function withOwnUVs<T extends THREE.Material>(material: T): T {
  material.userData.ownUVs = true
  return material
}

let emblemTexture: THREE.Texture | undefined
const emblem = () => (emblemTexture ??= createEmblemTexture())

export interface Livery {
  paint: string
  patch: string
}

export const LIVERIES = {
  hazard: { paint: '#bb8a2c', patch: '#1b1916' },
  crimson: { paint: '#8e1d15', patch: '#1b1614' },
  cobalt: { paint: '#2a4f78', patch: '#15181c' }, // the player's crew in team games
} satisfies Record<string, Livery>

export const materials = {
  // vehicles
  paint: (livery: Livery) => surface(plating({ ...livery, rust: 0.55, wear: 0.65 })),
  hazard: (livery: Livery) => surface(steel({ rust: 0.5, stripes: [livery.paint, livery.patch] })),
  steel: () => surface(steel({ rust: 0.35 })),
  rustySteel: () => surface(steel({ rust: 0.85 })),
  darkSteel: () => surface(steel({ bare: '#3b3936', rust: 0.12, size: 512 })),
  perforated: () => surface(steel({ rust: 0.3, holes: 40, size: 512 })),
  olive: () => surface(plating({ paint: '#4b5130', patch: '#3e4228', rust: 0.25, wear: 0.4, rows: 12, rivets: false, size: 256 })),
  rubber: () => surface(rubber()),
  charred: () => surface(steel({ bare: '#1a1715', rust: 0.35, size: 512 })), // burnt-out wrecks
  glass: () => memo('glass', () => new THREE.MeshStandardMaterial({ color: '#07090b', roughness: 0.05, metalness: 0.5 })),
  grate: () =>
    memo('grate', () => {
      const map = createGrateTexture()
      map.repeat.setScalar(1 / 0.24) // one texture tile = 24 cm of mesh
      return new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, color: '#55504b', metalness: 0.85, roughness: 0.55 })
    }),
  emblem: () =>
    memo('emblem', () =>
      withOwnUVs(new THREE.MeshStandardMaterial({ map: emblem(), alphaTest: 0.4, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2 })),
    ),
  light: (color: string, intensity: number) =>
    memo(`light:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity })),

  // arena
  concrete: () => surface(concrete()),
  barrier: () => surface(concrete({ stripe: '#8e1b12' })),
  corrugated: (paint: string) => surface(corrugated({ paint, rust: 0.6, size: 512 })),
  // junk-pile car shells: geometry must carry vertex colours (dark glass and tyres)
  wreck: () => surface(plating({ paint: '#b3aca2', patch: '#8c867d', rust: 0.8, wear: 0.8, rivets: false, size: 512 }), { vertexColors: true }),
  drum: () => surface(plating({ paint: '#d8d4cc', patch: '#d8d4cc', rust: 0.6, wear: 0.5, rows: 3, rivets: false, size: 512 })),
  aluminium: () => surface(plating({ paint: '#b6b5ae', patch: '#8d8b84', bare: '#c4c4c0', rust: 0.15, wear: 0.65, rows: 4, size: 512 })),
  mud: () => surface(mud()),
  banner: () =>
    memo('banner', () => withOwnUVs(new THREE.MeshStandardMaterial({ map: createBannerTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }))),
  // city
  asphalt: () => surface(asphalt(), {}, false),
  pavement: () => surface(pavement(), {}, false),
  grass: () => surface(grass(), {}, false),
  roadPaint: (color: string) => surface(roadPaint(color), {}, false),
  roof: () => surface(concrete({ tint: '#4a4540', cracks: 0.2 })),
  bodywork: (paint: string) => surface(plating({ paint, patch: paint, rust: 0.3, wear: 0.3, rows: 2, rivets: false, size: 512 })), // buses, trucks: big smooth panels
  bark: () => surface(bark()),
  facade,
  // soft spot of light laid on the ground under street lamps
  glow: (color: string, intensity: number) => additive(`glow:${color}:${intensity}`, () => (glowTexture ??= createGlowTexture()), color, intensity),
  neon: (text: string, color: string, vertical = false) =>
    additive(`neon:${text}:${color}:${vertical}`, () => createNeonTexture(text, color, vertical), '#ffffff', 2.2),
  billboard: (variant: number) =>
    memo(`billboard:${variant}`, () => {
      const map = createBillboardTexture(variant)
      return withOwnUVs(new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.55 }))
    }),
  floorCrest: () =>
    memo('floorCrest', () =>
      withOwnUVs(
        new THREE.MeshStandardMaterial({ map: emblem(), color: '#8e1b12', alphaTest: 0.4, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
      ),
    ),
}
