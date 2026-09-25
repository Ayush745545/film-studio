import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output produces a self-contained server bundle for the Docker
  // image. It is opt-in because dependency tracing is memory-hungry and can
  // OOM a small build host — `npm run build` stays light, and the Dockerfile
  // sets AFS_STANDALONE=1 to get the slim runtime image.
  ...(process.env.AFS_STANDALONE === '1' ? { output: 'standalone' } : {}),
  // Pin the workspace root. Without this, Next infers it from the nearest
  // lockfile — and a stray package-lock.json in a parent directory makes it
  // pick the wrong root, which breaks file tracing and standalone output.
  outputFileTracingRoot: projectRoot,
  poweredByHeader: false,
  outputFileTracingIncludes: { '/api/**/*': ['./.afs-data/**/*'] },
  serverExternalPackages: ['@prisma/client', 'prisma', 'bcryptjs'],
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '64mb' },
    proxyTimeout: 600_000,
    // Keep the build inside a small memory budget (single compiler pass,
    // reduced worker pool, webpack memory optimisations).
    cpus: 1,
    workerThreads: false,
    webpackMemoryOptimizations: true
  },
  // Type-checking runs separately via `npm run typecheck`; ESLint during build
  // is disabled to keep CI memory bounded. Both are wired in package.json.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/api/files/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, max-age=3600, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' }
        ]
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' }
        ]
      }
    ];
  }
};
export default nextConfig;
