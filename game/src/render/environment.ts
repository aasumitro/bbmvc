import * as THREE from 'three'
import { NOISE_GLSL } from './materials/noise.ts'

// Dusk over the yard: low sun in the north-west, warm haze, cloud deck.
// The same sky lights every scene (as a prefiltered environment map), so
// metal reflects the horizon the player sees.

const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.45, -0.87).normalize() // ~25° up: low enough for dusk, high enough to reach the yard floor
const HAZE = new THREE.Color().setRGB(0.3, 0.12, 0.05) // linear; fog colour

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uHaze;
  uniform float uSunDisc;
  varying vec3 vDirection;

  ${NOISE_GLSL}

  float clouds(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * noise(p, vec2(4096.0));
      p = p * 2.03 + 11.7;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 d = normalize(vDirection);
    float sun = max(dot(d, uSun), 0.0);
    float up = clamp(d.y, 0.0, 1.0);
    vec2 heading = normalize(d.xz + 1e-5);
    float sunward = pow(max(dot(heading, normalize(uSun.xz)), 0.0), 2.0);

    // burning horizon toward the sun, dusk overhead, night creeping in above
    vec3 horizon = mix(vec3(0.36, 0.12, 0.045), vec3(1.1, 0.4, 0.1), sunward);
    vec3 color = mix(horizon, vec3(0.1, 0.038, 0.034), smoothstep(0.0, 0.16, up));
    color = mix(color, vec3(0.01, 0.014, 0.035), smoothstep(0.2, 0.9, up));
    color += vec3(1.2, 0.45, 0.12) * (pow(sun, 8.0) * 0.5 + pow(sun, 80.0) * 1.5);
    color += vec3(1.0, 0.55, 0.25) * uSunDisc * smoothstep(0.99935, 0.9997, sun);

    if (d.y > 0.0) {
      vec2 p = d.xz / (d.y + 0.1) * 1.4 + vec2(3.7, 1.3);
      float density = clouds(p);
      float cover = smoothstep(-0.15, 0.2, density);
      // heavy dark deck; edges thinning toward the sun catch its light
      float edge = clamp((density - clouds(p + normalize(uSun.xz) * 0.08)) * 6.0, 0.0, 1.0);
      float glow = 0.05 + 0.3 * sunward + 2.5 * pow(sun, 6.0);
      vec3 cloud = vec3(0.022, 0.015, 0.018) + vec3(1.2, 0.42, 0.12) * glow * (0.06 + edge * edge) * (1.0 - 0.75 * up);
      color = mix(color, cloud, cover * smoothstep(0.0, 0.08, d.y) * 0.97);
    }

    // far ridge line, then ground, both sinking into the haze
    float ridge = 0.03 + 0.025 * noise(heading * 2.5, vec2(4096.0)) + 0.01 * noise(heading * 9.0 + 3.0, vec2(4096.0));
    float land = 1.0 - smoothstep(ridge - 0.002, ridge + 0.002, d.y);
    color = mix(color, mix(vec3(0.03, 0.022, 0.02), uHaze, 0.55 + 0.45 * smoothstep(-0.1, ridge, d.y)), land);
    gl_FragColor = vec4(color, 1.0);
  }
`

// `sunDisc` is the disc's HDR brightness. Environment captures leave it out:
// the directional light already supplies the sun's direct and specular light.
function createSky(sunDisc: number) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN_DIRECTION }, uHaze: { value: HAZE }, uSunDisc: { value: sunDisc } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  )
}

let skyEnvironment: THREE.Texture | undefined

// Sky prefiltered for image-based lighting; rendered once per session.
function getSkyEnvironment(renderer: THREE.WebGLRenderer) {
  if (!skyEnvironment) {
    const sky = createSky(0)
    const pmrem = new THREE.PMREMGenerator(renderer)
    skyEnvironment = pmrem.fromScene(new THREE.Scene().add(sky), 0, 1, 2000).texture
    pmrem.dispose()
    sky.geometry.dispose()
    sky.material.dispose()
  }
  return skyEnvironment
}

// Sun (with shadows over `shadowExtent` metres around the origin) plus sky
// reflections. Returns the sun so callers can retarget its shadow frustum.
export function addSunsetLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowExtent: number) {
  scene.environment = getSkyEnvironment(renderer)
  scene.environmentIntensity = 1.4 // the dusk sky is dark overhead; metal only shows what it reflects
  // Fill for the shadow side: cool dusk from above, warm bounce off the yard floor.
  scene.add(new THREE.HemisphereLight('#7d8fb8', '#5a3a22', 2.2))

  const sun = new THREE.DirectionalLight('#ffb574', 6)
  sun.position.copy(SUN_DIRECTION).multiplyScalar(shadowExtent * 2.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.radius = 2
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.03
  const camera = sun.shadow.camera
  camera.left = camera.bottom = -shadowExtent
  camera.right = camera.top = shadowExtent
  camera.near = 1
  camera.far = shadowExtent * 5
  scene.add(sun, sun.target)
  return sun
}

let skyDome: THREE.Mesh | undefined

// Visible sky dome and matching distance haze, for outdoor views. The dome
// is kept for the session and moves to whichever scene asks for it.
export function addSunsetSky(scene: THREE.Scene) {
  skyDome ??= createSky(18)
  scene.add(skyDome)
  scene.fog = new THREE.FogExp2(HAZE, 0.0035)
}

const shadowRight = new THREE.Vector3()
const shadowUp = new THREE.Vector3()

// Re-centres the sun's shadow frustum (shadowExtent metres either way) on
// `focus`, snapped to whole shadow-map texels so still shadows don't crawl
// while it moves. The snap runs along the shadow camera's own axes: it looks
// back down SUN_DIRECTION with world up.
export function followShadow(sun: THREE.DirectionalLight, focus: THREE.Vector3) {
  const { camera, mapSize } = sun.shadow
  const texel = (camera.right - camera.left) / mapSize.x
  shadowRight.crossVectors(sun.up, SUN_DIRECTION).normalize()
  shadowUp.crossVectors(SUN_DIRECTION, shadowRight)
  const across = Math.round(focus.dot(shadowRight) / texel) * texel
  const rise = Math.round(focus.dot(shadowUp) / texel) * texel
  sun.target.position.copy(shadowRight).multiplyScalar(across).addScaledVector(shadowUp, rise).addScaledVector(SUN_DIRECTION, focus.dot(SUN_DIRECTION))
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, camera.right * 2.5)
}
