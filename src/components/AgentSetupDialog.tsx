import { useEffect, useId, useRef, useState } from 'react'
import { chatGptDesktopHandoff, chatGptWebHandoff, RAI_AGENT_GUIDE_URL, RAI_SETUP_PROMPT } from '../lib/agentHandoff'

export function AgentSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')

  useEffect(() => {
    if (open && !dialog.current?.open) {
      setCopyState('idle')
      dialog.current?.showModal()
    }
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(RAI_SETUP_PROMPT)
      setCopyState('copied')
    } catch {
      setCopyState('manual')
    }
  }

  return <dialog ref={dialog} className="agent-task-dialog agent-setup-dialog" aria-labelledby={titleId} onClose={onClose}>
    <form method="dialog">
      <div className="agent-task-dialog-heading"><span><small>Agent setup</small><h2 id={titleId}>Bring your agent to RAI</h2></span></div>
      <p>Open the public RAI workbench beside a new ChatGPT desktop chat, with a setup brief ready to send. Local scenes and recordings stay in this browser.</p>
      <div className="agent-handoff-links">
        <a href={chatGptDesktopHandoff()}>Open ChatGPT desktop ↗</a>
        <a href={chatGptWebHandoff()} target="_blank" rel="noreferrer">Use ChatGPT on web ↗</a>
      </div>
      <p className="agent-handoff-note">Desktop app required for the first link. The web link prepares a prompt; site-tool support depends on your app and account.</p>
      <details open={copyState === 'manual' || undefined}><summary>Read the setup brief</summary><textarea readOnly aria-label="Agent setup brief" value={RAI_SETUP_PROMPT} onFocus={(event) => event.currentTarget.select()} /></details>
      <div className="agent-task-dialog-actions">
        <a href={RAI_AGENT_GUIDE_URL} target="_blank" rel="noreferrer">Full setup guide ↗</a>
        <button type="button" onClick={() => void copyBrief()}>Copy setup brief</button>
        <button type="submit">Close</button>
      </div>
      <p className="agent-copy-status" role="status">{copyState === 'copied' ? 'Setup brief copied.' : copyState === 'manual' ? 'Clipboard unavailable. Select and copy the brief above.' : ''}</p>
    </form>
  </dialog>
}
