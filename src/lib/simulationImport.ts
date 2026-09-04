import { MAX_SIMULATION_IMPORT_BYTES, SIMULATION_IMPORT_LIMIT_MESSAGE } from '../domain'

export interface SimulationImportFile {
  readonly size: number
  text(): Promise<string>
}

export async function readSimulationImportFile(file: SimulationImportFile): Promise<string> {
  if (file.size > MAX_SIMULATION_IMPORT_BYTES) {
    throw new Error(SIMULATION_IMPORT_LIMIT_MESSAGE)
  }
  return file.text()
}
