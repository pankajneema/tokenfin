/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'standalone' is for Docker only — not used on Vercel
  images: { domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"] },
}
module.exports = nextConfig
