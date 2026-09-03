import {
  multiplyMatrices,
  normalizeVector,
  transformFromMatrix,
  transformMatrix,
  translationMatrix,
  vectorScale,
} from './math'
import type { Matrix4, RobotJoint, RobotLink, RobotModel, Vec3 } from './types'
import { validateRobot } from './validation'

const DEG_TO_RAD = Math.PI / 180
const XML_MIME_TYPE = 'application/xml;charset=utf-8'

export interface RobotUrdfExport {
  filename: string
  mimeType: typeof XML_MIME_TYPE
  xml: string
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('URDF values must be finite numbers.')
  if (Math.abs(value) < 0.0000000005) return '0'
  return value.toFixed(9).replace(/\.?0+$/, '')
}

function formatVector(vector: Vec3): string {
  return vector.map(formatNumber).join(' ')
}

function radiansVector(degrees: Vec3): Vec3 {
  return degrees.map((value) => value * DEG_TO_RAD) as Vec3
}

function originAttributes(matrix: Matrix4): string {
  const transform = transformFromMatrix(matrix)
  return `xyz="${formatVector(transform.positionM)}" rpy="${formatVector(radiansVector(transform.rotationDeg))}"`
}

function cylinderRpy(direction: Vec3): Vec3 {
  const [x, y, z] = normalizeVector(direction)
  const radial = Math.hypot(x, y)
  return [0, Math.atan2(radial, z), radial < 1e-12 ? 0 : Math.atan2(y, x)]
}

function colorRgba(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) throw new Error(`Cannot export unsupported color ${color}.`)
  return [...match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255), 1]
    .map(formatNumber)
    .join(' ')
}

function renderLink(link: RobotLink): string[] {
  const name = escapeXmlAttribute(link.id)
  if (link.lengthM === 0) return [`  <link name="${name}"/>`]

  const direction = normalizeVector(link.direction)
  const center = vectorScale(direction, link.lengthM / 2)
  const materialName = escapeXmlAttribute(`${link.id}-material`)
  return [
    `  <link name="${name}">`,
    '    <visual>',
    `      <origin xyz="${formatVector(center)}" rpy="${formatVector(cylinderRpy(direction))}"/>`,
    '      <geometry>',
    `        <cylinder radius="${formatNumber(link.radiusM)}" length="${formatNumber(link.lengthM)}"/>`,
    '      </geometry>',
    `      <material name="${materialName}">`,
    `        <color rgba="${colorRgba(link.color)}"/>`,
    '      </material>',
    '    </visual>',
    '  </link>',
  ]
}

function serialJointOrigin(robot: RobotModel, index: number): Matrix4 {
  const joint = robot.joints[index]
  if (index === 0) {
    return multiplyMatrices(transformMatrix(robot.basePose), transformMatrix(joint.origin))
  }

  const previousLink = robot.links[index - 1]
  const previousEndpoint = translationMatrix(
    vectorScale(normalizeVector(previousLink.direction), previousLink.lengthM),
  )
  return multiplyMatrices(previousEndpoint, transformMatrix(joint.origin))
}

function renderJointLimit(joint: RobotJoint): string | undefined {
  if (joint.type === 'fixed') return undefined
  if (joint.type === 'continuous' || !joint.limits) {
    return '    <limit effort="0" velocity="0"/>'
  }
  const lower = joint.type === 'prismatic' ? joint.limits.min : joint.limits.min * DEG_TO_RAD
  const upper = joint.type === 'prismatic' ? joint.limits.max : joint.limits.max * DEG_TO_RAD
  return `    <limit lower="${formatNumber(lower)}" upper="${formatNumber(upper)}" effort="0" velocity="0"/>`
}

function renderJointAtOrigin(
  joint: RobotJoint,
  parentName: string,
  childName: string,
  origin: Matrix4,
): string[] {
  const lines = [
    `  <joint name="${escapeXmlAttribute(joint.id)}" type="${joint.type}">`,
    `    <parent link="${escapeXmlAttribute(parentName)}"/>`,
    `    <child link="${escapeXmlAttribute(childName)}"/>`,
    `    <origin ${originAttributes(origin)}/>`,
  ]
  if (joint.type !== 'fixed') {
    lines.push(`    <axis xyz="${formatVector(normalizeVector(joint.axis))}"/>`)
  }
  const limit = renderJointLimit(joint)
  if (limit) lines.push(limit)
  lines.push('  </joint>')
  return lines
}

function renderSerialJoint(robot: RobotModel, index: number, rootLinkName: string): string[] {
  const joint = robot.joints[index]
  const parentName = index === 0 ? rootLinkName : robot.links[index - 1].id
  return renderJointAtOrigin(
    joint,
    parentName,
    robot.links[index].id,
    serialJointOrigin(robot, index),
  )
}

function rootLinkName(robot: RobotModel): string {
  const used = new Set(robot.links.map((link) => link.id))
  const base = `${robot.id}-root`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function safeFilename(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return `${slug || 'robot'}.urdf`
}

/**
 * Export the browser model's serial topology as a visual-only URDF.
 * Link dimensions and translations stay in metres; angular origins and limits
 * are converted from the app's degrees to URDF radians. Current joint positions
 * are state, not robot-description data, and are intentionally not baked in.
 */
export function createRobotUrdfExport(robot: RobotModel): RobotUrdfExport {
  validateRobot(robot)
  const root = rootLinkName(robot)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated by RAI — Robot Agent Interface.',
    '     Serial-chain primitive visual geometry only; units are metres and radians.',
    '     The root link is the scene frame; the robot base pose is folded into the first joint origin.',
    '     No meshes, collision/inertial physics, sensors, scene objects, or current joint positions are exported.',
    '     Effort and velocity limits are zero because this model has no actuator limit data. -->',
    `<robot name="${escapeXmlAttribute(robot.id)}">`,
    `  <link name="${escapeXmlAttribute(root)}"/>`,
  ]

  robot.links.forEach((link) => lines.push(...renderLink(link)))
  robot.joints.forEach((_joint, index) => lines.push(...renderSerialJoint(robot, index, root)))
  lines.push('</robot>', '')

  return { filename: safeFilename(robot.name), mimeType: XML_MIME_TYPE, xml: lines.join('\n') }
}
