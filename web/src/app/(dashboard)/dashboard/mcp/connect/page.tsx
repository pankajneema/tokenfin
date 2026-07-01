import { McpConnectClient } from './_client'

export const metadata = { title: 'MCP Setup — TokenFin' }

export default function McpConnectPage() {
  const endpoint = (process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com') + '/api/mcp'
  return <McpConnectClient endpoint={endpoint} />
}
