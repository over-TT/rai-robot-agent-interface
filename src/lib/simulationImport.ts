import { MAX_SIMULATION_IMPORT_BYTES } from '../domain'

export interface SimulationImportFile {
  readonly size: number
  text(): Promise<string>
}

export async function readSimulationImportFile(file: SimulationImportFile): Promise<string> {
  if (file.size > MAX_SIMULATION_IMPORT_BYTES) {
    throw new Error('Imported simulation JSON exceeds the 5 MiB import limit.')
  }
  return file.text()
}
