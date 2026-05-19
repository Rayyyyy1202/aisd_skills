/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    AGENT_SERVER_URL: process.env.AGENT_SERVER_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
