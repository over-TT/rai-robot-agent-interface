import { executeSimulationCommand } from './commands'
import { computeSceneKinematics } from './kinematics'
import { cloneSerializable } from './math'
import { getRobotPreset } from './presets'
import type {
  ActivityEntry,
  ActivitySource,
  CommandResult,
  DispatchOptions,
  SimulationCommand,
  SimulationState,
  StorageLike,
} from './types'
import { SimulationError, validateScene, validateStoredState } from './validation'

export const DEFAULT_STORAGE_KEY = 'webmcp-robot-sim/state/v2-arm-only'
export const MAX_SIMULATION_IMPORT_BYTES = 5 * 1024 * 1024

const MAX_ACTIVITY = 120
const MAX_REQUEST_CACHE = 100

export function createDefaultSimulationState(): SimulationState {
  const preset = getRobotPreset('arm-101')!
  const state: SimulationState = {
    schema: 'webmcp-robot-sim-state',
    schemaVersion: 1,
    revision: 0,
    scene: {
      robot: preset.robot,
      cameras: preset.bundledCameras ?? [],
      objects: preset.bundledObjects ?? [],
      grasp: null,
      goal: preset.bundledGoal ?? null,
    },
    history: { undo: [], redo: [] },
    snapshots: [],
    activity: [],
    phase: 'build',
    operation: null,
  }
  validateScene(state.scene)
  return state
}

interface RequestCacheEntry {
  fingerprint: string
  result: CommandResult
}

function normalizeSceneExtensions(scene: SimulationState['scene']): SimulationState['scene'] {
  return {
    ...scene,
    objects: scene.objects.map((object) => ({
      ...object,
      movable: object.movable ?? ['arm-101-can', 'target-cube'].includes(object.id),
    })),
    grasp: scene.grasp ?? null,
    goal: scene.goal ?? null,
  }
}

/** Preserve v1 browser files while materializing fields introduced by the manipulation layer. */
function normalizeStoredExtensions(state: SimulationState): SimulationState {
  return {
    ...state,
    scene: normalizeSceneExtensions(state.scene),
    history: {
      undo: state.history.undo.map((frame) => ({ ...frame, scene: normalizeSceneExtensions(frame.scene) })),
      redo: state.history.redo.map((frame) => ({ ...frame, scene: normalizeSceneExtensions(frame.scene) })),
    },
    snapshots: state.snapshots.map((snapshot) => ({ ...snapshot, scene: normalizeSceneExtensions(snapshot.scene) })),
    phase: state.phase ?? 'build',
    operation: state.phase === 'operate' ? state.operation : null,
  }
}

function normalizeAndValidateStoredState(value: unknown): SimulationState | null {
  try {
    const normalized = normalizeStoredExtensions(value as SimulationState)
    return validateStoredState(normalized) ? normalized : null
  } catch {
    return null
  }
}

export interface SimulationStore {
  getSnapshot(): SimulationState
  subscribe(listener: () => void): () => void
  dispatch(command: SimulationCommand, options?: DispatchOptions): CommandResult
  dispatchAsync(command: SimulationCommand, options?: DispatchOptions): Promise<CommandResult>
  logActivity(entry: {
    source: ActivitySource
    action: string
    status: ActivityEntry['status']
    summary: string
    requestId?: string
  }): void
  getComputedState(): ReturnType<typeof computeSceneKinematics>
  exportState(): string
  importState(serialized: string): { persisted: boolean }
  clearPersistence(): void
}

export interface CreateStoreOptions {
  initialState?: SimulationState
  storage?: StorageLike | null
  storageKey?: string
  now?: () => string
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function createSimulationStore(options: CreateStoreOptions = {}): SimulationStore {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const now = options.now ?? (() => new Date().toISOString())
  const listeners = new Set<() => void>()
  const requestCache = new Map<string, RequestCacheEntry>()
  let state = normalizeStoredExtensions(cloneSerializable(options.initialState ?? createDefaultSimulationState()))
  if (!options.initialState && storage) {
    try {
      const serialized = storage.getItem(storageKey)
      if (serialized) {
        const candidate: unknown = JSON.parse(serialized)
        const normalized = normalizeAndValidateStoredState(candidate)
        if (normalized) state = cloneSerializable(normalized)
      }
    } catch {
      // A bad browser storage value must never make the simulator unusable.
    }
  }
  let activityCounter = state.activity.length

  function persist(): boolean {
    if (!storage) return false
    try {
      storage.setItem(storageKey, JSON.stringify(state))
      return true
    } catch {
      return false
    }
  }

  function emit(): boolean {
    const persisted = persist()
    listeners.forEach((listener) => listener())
    return persisted
  }

  function appendActivity(entry: {
    source: ActivitySource
    action: string
    status: ActivityEntry['status']
    summary: string
    requestId?: string
  }): boolean {
    activityCounter += 1
    state = {
      ...state,
      activity: [
        ...state.activity,
        {
          id: `activity-${state.revision}-${activityCounter}`,
          at: now(),
          revision: state.revision,
          ...entry,
        },
      ].slice(-MAX_ACTIVITY),
    }
    return emit()
  }

  function dispatch(command: SimulationCommand, dispatchOptions: DispatchOptions = {}): CommandResult {
    const source = dispatchOptions.source ?? 'ui'
    const fingerprint = JSON.stringify(command)
    if (command.requestId) {
      const cached = requestCache.get(command.requestId)
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          const error = new SimulationError('REQUEST_ID_REUSED', `requestId ${command.requestId} was already used for a different command.`)
          appendActivity({ source, action: command.type, status: 'error', summary: error.message, requestId: command.requestId })
          throw error
        }
        return { ...cached.result, deduplicated: true }
      }
    }

    try {
      const execution = executeSimulationCommand(state, command, now())
      state = execution.state
      if (command.requestId) {
        requestCache.set(command.requestId, { fingerprint, result: cloneSerializable(execution.result) })
        while (requestCache.size > MAX_REQUEST_CACHE) requestCache.delete(requestCache.keys().next().value!)
      }
      appendActivity({
        source,
        action: command.type,
        status: 'ok',
        summary: execution.result.summary,
        ...(command.requestId ? { requestId: command.requestId } : {}),
      })
      return execution.result
    } catch (error) {
      appendActivity({
        source,
        action: typeof command?.type === 'string' ? command.type : 'unknown_command',
        status: 'error',
        summary: error instanceof Error ? error.message : 'Unknown simulation command error.',
        ...(command?.requestId ? { requestId: command.requestId } : {}),
      })
      throw error
    }
  }

  async function dispatchAsync(command: SimulationCommand, dispatchOptions: DispatchOptions = {}): Promise<CommandResult> {
    return dispatch(command, dispatchOptions)
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
    dispatchAsync,
    logActivity: appendActivity,
    getComputedState: () => computeSceneKinematics(state.scene),
    exportState: () => JSON.stringify(state, null, 2),
    importState(serialized) {
      if (new TextEncoder().encode(serialized).byteLength > MAX_SIMULATION_IMPORT_BYTES) {
        throw new SimulationError('LIMIT_EXCEEDED', 'Imported simulation JSON exceeds the 5 MiB import limit.')
      }
      let candidate: unknown
      try { candidate = JSON.parse(serialized) } catch {
        throw new SimulationError('INVALID_INPUT', 'Imported simulation state is not valid JSON.')
      }
      const normalized = normalizeAndValidateStoredState(candidate)
      if (!normalized) {
        throw new SimulationError('INVALID_INPUT', 'Imported simulation state does not match schema version 1.')
      }
      state = cloneSerializable(normalized)
      requestCache.clear()
      const persisted = appendActivity({ source: 'ui', action: 'import_state', status: 'ok', summary: 'Imported simulation state.' })
      return { persisted }
    },
    clearPersistence() {
      try { storage?.removeItem(storageKey) } catch { /* best effort */ }
    },
  }
}

export const simulationStore = createSimulationStore()
