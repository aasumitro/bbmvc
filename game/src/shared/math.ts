// An angle in radians, brought into -π..π.
export const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

// A place on the ground plane, metres (north is -z).
export interface Point {
  x: number
  z: number
}

// How far apart two places are on the ground, height aside.
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
