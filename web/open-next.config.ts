import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Default config: no incremental cache binding (every page is dynamic / server-rendered).
export default defineCloudflareConfig({})
