import { NextResponse } from "next/server";
import { studioOwner } from "@/lib/studio-auth";
import { QUIET_DEFAULTS } from "@/lib/studio";

export async function GET() {
  try {
    const { user, client } = await studioOwner();
    const { data, error } = await client.from("notification_preferences").select("daily_reminders,weekly_summary,failure_alerts").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json(data ?? QUIET_DEFAULTS);
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message === "Not authorized." ? 401 : 500 }); }
}

export async function PUT(req: Request) {
  try {
    const { user, client } = await studioOwner();
    const body = await req.json();
    if (Object.keys(QUIET_DEFAULTS).some((key) => typeof body[key] !== "boolean")) return NextResponse.json({ error: "Choose your notification preferences." }, { status: 400 });
    const { error } = await client.from("notification_preferences").upsert({ user_id: user.id, daily_reminders: body.daily_reminders, weekly_summary: body.weekly_summary, failure_alerts: body.failure_alerts });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message === "Not authorized." ? 401 : 500 }); }
}
