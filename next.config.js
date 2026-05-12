/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle server-only packages on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        child_process: false,
        dns: false,
      }
    }
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ['googleapis', 'google-auth-library', 'pg'],
  },
}

module.exports = nextConfig
