/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // ffmpeg-static resolves its binary via __dirname — keep it out of the
    // webpack bundle, and make sure the binary + font ship with the function.
    serverComponentsExternalPackages: ["ffmpeg-static"],
    outputFileTracingIncludes: {
      "/api/studio/render": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**", "./public/dreamcore/**"],
      "/api/studio/render/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**", "./public/dreamcore/**"],
      "/api/lyric-video": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/lyric-video/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/transcribe": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/transcribe/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/thumb": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
      "/api/thumb/route": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
    },
  },
};
export default nextConfig;
