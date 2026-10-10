import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { TurretKey } from '../content/weapons/weapons.ts'
import { addSunsetLighting } from '../render/environment.ts'
import { disposeGeometries } from '../render/geometry.ts'
import { LIVERIES } from '../render/materials/library.ts'
import { getRenderer, mountRenderer } from '../render/renderer.ts'
import { MODELS } from '../content/vehicles/models.ts'
import type { VehicleId } from '../content/vehicles/vehicles.ts'

// The garage turntable over the menu backdrop: the shared canvas in
// `container`, the car in the dusk light, a camera slowly orbiting it. The
// car is rebuilt when the loadout changes it; the renderer's animation loop
// owns rendering. The garage screen mounts one and disposes it.
export function createTurntable(container: HTMLElement) {
  const renderer = getRenderer()
  renderer.toneMappingExposure = 1.15
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new THREE.Scene() // no background: the page image shows through
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(5.2, 2.2, 6.4)

  const sun = addSunsetLighting(scene, renderer, 6)
  const fill = new THREE.DirectionalLight('#9fb4ff', 0.6)
  fill.position.set(-5, 3, 4)
  scene.add(fill)

  // ShadowMaterial renders only the cast shadow and stays transparent elsewhere.
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.55 }))
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.receiveShadow = true
  scene.add(shadowCatcher)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1, 0.2)
  controls.minDistance = 4
  controls.maxDistance = 11
  controls.maxPolarAngle = Math.PI * 0.49
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.5
  controls.update()

  const unmount = mountRenderer(
    container,
    () => {
      controls.update()
      renderer.render(scene, camera)
    },
    (width, height) => {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
  )

  let car: THREE.Group | undefined
  const remove = () => {
    if (!car) return
    scene.remove(car)
    disposeGeometries(car)
    car = undefined
  }

  return {
    show(vehicle: VehicleId, turret: TurretKey) {
      remove()
      car = MODELS[vehicle]({ livery: LIVERIES.hazard, turret })
      scene.add(car)
    },
    dispose() {
      unmount()
      remove()
      controls.dispose()
      sun.dispose()
      disposeGeometries(scene)
      shadowCatcher.material.dispose()
    },
  }
}
