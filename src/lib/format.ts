import type { Vec3 } from '../domain'

export function mm(valueM: number): string {
  return `${Math.round(valueM * 1000)} mm`
}

export function degrees(value: number): string {
  return `${Math.round(value * 10) / 10}°`
}

export function vectorMm(value: Vec3): string {
  return value.map((component) => Math.round(component * 1000)).join(', ')
}

export function compactTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

