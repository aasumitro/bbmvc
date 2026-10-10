import * as THREE from 'three'
import { boxUV } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'

export interface GroundOptions {
  size: number // metres, square, centred on the origin
  layoutExtent: number // metres covered by the painted layout
  // Draws the layout in world metres (x right, z down). `tint` multiplies the
  // dirt (mid grey = unchanged); `wetness` is 0 (black) dry to 1 (white) puddle.
  paintLayout: (tint: CanvasRenderingContext2D, wetness: CanvasRenderingContext2D) => void
  surface?: THREE.MeshStandardMaterial // the tiling surface under the layout; yard mud by default
}

const LAYOUT_PX = 1024

function layoutCanvas(extent: number, fill: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LAYOUT_PX
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, LAYOUT_PX, LAYOUT_PX)
  ctx.setTransform(LAYOUT_PX / extent, 0, 0, LAYOUT_PX / extent, LAYOUT_PX / 2, LAYOUT_PX / 2)
  return ctx
}

// Soften hard canvas edges so roads and puddles blend into the dirt.
function blur(ctx: CanvasRenderingContext2D, px: number) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = `blur(${px}px)`
  ctx.drawImage(ctx.canvas, 0, 0)
  ctx.restore()
}

// Tint in RGB, wetness in A. Built by hand because a canvas stores
// premultiplied alpha, which would destroy the tint wherever the ground is dry.
function layoutTexture({ layoutExtent, paintLayout }: GroundOptions) {
  const tint = layoutCanvas(layoutExtent, 'rgb(128,128,128)')
  const wetness = layoutCanvas(layoutExtent, '#000')
  paintLayout(tint, wetness)
  blur(tint, 2)
  blur(wetness, 1.5)

  const rgb = tint.getImageData(0, 0, LAYOUT_PX, LAYOUT_PX).data
  const wet = wetness.getImageData(0, 0, LAYOUT_PX, LAYOUT_PX).data
  const data = new Uint8Array(rgb.length)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[i]
    data[i + 1] = rgb[i + 1]
    data[i + 2] = rgb[i + 2]
    data[i + 3] = wet[i]
  }
  const texture = new THREE.DataTexture(data, LAYOUT_PX, LAYOUT_PX)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

// Ground plane: tileable dirt (or asphalt) detail plus the painted layout.
// Wet areas get darker, glossy and flat so they mirror the sunset sky.
export function createGround(options: GroundOptions) {
  const layout = layoutTexture(options)
  const material = (options.surface ?? materials.mud()).clone()
  material.normalScale.setScalar(0.7) // grazing sun exaggerates relief
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLayout = { value: layout }
    shader.uniforms.uLayoutExtent = { value: options.layoutExtent }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uLayoutExtent;\nvarying vec2 vLayoutUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayoutUv = (modelMatrix * vec4(transformed, 1.0)).xz / uLayoutExtent + 0.5;')
    // `wetness` darkens soil progressively; `water` is where it stands in a
    // film: glossy, flat, mirroring the sky. A narrow wet->water band keeps
    // puddle edges from ringing with sun highlights.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLayout;\nvarying vec2 vLayoutUv;\nfloat wetness;\nfloat water;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 layoutTexel = texture2D(uLayout, vLayoutUv);
        wetness = layoutTexel.a;
        water = smoothstep(0.45, 0.8, wetness);
        diffuseColor.rgb *= layoutTexel.rgb * 2.0 * mix(1.0, 0.38, wetness);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, water);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, water));')
      // Granular soil self-shadows its sheen far more than GGX assumes (it is
      // close to matte), so its reflections are damped — otherwise it glows
      // like sand toward a low sun. A near-mirror sun glint is thousands of
      // times over white; capping it keeps bloom a glint, not a flare.
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directSpecular = min(reflectedLight.directSpecular * mix(0.12, 1.0, water), vec3(6.0));
        reflectedLight.indirectSpecular *= mix(0.25, 2.0, water);`,
      )
  }

  const geometry = boxUV(new THREE.PlaneGeometry(options.size, options.size).rotateX(-Math.PI / 2))
  const ground = new THREE.Mesh(geometry, material)
  ground.name = 'ground'
  ground.receiveShadow = true
  return ground
}
