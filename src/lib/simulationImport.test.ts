import { expect, it, vi } from 'vitest'
import { MAX_SIMULATION_IMPORT_BYTES } from '../domain'
import { readSimulationImportFile } from './simulationImport'

it('rejects oversized files before reading their contents', async () => {
  const text = vi.fn(async () => '{"unexpected":"read"}')

  await expect(readSimulationImportFile({
    size: MAX_SIMULATION_IMPORT_BYTES + 1,
    text,
  })).rejects.toThrow(/exceeds the 64 MiB import limit/)
  expect(text).not.toHaveBeenCalled()
})
