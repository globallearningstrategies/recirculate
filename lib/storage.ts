import { db, BUCKET } from "./supabase";
import { Readable } from "node:stream";

// Public URL — used by Instagram and TikTok, whose servers fetch the video themselves.
// The bucket must be public for these to be reachable.
export function publicUrl(path: string): string {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// A Node readable stream of the file — used by YouTube, where we push the bytes ourselves.
export async function fileStream(path: string): Promise<Readable> {
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, 600);
  if (signed.error || !signed.data) throw new Error("Could not sign video URL: " + signed.error?.message);
  const res = await fetch(signed.data.signedUrl);
  if (!res.ok || !res.body) throw new Error("Could not fetch video bytes: " + res.status);
  return Readable.fromWeb(res.body as any);
}
