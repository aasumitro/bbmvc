import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Building blocks shared by vehicle and arena assets. Conventions: metres,
// +Y up, +Z forward (the glTF convention, so imported models drop in facing
// the same way). Avoid negative scales — merged geometry keeps its winding.

export type Vec3 = [number, number, number]

// A mesh at `position`, rotated by `rotation` = [x, y, z] radians applied yaw
// (y) first, then pitch (x), then roll (z) — heading first, then tilt.
export function part(geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ')
  return mesh
}

const UP = new THREE.Vector3(0, 1, 0)

// Straight cylinder from a to b.
export function tube(a: Vec3, b: Vec3, radius: number, radialSegments = 10) {
  const start = new THREE.Vector3(...a)
  const axis = new THREE.Vector3(...b).sub(start)
  const geometry = new THREE.CylinderGeometry(radius, radius, axis.length(), radialSegments)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize()))
  geometry.translate(...start.addScaledVector(axis, 0.5).toArray())
  return geometry
}

// Tube bent through the points with tight, welded-looking corners.
export function bentTube(points: Vec3[], radius: number, radialSegments = 8) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.15,
  )
  return new THREE.TubeGeometry(curve, points.length * 10, radius, radialSegments, false)
}

// A 2D profile drawn in (z, y) and extruded symmetrically along x. The bevel
// sits inside the outline, so dimensions stay exact while every edge gets a
// rounded lip that catches highlights instead of reading as CG-sharp.
export function extrudeProfile(shape: THREE.Shape, width: number, bevel = 0.02, curveSegments = 16) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(width - 2 * bevel, 0.001),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments,
  })
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), UP, new THREE.Vector3(-1, 0, 0)))
  geometry.translate(width / 2 - bevel, 0, 0)
  return geometry
}

// Square lattice truss from a to b — towers, crane booms, gantries.
export function truss(a: Vec3, b: Vec3, width: number, bays: number, chordRadius = 0.08, braceRadius = 0.04) {
  const start = new THREE.Vector3(...a)
  const axis = new THREE.Vector3(...b).sub(start)
  const side = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > axis.length() * 0.99 ? new THREE.Vector3(1, 0, 0) : UP).normalize()
  const up = new THREE.Vector3().crossVectors(side, axis).normalize()
  const corners = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([s, u]) =>
    side
      .clone()
      .multiplyScalar((s * width) / 2)
      .addScaledVector(up, (u * width) / 2),
  )
  const at = (corner: number, t: number) =>
    start
      .clone()
      .addScaledVector(axis, t)
      .add(corners[corner % 4])
      .toArray() as Vec3

  const pieces: THREE.BufferGeometry[] = []
  for (let c = 0; c < 4; c++) pieces.push(tube(at(c, 0), at(c, 1), chordRadius, 6))
  for (let i = 0; i < bays; i++) {
    const t0 = i / bays
    const t1 = (i + 1) / bays
    for (let c = 0; c < 4; c++) {
      pieces.push(tube(at(c, t0), at(c + 1, t0), braceRadius, 5))
      pieces.push(tube(at(c, i % 2 ? t0 : t1), at(c + 1, i % 2 ? t1 : t0), braceRadius, 5))
    }
  }
  for (let c = 0; c < 4; c++) pieces.push(tube(at(c, 1), at(c + 1, 1), braceRadius, 5))
  return mergeGeometries(pieces)
}

// Box-projected uvs in metres: each triangle is mapped from the axis plane
// its face normal points along most, so baked tiles keep one texel density
// on every part regardless of its size. Returns non-indexed geometry.
export function boxUV(source: THREE.BufferGeometry) {
  const geometry = source.index ? source.toNonIndexed() : source
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge = new THREE.Vector3()
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    normal.subVectors(c, b).cross(edge.subVectors(a, b))
    const x = Math.abs(normal.x)
    const y = Math.abs(normal.y)
    const z = Math.abs(normal.z)
    ;[a, b, c].forEach((p, k) => {
      const [u, v] = x >= y && x >= z ? [p.z, p.y] : y >= z ? [p.x, p.z] : [p.x, p.y]
      uv[(i + k) * 2] = u
      uv[(i + k) * 2 + 1] = v
    })
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geometry
}

const MERGED_ATTRIBUTES = new Set(['position', 'normal', 'uv'])

// Collapses every mesh under `root` into one mesh per material, in root's
// local space. A prop-heavy arena becomes a handful of draw calls. Anything
// that must move on its own (wheels, turret) belongs outside `root`.
export function mergeByMaterial(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
    const material = object.material as THREE.Material
    const placed = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, object.matrixWorld))
    const geometry = material.userData.ownUVs ? placed.toNonIndexed() : boxUV(placed)
    for (const name of Object.keys(geometry.attributes)) {
      if (!MERGED_ATTRIBUTES.has(name)) geometry.deleteAttribute(name)
    }
    const bucket = buckets.get(material) ?? []
    bucket.push(geometry)
    buckets.set(material, bucket)
  })

  const merged = new THREE.Group()
  for (const [material, geometries] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
    mesh.name = material.name
    mesh.castShadow = !material.transparent // glows and decals laid over the scene cast nothing
    mesh.receiveShadow = true
    merged.add(mesh)
  }
  return merged
}

// Many copies of one geometry in a single draw call, optionally tinted per copy.
export function scatter(geometry: THREE.BufferGeometry, material: THREE.Material, transforms: THREE.Matrix4[], tints?: THREE.Color[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
  transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
  tints?.forEach((tint, i) => mesh.setColorAt(i, tint))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  return mesh
}

// Instance transform from position, rotation (same convention as part()) and uniform scale.
export function transform(position: Vec3, rotation: Vec3 = [0, 0, 0], scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'YXZ')),
    new THREE.Vector3(scale, scale, scale),
  )
}

// Frees the GPU buffers of every mesh under root. Materials come from the
// shared library and outlive any one scene, so they are left alone.
export function disposeGeometries(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
  })
}
