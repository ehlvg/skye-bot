/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: new URL("..", import.meta.url).pathname,
  },
  serverExternalPackages: ["better-sqlite3"],
}

export default nextConfig
