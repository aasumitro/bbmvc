import * as THREE from 'three'

let renderer: THREE.WebGLRenderer | undefined

// One WebGL context for the whole app. Screens borrow its canvas rather than
// creating their own: contexts are expensive, browsers cap how many stay
// alive, and baked textures / cached materials belong to this context.
export function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
  }
  return renderer
}

// Puts the shared canvas in `container`, keeps it sized to it, and calls
// `frame` every animation frame. Returns the teardown for a React effect.
export function mountRenderer(container: HTMLElement, frame: (time: number) => void, resize: (width: number, height: number) => void) {
  const renderer = getRenderer()
  container.appendChild(renderer.domElement)

  function fit() {
    const { clientWidth: width, clientHeight: height } = container
    if (width === 0 || height === 0) return
    renderer.setSize(width, height)
    resize(width, height)
  }
  fit()
  const observer = new ResizeObserver(fit)
  observer.observe(container)
  renderer.setAnimationLoop(frame)

  return () => {
    renderer.setAnimationLoop(null)
    observer.disconnect()
    renderer.domElement.remove()
  }
}
