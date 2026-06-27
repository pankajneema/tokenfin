import { GatewayClient } from './_client'

export const metadata = { title: 'Gateway — TokenFin' }

export default function GatewayPage() {
  const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://gateway.tokenfin.dev'
  return <GatewayClient gatewayUrl={gatewayUrl} />
}
