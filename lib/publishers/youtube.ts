import { google } from "googleapis";
import { fileStream } from "../storage";

// Uploads a Short to YouTube. A vertical video under 3 minutes qualifies as a Short automatically.
// Quota: an upload costs ~1600 units against the default 10,000/day, so ~6 uploads/day before
// you need a quota increase. We push the bytes ourselves from Supabase storage.
export async function publishYouTube(
  token: string,
  clip: { title: string; caption: string; video_path: string },
  body: string
): Promise<string> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  const yt = google.youtube({ version: "v3", auth });

  const media = await fileStream(clip.video_path);
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: clip.title.slice(0, 100), description: body, categoryId: "10" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    },
    media: { body: media },
  });
  if (!res.data.id) throw new Error("YouTube upload returned no video id");
  return res.data.id;
}
