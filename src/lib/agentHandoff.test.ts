import { describe, expect, it } from 'vitest'
import { chatGptDesktopHandoff, chatGptWebHandoff, RAI_SETUP_PROMPT, RAI_SITE_URL } from './agentHandoff'

describe('agent setup handoff', () => {
  it('prepares the desktop app with the public workbench and complete prompt', () => {
    const url = new URL(chatGptDesktopHandoff())
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('codex://threads/new')
    expect(url.searchParams.get('browserUrl')).toBe(`${RAI_SITE_URL}/#workbench`)
    expect(url.searchParams.get('prompt')).toBe(RAI_SETUP_PROMPT)
  })

  it('provides an HTTPS web fallback without private/local state', () => {
    const url = new URL(chatGptWebHandoff())
    expect(url.origin).toBe('https://chatgpt.com')
    expect(url.searchParams.get('surface')).toBe('work')
    expect(url.searchParams.get('prompt')).toBe(RAI_SETUP_PROMPT)
    expect(RAI_SETUP_PROMPT).not.toMatch(/127\.0\.0\.1|localhost|C:\\\\|token=/i)
  })
})
