import { ContactShadows, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  evaluateSimulationGoal,
  transformMatrix,
  transformPoint,
  worldPose,
  type CameraSensor,
  type ForwardKinematicsResult,
  type Quaternion,
  type RobotJoint,
  type SceneObject,
  type SimulationScene,
  type Vec3,
  type WorldPose,
} from '../domain'

export type ViewPreset = 'iso' | 'front' | 'top'
export interface CameraViewAdjustment {
  yawDeg: number
  pitchDeg: number
  distanceScale: number
}

interface SceneContentProps {
  scene: SimulationScene
  computed: ForwardKinematicsResult
  selectedId?: string
  gripperClosed?: boolean
  onSelect?: (kind: 'joint' | 'camera' | 'object', id: string) => void
  showFrustums?: boolean
  showCameraBodies?: boolean
  showAnnotations?: boolean
}

const CAMERA_DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  iso: [1, 0.72, 1],
  front: [1, 0.24, 0.001],
  top: [0.001, 1, 0.001],
}

interface ViewportFrame {
  target: [number, number, number]
  cameraPosition: [number, number, number]
  radius: number
  gridSize: number
}

function toThreePoint(point: Vec3): THREE.Vector3 {
  // The domain is Z-up; the R3F scene is Y-up.
  return new THREE.Vector3(point[0], point[2], -point[1])
}

function getViewportFrame(
  scene: SimulationScene,
  computed: ForwardKinematicsResult,
  view: ViewPreset,
  cameraView: CameraViewAdjustment,
): ViewportFrame {
  const points: Vec3[] = [scene.robot.basePose.positionM, [scene.robot.basePose.positionM[0], scene.robot.basePose.positionM[1], 0]]
  for (const link of computed.links) points.push(link.startPose.positionM, link.endPose.positionM)
  for (const object of scene.objects) {
    if (object.geometry.type !== 'plane') points.push(object.pose.positionM)
  }

  const bounds = new THREE.Box3()
  for (const point of points) bounds.expandByPoint(toThreePoint(point))
  const targetVector = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const radius = Math.max(0.24, size.length() * 0.54)
  const target = targetVector.toArray() as [number, number, number]
  const direction = new THREE.Vector3(...CAMERA_DIRECTIONS[view]).normalize()
  const distance = Math.max(0.58, radius * 2.85) * THREE.MathUtils.clamp(cameraView.distanceScale, 0.55, 1.8)
  const spherical = new THREE.Spherical().setFromVector3(direction.multiplyScalar(distance))
  spherical.theta += THREE.MathUtils.degToRad(cameraView.yawDeg)
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi - THREE.MathUtils.degToRad(cameraView.pitchDeg),
    0.1,
    Math.PI - 0.1,
  )
  const cameraPosition = targetVector.clone().add(new THREE.Vector3().setFromSpherical(spherical)).toArray() as [number, number, number]
  return { target, cameraPosition, radius, gridSize: Math.max(1.4, radius * 4.4) }
}

function ViewportCamera({ frame }: { frame: ViewportFrame }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.fromArray(frame.cameraPosition)
    camera.lookAt(...frame.target)
    camera.updateProjectionMatrix()
  }, [camera, frame])
  return null
}

function CylinderBetween({
  start,
  end,
  radius,
  color,
  selected,
  onSelect,
}: {
  start: Vec3
  end: Vec3
  radius: number
  color: string
  selected: boolean
  onSelect?: () => void
}) {
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...start)
    const b = new THREE.Vector3(...end)
    const delta = b.clone().sub(a)
    const length = Math.max(delta.length(), 0.004)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.lengthSq() > 1e-10 ? delta.normalize() : new THREE.Vector3(0, 1, 0),
    )
    return { midpoint: a.add(b).multiplyScalar(0.5), length, quaternion }
  }, [start, end])

  return (
    <mesh
      castShadow
      receiveShadow
      position={transform.midpoint}
      quaternion={transform.quaternion}
      onPointerDown={(event) => { event.stopPropagation(); onSelect?.() }}
    >
      <cylinderGeometry args={[Math.max(radius, 0.006), Math.max(radius, 0.006), transform.length, 24]} />
      <meshStandardMaterial
        color={selected ? '#9bd1ff' : color}
        emissive={selected ? '#214668' : '#0c0e11'}
        emissiveIntensity={selected ? 0.8 : 0}
        metalness={0.12}
        roughness={0.72}
      />
    </mesh>
  )
}

function jointAxisQuaternion(joint: RobotJoint | undefined, poseQuaternion: Quaternion | undefined): THREE.Quaternion {
  const frameQuaternion = poseQuaternion ? new THREE.Quaternion(...poseQuaternion) : new THREE.Quaternion()
  if (!joint) return frameQuaternion
  const axis = new THREE.Vector3(...joint.axis)
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0)
  const localAlignment = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize())
  return frameQuaternion.multiply(localAlignment)
}

function JointMotor({
  position,
  joint,
  poseQuaternion,
  selected,
  compact = false,
  onSelect,
}: {
  position: Vec3
  joint?: RobotJoint
  poseQuaternion?: Quaternion
  selected: boolean
  compact?: boolean
  onSelect?: () => void
}) {
  const quaternion = useMemo(() => jointAxisQuaternion(joint, poseQuaternion), [joint, poseQuaternion])
  const radius = compact ? 0.027 : 0.033
  const width = compact ? 0.038 : 0.046
  const bodyColor = selected ? '#bce2ff' : '#62717d'
  return (
    <group
      position={position}
      quaternion={quaternion}
      onPointerDown={(event) => { event.stopPropagation(); onSelect?.() }}
    >
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, width, 20]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={selected ? '#2d6692' : '#11151a'}
          emissiveIntensity={selected ? 0.8 : 0.12}
          metalness={0.14}
          roughness={0.68}
        />
      </mesh>
      {selected ? <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.13, 0.0025, 8, 24]} />
        <meshBasicMaterial color="#bfe5ff" />
      </mesh> : null}
    </group>
  )
}

function EndEffectorTool({ pose, closed }: { pose: WorldPose; closed: boolean }) {
  const quaternion = useMemo(() => new THREE.Quaternion(...pose.quaternionXyzw), [pose.quaternionXyzw])
  const opening = closed ? 0.018 : 0.032
  return (
    <group position={pose.positionM} quaternion={quaternion}>
      <mesh castShadow position={[0.012, 0, 0]}>
        <boxGeometry args={[0.034, 0.065, 0.05]} />
        <meshStandardMaterial color="#303841" metalness={0.76} roughness={0.26} />
      </mesh>
      <mesh castShadow position={[0.032, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.021, 0.021, 0.02, 24]} />
        <meshStandardMaterial color="#778796" metalness={0.82} roughness={0.22} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[0.07, side * opening, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.076, 0.012, 0.018]} />
            <meshStandardMaterial color="#9ca9b5" metalness={0.74} roughness={0.27} />
          </mesh>
          <mesh castShadow position={[0.034, -side * 0.006, 0]}>
            <boxGeometry args={[0.018, 0.024, 0.021]} />
            <meshStandardMaterial color="#20262c" metalness={0.45} roughness={0.46} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function ObjectMesh({ object, selected, grasped, onSelect }: { object: SceneObject; selected: boolean; grasped: boolean; onSelect?: () => void }) {
  // Share the domain's Rz * Ry * Rx transform, including compound rotations.
  const quaternion = worldPose(transformMatrix(object.pose)).quaternionXyzw
  const material = (
    <meshStandardMaterial
      color={selected ? '#ffffff' : object.color}
      emissive={selected || grasped ? object.color : '#000000'}
      emissiveIntensity={selected ? 0.4 : grasped ? 0.22 : 0}
      roughness={0.62}
      metalness={0.08}
    />
  )
  const geometry = object.geometry.type === 'box'
    ? <boxGeometry args={object.geometry.sizeM} />
    : object.geometry.type === 'sphere'
      ? <sphereGeometry args={[object.geometry.radiusM, 28, 20]} />
      : object.geometry.type === 'cylinder'
        ? <cylinderGeometry args={[object.geometry.radiusM, object.geometry.radiusM, object.geometry.heightM, 28]} />
        : <planeGeometry args={object.geometry.sizeM} />

  return (
    <group position={object.pose.positionM} quaternion={quaternion}>
      <mesh
        castShadow={object.geometry.type !== 'plane'}
        receiveShadow
        rotation={object.geometry.type === 'cylinder' ? [Math.PI / 2, 0, 0] : undefined}
        onPointerDown={(event) => { event.stopPropagation(); onSelect?.() }}
      >
        {geometry}
        {material}
      </mesh>
    </group>
  )
}

function RobotBaseMount({ position }: { position: Vec3 }) {
  const height = Math.max(position[2], 0.028)
  const start: Vec3 = [position[0], position[1], 0]
  const end: Vec3 = [position[0], position[1], height]
  return (
    <group>
      <CylinderBetween start={start} end={end} radius={0.052} color="#303840" selected={false} />
      <mesh castShadow receiveShadow position={[position[0], position[1], 0.009]}>
        <cylinderGeometry args={[0.086, 0.092, 0.018, 36]} />
        <meshStandardMaterial color="#1d2329" metalness={0.72} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[position[0], position[1], Math.max(0.021, height - 0.012)]}>
        <cylinderGeometry args={[0.064, 0.064, 0.024, 32]} />
        <meshStandardMaterial color="#687785" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh castShadow position={[position[0], position[1], height + 0.003]}>
        <cylinderGeometry args={[0.056, 0.056, 0.012, 32]} />
        <meshStandardMaterial color="#252b31" metalness={0.82} roughness={0.23} />
      </mesh>
    </group>
  )
}

function GoalMarker({ position, succeeded }: { position: Vec3; succeeded: boolean }) {
  const color = succeeded ? '#80b493' : '#d2aa6c'
  return (
    <group position={position}>
      <mesh>
        <torusGeometry args={[0.036, 0.0024, 8, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <Line points={[[-0.05, 0, 0], [0.05, 0, 0]]} color={color} lineWidth={1} transparent opacity={0.72} />
      <Line points={[[0, -0.05, 0], [0, 0.05, 0]]} color={color} lineWidth={1} transparent opacity={0.72} />
      <Line points={[[0, 0, -0.035], [0, 0, 0.055]]} color={color} lineWidth={1} transparent opacity={0.72} />
    </group>
  )
}

function CameraFrustum({ camera, frame, selected, showFrustum, onSelect }: {
  camera: CameraSensor
  frame: ForwardKinematicsResult['cameras'][number]
  selected: boolean
  showFrustum: boolean
  onSelect?: () => void
}) {
  const { origin, corners, quaternion } = useMemo(() => {
    const depth = Math.min(camera.projection.farM, 0.34)
    const halfWidth = depth * Math.tan(THREE.MathUtils.degToRad(camera.projection.horizontalFovDeg / 2))
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.projection.verticalFovDeg / 2))
    const matrix = frame.pose.matrix
    return {
      origin: frame.pose.positionM,
      quaternion: new THREE.Quaternion(...frame.pose.quaternionXyzw),
      corners: [
        transformPoint(matrix, [depth, -halfWidth, -halfHeight]),
        transformPoint(matrix, [depth, halfWidth, -halfHeight]),
        transformPoint(matrix, [depth, halfWidth, halfHeight]),
        transformPoint(matrix, [depth, -halfWidth, halfHeight]),
      ] as Vec3[],
    }
  }, [camera, frame])

  const color = selected ? '#bfe5ff' : '#74aee0'

  return (
    <group>
      <group
        position={origin}
        quaternion={quaternion}
        onPointerDown={(event) => { event.stopPropagation(); onSelect?.() }}
      >
        <mesh castShadow position={[0.018, 0, 0]}>
          <boxGeometry args={[0.036, 0.046, 0.032]} />
          <meshStandardMaterial color={selected ? '#d9efff' : '#343941'} metalness={0.72} roughness={0.32} />
        </mesh>
        <mesh castShadow position={[0.042, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.015, 0.018, 20]} />
          <meshStandardMaterial color="#111317" metalness={0.35} roughness={0.28} />
        </mesh>
      </group>
      {showFrustum ? <>
        {[0, 1, 2, 3].map((index) => (
          <Line key={index} points={[origin, corners[index]]} color={color} lineWidth={selected ? 1.6 : 0.8} transparent opacity={0.72} />
        ))}
        <Line points={[...corners, corners[0]]} color={color} lineWidth={selected ? 1.6 : 0.8} transparent opacity={0.72} />
      </> : null}
    </group>
  )
}

export function SceneContent({ scene, computed, selectedId, gripperClosed = false, onSelect, showFrustums = true, showCameraBodies = true, showAnnotations = true }: SceneContentProps) {
  const goalEvaluation = evaluateSimulationGoal(scene)
  const goalPosition = scene.goal?.type === 'object-at-position' || scene.goal?.type === 'end-effector-at-position'
    ? scene.goal.targetPositionM
    : undefined
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <RobotBaseMount position={scene.robot.basePose.positionM} />
      {scene.objects.map((object) => (
        <ObjectMesh
          key={object.id}
          object={object}
          selected={showAnnotations && selectedId === object.id}
          grasped={showAnnotations && scene.grasp?.objectId === object.id}
          onSelect={() => onSelect?.('object', object.id)}
        />
      ))}

      {showAnnotations && goalPosition ? <GoalMarker position={goalPosition} succeeded={goalEvaluation.succeeded} /> : null}

      {computed.links.map((frame) => {
        const linkIndex = scene.robot.links.findIndex((candidate) => candidate.id === frame.linkId)
        const link = scene.robot.links[linkIndex]
        const joint = scene.robot.joints[linkIndex]
        const jointFrame = computed.joints.find((candidate) => candidate.jointId === joint?.id)
        if (!link || !joint) return null
        return (
          <group key={link.id}>
            <CylinderBetween
              start={frame.startPose.positionM}
              end={frame.endPose.positionM}
              radius={Math.max(link.radiusM, 0.013)}
              color={link.color}
              selected={selectedId === joint.id || selectedId === link.id}
              onSelect={() => onSelect?.('joint', joint.id)}
            />
            <JointMotor
              position={frame.startPose.positionM}
              poseQuaternion={jointFrame?.pose.quaternionXyzw}
              joint={joint}
              selected={selectedId === joint.id}
              onSelect={() => onSelect?.('joint', joint.id)}
            />
          </group>
        )
      })}
      <EndEffectorTool pose={computed.endEffector} closed={Boolean(scene.grasp) || gripperClosed} />

      {showCameraBodies && scene.cameras.map((camera) => {
        const frame = computed.cameras.find((candidate) => candidate.cameraId === camera.id)
        return frame ? (
          <CameraFrustum
            key={camera.id}
            camera={camera}
            frame={frame}
            selected={selectedId === camera.id}
            showFrustum={showFrustums && selectedId === camera.id}
            onSelect={() => onSelect?.('camera', camera.id)}
          />
        ) : null
      })}

      {showAnnotations ? <><Line points={[[0, 0, 0], [0.12, 0, 0]]} color="#e98787" lineWidth={1.4} />
      <Line points={[[0, 0, 0], [0, 0.12, 0]]} color="#79b991" lineWidth={1.4} />
      <Line points={[[0, 0, 0], [0, 0, 0.12]]} color="#74aee0" lineWidth={1.4} /></> : null}
    </group>
  )
}

export function RobotViewport({
  scene,
  computed,
  selectedId,
  onSelect,
  view,
  cameraView,
  gripperClosed = false,
}: SceneContentProps & { view: ViewPreset; cameraView: CameraViewAdjustment }) {
  const viewportFrame = useMemo(
    () => getViewportFrame(scene, computed, view, cameraView),
    [cameraView, computed, scene, view],
  )

  return (
    <Canvas
      role="img"
      aria-label={`Interactive 3D browser simulation of ${scene.robot.name}`}
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: viewportFrame.cameraPosition, fov: 44, near: 0.01, far: 50 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onPointerMissed={() => undefined}
    >
      <ViewportCamera frame={viewportFrame} />
      <color attach="background" args={['#141517']} />
      <fog attach="fog" args={['#141517', 1.7, 4]} />
      <hemisphereLight args={['#dbeeff', '#171a1f', 1.45]} />
      <directionalLight castShadow position={[0.7, 1.2, 0.6]} intensity={2.5} color="#e9f3ff" shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-0.8, 0.45, -0.4]} intensity={0.7} color="#6b9fcc" />
      <gridHelper args={[viewportFrame.gridSize, 36, '#47515c', '#282d32']} position={[0, -0.013, 0]} />
      <SceneContent scene={scene} computed={computed} selectedId={selectedId} gripperClosed={gripperClosed} onSelect={onSelect} />
      <ContactShadows
        position={[viewportFrame.target[0], -0.011, viewportFrame.target[2]]}
        opacity={0.42}
        scale={viewportFrame.gridSize}
        blur={2.7}
        far={Math.max(1.1, viewportFrame.radius * 2.2)}
      />
      <OrbitControls
        makeDefault
        target={viewportFrame.target}
        minDistance={Math.max(0.18, viewportFrame.radius * 0.42)}
        maxDistance={Math.max(3.2, viewportFrame.radius * 8)}
        enablePan={false}
        enableDamping
        dampingFactor={0.09}
      />
    </Canvas>
  )
}
