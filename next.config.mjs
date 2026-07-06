/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // ffmpeg-static resolves its binary via __dirname — keep it out of the
    // webpack bundle, and make sure the binary + font ship with the function.
    serverComponentsExternalPackages: ["ffmpeg-static"],
    outputFileTracingIncludes: {
      "/api/lyric-video": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/lyric-video/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/transcribe": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/transcribe/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
    },
  },
};
export default nextConfig;
