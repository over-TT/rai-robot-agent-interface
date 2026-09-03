export const RAI_SITE_URL = 'https://arm-lab-camera-robot.overtt.chatgpt.site'
export const RAI_REPOSITORY_URL = 'https://github.com/over-TT/RAI'
export const RAI_AGENT_GUIDE_URL = `${RAI_REPOSITORY_URL}/blob/main/docs/SETUP_WITH_AGENTS.md`

export const RAI_SETUP_PROMPT = `Help me get started with RAI, Robot Agent Interface.

Website: ${RAI_SITE_URL}/#workbench
Source: ${RAI_REPOSITORY_URL}
Agent setup guide: ${RAI_AGENT_GUIDE_URL}

Explain the project briefly, then open the website in your supported browser and discover its WebMCP tools. Do not claim a connection until discovery succeeds. If this environment cannot use site tools, say so and help me open it in a compatible ChatGPT desktop browser or set up the source locally with npm ci, npm run check, and npm run dev. Read AGENTS.md and the setup guide first for local work.

Preserve existing work. Start with Arm 101 only when the scene is fresh or I ask to replace it. During an active run, use only observe_arm_camera, get_arm_telemetry, set_arm_outputs, and end_arm_trial. Choose outputs from camera-frame observations and joint telemetry, not hidden scene coordinates or task shortcuts. Keep attempts visible and explain how to replay them. Distinguish this kinematic simulation from real physics and physical hardware.`

// Matches the desktop and web handoff formats used by OpenAI's docs composer.
export function chatGptDesktopHandoff() {
  const query = new URLSearchParams({ prompt: RAI_SETUP_PROMPT, browserUrl: `${RAI_SITE_URL}/#workbench` })
  return `codex://threads/new?${query.toString()}`
}

export function chatGptWebHandoff() {
  const url = new URL('https://chatgpt.com/')
  url.searchParams.set('surface', 'work')
  url.searchParams.set('prompt', RAI_SETUP_PROMPT)
  return url.toString()
}
