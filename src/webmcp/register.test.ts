import { describe, expect, it, vi } from 'vitest'
import { createSimulationStore } from '../domain'
import { installWebMcpTools, isWebMcpSupported, WEBMCP_TOOL_NAMES, type WebMcpModelContext } from './index'

describe('WebMCP registration lifecycle', () => {
  it('feature-detects unsupported browsers without affecting the app', async () => {
    const registration = installWebMcpTools({ document: {}, store: createSimulationStore({ storage: null }) })
    expect(registration.supported).toBe(false)
    expect(registration.toolNames).toEqual([])
    expect(isWebMcpSupported({})).toBe(false)
    await registration.ready
  })

  it('registers all tools on document.modelContext and aborts them on disposal', async () => {
    const registrations: Array<{ name: string; signal?: AbortSignal }> = []
    const context: WebMcpModelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ name: tool.name, signal: options?.signal })
      }),
    }
    const registration = installWebMcpTools({
      document: { modelContext: context }, store: createSimulationStore({ storage: null }),
    })
    expect(registration.supported).toBe(true)
    await registration.ready
    expect(registrations.map((entry) => entry.name)).toEqual([...WEBMCP_TOOL_NAMES])
    expect(new Set(registrations.map((entry) => entry.signal)).size).toBe(1)
    expect(registrations[0].signal?.aborted).toBe(false)
    registration.dispose()
    expect(registrations[0].signal?.aborted).toBe(true)
  })

  it('cleans up an older catalog before installing a replacement', async () => {
    const signals: AbortSignal[] = []
    const context: WebMcpModelContext = {
      async registerTool(_tool, options) { if (options?.signal) signals.push(options.signal) },
    }
    const one = installWebMcpTools({ document: { modelContext: context }, store: createSimulationStore({ storage: null }) })
    await one.ready
    const firstSignal = signals[0]
    const two = installWebMcpTools({ document: { modelContext: context }, store: createSimulationStore({ storage: null }) })
    expect(firstSignal.aborted).toBe(true)
    await two.ready
    two.dispose()
  })

  it('treats disposal during registration as lifecycle cleanup rather than an error', async () => {
    const store = createSimulationStore({ storage: null })
    const context: WebMcpModelContext = {
      registerTool(_tool, options) {
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(
            options.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
          ), { once: true })
        })
      },
    }
    const registration = installWebMcpTools({ document: { modelContext: context }, store })

    registration.dispose()
    await expect(registration.ready).resolves.toBeUndefined()
    expect(store.getSnapshot().activity).not.toContainEqual(expect.objectContaining({
      action: 'webmcp_register', status: 'error',
    }))
  })

  it('does not log a stale success when a replaced catalog finishes late', async () => {
    const store = createSimulationStore({ storage: null })
    const resolvers: Array<() => void> = []
    const context: WebMcpModelContext = {
      registerTool() {
        return new Promise<void>((resolve) => { resolvers.push(resolve) })
      },
    }
    const first = installWebMcpTools({ document: { modelContext: context }, store })
    const second = installWebMcpTools({ document: { modelContext: context }, store })

    resolvers.forEach((resolve) => resolve())
    await Promise.all([first.ready, second.ready])
    expect(store.getSnapshot().activity.filter((entry) => (
      entry.action === 'webmcp_register' && entry.status === 'ok'
    ))).toHaveLength(1)
    second.dispose()
  })
})
