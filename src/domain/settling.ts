import { inverseRigidMatrix, transformMatrix, transformPoint } from './math'
import type { SceneObject, SimulationScene } from './types'

/** Exact vertical half-extent of the oriented primitive, not a bounding sphere. */
export function verticalHalfExtent(object: SceneObject): number {
  const geometry = object.geometry
  const rotation = transformMatrix(object.pose)
  if (geometry.type === 'sphere') return geometry.radiusM
  if (geometry.type === 'cylinder') {
    const axisZ = Math.min(1, Math.abs(rotation[10]))
    return axisZ * geometry.heightM / 2 + Math.sqrt(Math.max(0, 1 - axisZ * axisZ)) * geometry.radiusM
  }
  if (geometry.type === 'box') return geometry.sizeM.reduce((extent, size, index) => extent + Math.abs(rotation[8 + index]) * size / 2, 0)
  return 0
}

/** Instant vertical settling approximation. Not a force/friction/rotation solver.
 * Supports the ground and horizontal fixed box/plane surfaces under the centre.
 * It never uses task goals, object names, or a can-specific route.
 */
export function settleReleasedObject(scene: SimulationScene, objectId: string): void {
  const object = scene.objects.find((candidate) => candidate.id === objectId)
  if (!object || !object.movable || object.geometry.type === 'plane') return
  const extent = verticalHalfExtent(object)
  let supportZ = 0
  for (const surface of scene.objects) {
    if (surface.id === object.id || surface.movable || !['box', 'plane'].includes(surface.geometry.type)) continue
    const matrix = transformMatrix(surface.pose)
    if (Math.abs(Math.abs(matrix[10]) - 1) > 1e-6) continue
    const local = transformPoint(inverseRigidMatrix(matrix), object.pose.positionM)
    const size = surface.geometry.type === 'box' || surface.geometry.type === 'plane' ? surface.geometry.sizeM : [0, 0]
    if (Math.abs(local[0]) > size[0] / 2 || Math.abs(local[1]) > size[1] / 2) continue
    const top = surface.pose.positionM[2] + (surface.geometry.type === 'box' ? surface.geometry.sizeM[2] / 2 : 0)
    // A shelf above the object is not a landing surface.
    if (top <= object.pose.positionM[2] + extent + 1e-6) supportZ = Math.max(supportZ, top)
  }
  object.pose.positionM[2] = supportZ + extent
}
