import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
// The graphics quality settings, lowest first (the settings drawer lists them in this order).
export const QUALITIES = ['low', 'medium', 'high'] as const
export type Quality = (typeof QUALITIES)[number]

// What each graphics quality setting renders. GTAO is the costliest pass,
// then MSAA on the HDR target, then bloom.
export const QUALITY: Record<Quality, { samples: number; occlusion: boolean; bloom: boolean; shadowMap: number }> = {
  low: { samples: 0, occlusion: false, bloom: false, shadowMap: 1024 },
  medium: { samples: 4, occlusion: false, bloom: true, shadowMap: 2048 },
  high: { samples: 4, occlusion: true, bloom: true, shadowMap: 4096 },
}

// HDR chain for the arena: MSAA scene render, ground-contact occlusion
// (GTAO), bloom for lamps and hot metal, then tone mapping + sRGB output;
// `quality` drops the expensive steps. Sized from the renderer (size and
// pixel ratio); call composer.setSize(width, height) on resize.
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
  const { samples, occlusion, bloom } = QUALITY[quality]
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }))
  composer.addPass(new RenderPass(scene, camera))

  if (occlusion) {
    const gtao = new GTAOPass(scene, camera)
    gtao.blendIntensity = 0.7
    gtao.updateGtaoMaterial({ radius: 0.8, distanceFallOff: 1, thickness: 1.5, scale: 1 })
    composer.addPass(gtao)
  }

  if (bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 1.2))
  composer.addPass(new OutputPass())

  const size = renderer.getSize(new THREE.Vector2())
  composer.setSize(size.x, size.y)
  return composer
}

// EffectComposer.dispose() leaves the passes' own render targets alive.
export function disposeComposer(composer: EffectComposer) {
  composer.passes.forEach((pass) => pass.dispose())
  composer.dispose()
}
