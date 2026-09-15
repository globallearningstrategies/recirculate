import { redirect } from "next/navigation";
import { studioOwner } from "@/lib/studio-auth";
import Studio from "./studio";
import "./studio.css";

export const dynamic = "force-dynamic";
export default async function StudioPage() {
  try { await studioOwner(); } catch { redirect("/login"); }
  return <Studio reloadHref={`/studio?reload=${Date.now()}`} />;
}
