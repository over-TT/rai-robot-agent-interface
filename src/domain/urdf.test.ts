import { describe, expect, it } from 'vitest'
import { createRobotUrdfExport, getRobotPreset, type RobotModel } from './index'

function parseXml(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  expect(document.querySelector('parsererror')).toBeNull()
  return document
}

describe('URDF export', () => {
  it('exports the supported serial chain with primitive visual geometry', () => {
    const robot = getRobotPreset('generic-2r')!.robot
    const exported = createRobotUrdfExport(robot)
    const document = parseXml(exported.xml)

    expect(exported.filename).toBe('generic-2r-planar-arm.urdf')
    expect(document.documentElement.getAttribute('name')).toBe(robot.id)
    expect(document.querySelectorAll('link')).toHaveLength(3)
    expect(document.querySelectorAll('joint')).toHaveLength(2)

    const secondJoint = Array.from(document.querySelectorAll('joint'))
      .find((joint) => joint.getAttribute('name') === '2r-j2')
    expect(secondJoint?.querySelector('parent')?.getAttribute('link')).toBe('2r-l1')
    expect(secondJoint?.querySelector('child')?.getAttribute('link')).toBe('2r-l2')
    expect(secondJoint?.querySelector('origin')?.getAttribute('xyz')).toBe('0.25 0 0')

    const firstLink = Array.from(document.querySelectorAll('link'))
      .find((link) => link.getAttribute('name') === '2r-l1')
    expect(firstLink?.querySelector('visual origin')?.getAttribute('xyz')).toBe('0.125 0 0')
    expect(firstLink?.querySelector('visual origin')?.getAttribute('rpy')).toBe('0 1.570796327 0')
    expect(firstLink?.querySelector('cylinder')?.getAttribute('radius')).toBe('0.02')
    expect(firstLink?.querySelector('cylinder')?.getAttribute('length')).toBe('0.25')
  })

  it('converts angular data to radians while preserving metre-based translations', () => {
    const robot: RobotModel = {
      id: 'mixed-chain',
      name: 'Mixed chain',
      basePose: { positionM: [1, 2, 3], rotationDeg: [0, 0, 90] },
      joints: [
        {
          id: 'mount', name: 'Mount', type: 'fixed', axis: [0, 0, 1], position: 0,
          origin: { positionM: [0.1, 0, 0], rotationDeg: [0, 0, 0] },
        },
        {
          id: 'slide', name: 'Slide', type: 'prismatic', axis: [2, 0, 0], position: 0.2,
          limits: { min: 0, max: 0.4 },
          origin: { positionM: [0, 0, 0.2], rotationDeg: [0, 0, 0] },
        },
        {
          id: 'spin', name: 'Spin', type: 'continuous', axis: [0, 0, -3], position: 45,
          origin: { positionM: [0, 0, 0], rotationDeg: [10, 20, 30] },
        },
      ],
      links: [
        { id: 'mount-link', name: 'Mount link', lengthM: 0.1, radiusM: 0.01, color: '#ffffff', direction: [0, 0, 1] },
        { id: 'slide-link', name: 'Slide link', lengthM: 0.2, radiusM: 0.01, color: '#000000', direction: [1, 0, 0] },
        { id: 'spin-link', name: 'Spin link', lengthM: 0, radiusM: 0.01, color: '#123456', direction: [1, 0, 0] },
      ],
      metadata: { accuracy: 'synthetic-reference', note: 'URDF unit conversion test.' },
    }

    const firstExport = createRobotUrdfExport(robot)
    const document = parseXml(firstExport.xml)
    const joints = Array.from(document.querySelectorAll('joint'))
    const mount = joints.find((joint) => joint.getAttribute('name') === 'mount')!
    const slide = joints.find((joint) => joint.getAttribute('name') === 'slide')!
    const spin = joints.find((joint) => joint.getAttribute('name') === 'spin')!

    expect(mount.querySelector('origin')?.getAttribute('xyz')).toBe('1 2.1 3')
    expect(mount.querySelector('origin')?.getAttribute('rpy')).toBe('0 0 1.570796327')
    expect(slide.querySelector('origin')?.getAttribute('xyz')).toBe('0 0 0.3')
    expect(slide.querySelector('axis')?.getAttribute('xyz')).toBe('1 0 0')
    expect(slide.querySelector('limit')?.getAttribute('lower')).toBe('0')
    expect(slide.querySelector('limit')?.getAttribute('upper')).toBe('0.4')
    expect(spin.querySelector('axis')?.getAttribute('xyz')).toBe('0 0 -1')
    expect(spin.querySelector('limit')?.hasAttribute('lower')).toBe(false)

    robot.joints[1].position = 0.3
    robot.joints[2].position = -30
    expect(createRobotUrdfExport(robot).xml).toBe(firstExport.xml)
  })

  it('produces injection-safe visual-only XML and a safe browser filename', () => {
    const robot = getRobotPreset('arm-alliance')!.robot
    robot.name = 'Röbot </robot><script>alert(1)</script>'
    robot.joints[0].name = 'Base <script>ignored()</script>'
    robot.links[0].name = 'Link & "display name"'

    const exported = createRobotUrdfExport(robot)
    const document = parseXml(exported.xml)
    const zeroLengthLink = Array.from(document.querySelectorAll('link'))
      .find((link) => link.getAttribute('name') === 'aa-camera-mount')

    expect(exported.filename).toMatch(/^[a-z0-9-]+\.urdf$/)
    expect(exported.mimeType).toBe('application/xml;charset=utf-8')
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelectorAll('mesh, collision, inertial, gazebo, transmission')).toHaveLength(0)
    expect(zeroLengthLink?.querySelector('visual')).toBeNull()
    expect(exported.xml).toContain('Serial-chain primitive visual geometry only; units are metres and radians.')
    expect(exported.xml).toContain('No meshes, collision/inertial physics')
  })

})
