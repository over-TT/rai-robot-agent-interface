import { simulationStore, type SimulationStore } from '../domain'
import { createWebMcpToolDefinitions } from './tools'
import type { WebMcpDocument, WebMcpModelContext, WebMcpRegistration } from './types'

const activeRegistrations = new WeakMap<object, AbortController>()

export interface InstallWebMcpOptions {
  store?: SimulationStore
  document?: WebMcpDocument
  exposedTo?: string[]
}

function currentDocument(): WebMcpDocument | undefined {
  return typeof document === 'undefined' ? undefined : document as unknown as WebMcpDocument
}

/**
 * Installs the fixed WebMCP catalog and immediately returns a lifecycle handle.
 * Calling dispose() aborts the registration signal, which unregisters every tool.
 */
export function installWebMcpTools(options: InstallWebMcpOptions = {}): WebMcpRegistration {
  const store = options.store ?? simulationStore
  const modelContext = (options.document ?? currentDocument())?.modelContext
  const tools = createWebMcpToolDefinitions(store)
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return { supported: false, toolNames: [], ready: Promise.resolve(), dispose() {} }
  }

  activeRegistrations.get(modelContext as object)?.abort()
  const controller = new AbortController()
  activeRegistrations.set(modelContext as object, controller)
  const registrationOptions = {
    signal: controller.signal,
    ...(options.exposedTo ? { exposedTo: [...options.exposedTo] } : {}),
  }

  const ready = Promise.all(tools.map((tool) => modelContext.registerTool(tool, registrationOptions)))
    .then(() => {
      if (controller.signal.aborted || activeRegistrations.get(modelContext as object) !== controller) return
      store.logActivity({ source: 'system', action: 'webmcp_register', status: 'ok', summary: `Registered ${tools.length} WebMCP tools.` })
    })
    .catch((error: unknown) => {
      const lifecycleCancellation = controller.signal.aborted
      controller.abort()
      if (activeRegistrations.get(modelContext as object) === controller) activeRegistrations.delete(modelContext as object)
      if (lifecycleCancellation) return
      store.logActivity({ source: 'system', action: 'webmcp_register', status: 'error', summary: error instanceof Error ? error.message : 'WebMCP registration failed.' })
      throw error
    })

  return {
    supported: true,
    toolNames: tools.map((tool) => tool.name),
    ready,
    dispose() {
      controller.abort()
      if (activeRegistrations.get(modelContext as object) === controller) activeRegistrations.delete(modelContext as object)
    },
  }
}

/** Convenience async variant for non-React callers. */
export async function registerWebMcpTools(options: InstallWebMcpOptions = {}): Promise<WebMcpRegistration> {
  const registration = installWebMcpTools(options)
  await registration.ready
  return registration
}

export function isWebMcpSupported(documentLike: WebMcpDocument | undefined = currentDocument()): boolean {
  const context: WebMcpModelContext | undefined = documentLike?.modelContext
  return Boolean(context && typeof context.registerTool === 'function')
}
