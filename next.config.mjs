/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Bust any stale webpack filesystem cache restored between Vercel builds.
    // The first deploy bundled an Edge-incompatible Supabase build (__dirname),
    // and the restored cache kept serving those modules even after the version
    // pin. Bumping the cache version forces a clean rebuild of the edge bundle.
    if (config.cache && typeof config.cache === "object") {
      config.cache.version = `recirculate-edge-2`;
    }
    return config;
  },
};
export default nextConfig;
