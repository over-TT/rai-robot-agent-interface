import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CameraSensor, ForwardKinematicsResult, SimulationScene } from '../domain'
import { fitSensorFrame, SENSOR_HORIZONTAL_SCALE, sensorPerspectiveFromFov } from '../lib/sensorProjection'
import { SceneContent } from './RobotScene'

function simToThree([x, y, z]: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y)
}

function SensorCamera({ cameraSensor, frame }: { cameraSensor: CameraSensor; frame: ForwardKinematicsResult['cameras'][number] }) {
  const { camera } = useThree()
  const perspective = sensorPerspectiveFromFov(
    cameraSensor.projection.horizontalFovDeg,
    cameraSensor.projection.verticalFovDeg,
  )

  const applyProjection = () => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const near = Math.max(0.0001, cameraSensor.projection.nearM)
    const far = Math.max(near + 0.0001, cameraSensor.projection.farM)
    if (
      camera.fov !== perspective.verticalFovDeg
      || camera.aspect !== perspective.aspect
      || camera.near !== near
      || camera.far !== far
    ) {
      camera.fov = perspective.verticalFovDeg
      camera.aspect = perspective.aspect
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
    }
  }

  useEffect(() => {
    const matrix = frame.pose.matrix
    const position = simToThree(frame.pose.positionM)
    const forward = simToThree([matrix[0], matrix[4], matrix[8]]).normalize()
    const up = simToThree([matrix[2], matrix[6], matrix[10]]).normalize()
    camera.position.copy(position)
    camera.up.copy(up)
    camera.lookAt(position.clone().add(forward))
    applyProjection()
  }, [camera, cameraSensor, frame, perspective.aspect, perspective.verticalFovDeg])

  // React Three Fiber normally follows the canvas aspect on resize. Restore the
  // calibrated sensor frustum whenever that renderer update changes the camera.
  useFrame(applyProjection)

  return null
}

export function SensorViewport({
  scene,
  computed,
  cameraId,
  gripperClosed = false,
}: {
  scene: SimulationScene
  computed: ForwardKinematicsResult
  cameraId?: string
  gripperClosed?: boolean
}) {
  const cameraSensor = scene.cameras.find((camera) => camera.id === cameraId) ?? scene.cameras[0]
  const frame = computed.cameras.find((candidate) => candidate.cameraId === cameraSensor?.id)
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [cameraSensor?.id])

  if (!cameraSensor || !frame) {
    return (
      <div className="sensor-empty">
        <span>No camera attached</span>
        <small>Add a camera preset to render its point of view.</small>
      </div>
    )
  }

  const perspective = sensorPerspectiveFromFov(
    cameraSensor.projection.horizontalFovDeg,
    cameraSensor.projection.verticalFovDeg,
  )
  const fitted = fitSensorFrame(size.width, size.height, perspective.aspect)

  return (
    <div ref={stage} className="sensor-stage" aria-label={`Idealized view from ${cameraSensor.name}`}>
      <div className="sensor-frame" style={fitted}>
      <Canvas style={{ transform: `scaleX(${SENSOR_HORIZONTAL_SCALE})` }} role="img" aria-label={`Idealized pinhole rendering from ${cameraSensor.name}`} dpr={[1, 1.5]} camera={{ fov: perspective.verticalFovDeg, aspect: perspective.aspect, near: cameraSensor.projection.nearM, far: cameraSensor.projection.farM }}>
        <color attach="background" args={['#0b0d10']} />
        <ambientLight intensity={1.45} />
        <directionalLight position={[0.7, 1.2, 0.6]} intensity={2.4} />
        <SceneContent scene={scene} computed={computed} gripperClosed={gripperClosed} showCameraBodies={false} showFrustums={false} />
        <SensorCamera cameraSensor={cameraSensor} frame={frame} />
      </Canvas>
      <div className="sensor-reticle" aria-hidden="true"><i /><b /></div>
      <div className="sensor-readout">
        <span>IDEAL PINHOLE</span>
        <span>{cameraSensor.projection.horizontalFovDeg}° × {cameraSensor.projection.verticalFovDeg}°</span>
      </div>
      </div>
    </div>
  )
}
