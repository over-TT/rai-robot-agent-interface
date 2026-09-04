import * as THREE from 'three'
import type { CameraSensor, ForwardKinematicsResult } from '../domain'
import { sensorPerspectiveFromFov } from './sensorProjection'

export function applySensorCamera(camera: THREE.PerspectiveCamera, sensor: CameraSensor, frame: ForwardKinematicsResult['cameras'][number]) {
  const map = ([x, y, z]: number[]) => new THREE.Vector3(x, z, -y)
  const matrix = frame.pose.matrix
  const forward = map([matrix[0], matrix[4], matrix[8]]).normalize()
  camera.position.copy(map(frame.pose.positionM))
  camera.up.copy(map([matrix[2], matrix[6], matrix[10]]).normalize())
  camera.lookAt(camera.position.clone().add(forward))
  const projection = sensorPerspectiveFromFov(sensor.projection.horizontalFovDeg, sensor.projection.verticalFovDeg)
  camera.fov = projection.verticalFovDeg
  camera.aspect = projection.aspect
  camera.near = sensor.projection.nearM
  camera.far = sensor.projection.farM
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}
