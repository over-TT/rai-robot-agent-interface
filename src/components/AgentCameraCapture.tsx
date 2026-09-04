import { Canvas, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { computeSceneKinematics, simulationStore, SimulationError, type SimulationState } from '../domain'
import { registerCameraCapture } from '../webmcp/cameraCapture'
import { applySensorCamera } from '../lib/sensorCamera'
import { sensorCaptureSize, sensorPerspectiveFromFov } from '../lib/sensorProjection'
import { SceneContent } from './RobotScene'

function Capture({ state }: { state: SimulationState }) {
  const { gl, scene, camera } = useThree()
  const computed = useMemo(() => computeSceneKinematics(state.scene), [state.scene])
  const sensor = state.scene.cameras.find((item) => item.id === state.operation?.cameraId)
  const frame = computed.cameras.find((item) => item.cameraId === sensor?.id)
  useLayoutEffect(() => registerCameraCapture(async (request) => {
    request.signal.throwIfAborted()
    if (!sensor || !frame || !(camera instanceof THREE.PerspectiveCamera) || gl.getContext().isContextLost()) {
      throw new SimulationError('CAMERA_UNAVAILABLE', 'Camera rendering is unavailable. Retry after the view recovers.')
    }
    if (request.revision !== state.revision || request.trialId !== state.operation?.trialId || request.cameraId !== sensor.id) {
      throw new SimulationError('CAMERA_UNAVAILABLE', 'Camera pose is still updating. Observe again before moving.')
    }
    applySensorCamera(camera, sensor, frame)
    gl.render(scene, camera)
    const output = document.createElement('canvas')
    output.width = gl.domElement.width
    output.height = gl.domElement.height
    const context = output.getContext('2d')
    if (!context || !output.width || !output.height) throw new SimulationError('CAMERA_UNAVAILABLE', 'Camera frame could not be encoded.')
    // CSS mirroring in the human viewport is not included by toDataURL.
    context.translate(output.width, 0)
    context.scale(-1, 1)
    context.drawImage(gl.domElement, 0, 0)
    const encoded = output.toDataURL('image/jpeg', 0.85)
    if (!encoded.startsWith('data:image/jpeg;base64,')) throw new SimulationError('CAMERA_UNAVAILABLE', 'Camera JPEG encoding failed.')
    return { revision: state.revision, trialId: request.trialId, width: output.width, height: output.height, data: encoded.split(',')[1] }
  }), [state, computed, sensor, frame, gl, scene, camera])
  return <>
    <color attach="background" args={['#0b0d10']} />
    <ambientLight intensity={1.45} />
    <directionalLight position={[0.7, 1.2, 0.6]} intensity={2.4} />
    <SceneContent scene={state.scene} computed={computed} gripperClosed={state.operation?.gripper === 'closed'} showCameraBodies={false} showFrustums={false} showAnnotations={false} />
  </>
}

/** One on-demand, sensor-only renderer; never captures replay or the page UI. */
export function AgentCameraCapture() {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const sensor = state.scene.cameras.find((item) => item.id === state.operation?.cameraId)
  if (state.phase !== 'operate' || !sensor) return null
  const { aspect } = sensorPerspectiveFromFov(sensor.projection.horizontalFovDeg, sensor.projection.verticalFovDeg)
  const { width, height } = sensorCaptureSize(aspect)
  return <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width, height, pointerEvents: 'none' }}>
    <Canvas dpr={1} frameloop="demand"><Capture state={state} /></Canvas>
  </div>
}
