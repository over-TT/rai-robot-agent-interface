import type { WebMcpModelContext } from './types'

declare global {
  interface Document {
    /** Experimental browser-native WebMCP imperative API. */
    readonly modelContext?: WebMcpModelContext
  }
}

export {}

