import * as THREE from 'three'
import { NOISE_GLSL } from './noise.ts'
import type { SurfaceRecipe } from './recipes.ts'

export interface BakedSurface {
  map: THREE.Texture
  normalMap: THREE.Texture // RG only
  ormMap: THREE.Texture // R occlusion, G roughness, B metalness — the glTF packing three.js reads
}

const OUTPUT_ALBEDO = 0
const OUTPUT_NORMAL = 1
const OUTPUT_ORM = 2

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const PRELUDE = /* glsl */ `
  varying vec2 vUv;
  uniform float uTile;
  uniform float uTexel;

  struct Surface {
    vec3 albedo;
    float height;
    float roughness;
    float metalness;
    float ao;
  };

  // Window glass coverage, 0..1: facade recipes set it inside surface(). It
  // is baked into the albedo alpha as 1 - glass, for the facade shader.
  float glass;

  const vec3 RUST_DARK = vec3(0.042, 0.013, 0.005);
  const vec3 RUST_LIGHT = vec3(0.16, 0.05, 0.015);
  const vec3 GRIME = vec3(0.045, 0.034, 0.026);

  ${NOISE_GLSL}
`

const MAIN = /* glsl */ `
  void main() {
    #if OUTPUT == ${OUTPUT_NORMAL}
      // Heights are metres, so slopes come out physically scaled.
      float e = uTexel;
      float dx = surface(fract(vUv + vec2(e, 0.0))).height - surface(fract(vUv - vec2(e, 0.0))).height;
      float dy = surface(fract(vUv + vec2(0.0, e))).height - surface(fract(vUv - vec2(0.0, e))).height;
      float span = 2.0 * e * uTile;
      gl_FragColor = vec4(normalize(vec3(-dx / span, -dy / span, 1.0)) * 0.5 + 0.5, 1.0);
    #else
      glass = 0.0;
      Surface s = surface(vUv);
      #if OUTPUT == ${OUTPUT_ALBEDO}
        gl_FragColor = vec4(s.albedo, 1.0 - glass);
      #else
        gl_FragColor = vec4(s.ao, s.roughness, s.metalness, 1.0);
      #endif
    #endif
  }
`

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
const quadScene = new THREE.Scene().add(quad)
const quadCamera = new THREE.Camera()

// Renders a recipe into three mipmapped, repeating textures on the GPU. The
// textures live on this renderer's context for the rest of the session.
export function bakeSurface(renderer: THREE.WebGLRenderer, recipe: SurfaceRecipe): BakedSurface {
  const previousTarget = renderer.getRenderTarget()

  function bake(output: number, colorSpace: THREE.ColorSpace) {
    const target = new THREE.WebGLRenderTarget(recipe.size, recipe.size, {
      // Normals bake to two channels; three.js rebuilds z (USE_PACKED_NORMALMAP).
      format: output === OUTPUT_NORMAL ? THREE.RGFormat : THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
      colorSpace, // sRGB targets encode on write, so the shader stays linear
    })
    const material = new THREE.ShaderMaterial({
      defines: { OUTPUT: output },
      uniforms: { ...recipe.uniforms, uTile: { value: recipe.tile }, uTexel: { value: 1 / recipe.size } },
      vertexShader: VERTEX,
      fragmentShader: PRELUDE + recipe.glsl + MAIN,
    })
    quad.material = material
    renderer.setRenderTarget(target)
    renderer.render(quadScene, quadCamera)
    material.dispose()

    const texture = target.texture
    texture.name = `${recipe.key}#${output}`
    texture.repeat.setScalar(1 / recipe.tile) // geometry uvs are in metres
    return texture
  }

  const baked = {
    map: bake(OUTPUT_ALBEDO, THREE.SRGBColorSpace),
    normalMap: bake(OUTPUT_NORMAL, THREE.NoColorSpace),
    ormMap: bake(OUTPUT_ORM, THREE.NoColorSpace),
  }
  renderer.setRenderTarget(previousTarget)
  return baked
}
