/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone server output is for the Docker image only (Vercel doesn't need it).
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  images: { domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"] },
}
module.exports = nextConfig
