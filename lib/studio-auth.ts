import { createSupabaseServer } from "./supabase-server";

export async function studioOwner() {
  const client = await createSupabaseServer();
  const { data: { user } } = await client.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!user || (owner && user.email?.toLowerCase() !== owner)) throw new Error("Not authorized.");
  return { user, client };
}

export function ownedAsset(path: unknown, userId: string): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/`) && !path.includes("..") && path.length < 300;
}
