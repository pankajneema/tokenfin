import { redirect } from 'next/navigation'

// The copy-paste MCP flow was replaced by the Setup Hub (auto-provisioned key,
// one-click installs, live verify). Keep the old URL working.
export default function McpConnectRedirect() {
  redirect('/dashboard/setup')
}
