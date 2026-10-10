import type * as THREE from 'three'

// Mud and dust collect near the ground on everything — wheels, sills,
// barrier feet, container bottoms. A world-height band with a noisy edge
// darkens, roughens and de-metals whatever surface it covers. Works for
// instanced meshes too. Install with `material.onBeforeCompile = addGroundGrime`.
export function addGroundGrime(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrimeWorld;').replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
      vec4 grimePosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        grimePosition = instanceMatrix * grimePosition;
      #endif
      vGrimeWorld = (modelMatrix * grimePosition).xyz;`,
  )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vGrimeWorld;
      float grime;
      float grimeHash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1) * 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float grimeNoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(grimeHash(i), grimeHash(i + vec3(1, 0, 0)), f.x), mix(grimeHash(i + vec3(0, 1, 0)), grimeHash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(grimeHash(i + vec3(0, 0, 1)), grimeHash(i + vec3(1, 0, 1)), f.x), mix(grimeHash(i + vec3(0, 1, 1)), grimeHash(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float grimeLine = 0.2 + 0.75 * grimeNoise(vGrimeWorld * 2.3) + 0.3 * grimeNoise(vGrimeWorld * 9.0);
      grime = (1.0 - smoothstep(0.0, grimeLine, vGrimeWorld.y)) * 0.85;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.052, 0.036), grime);`,
    )
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, grime);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, grime);')
}
