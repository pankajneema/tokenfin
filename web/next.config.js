/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Dockerfile.web — produces .next/standalone as a minimal self-contained runtime
  output: 'standalone',
  images: { domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"] },
}
module.exports = nextConfig
