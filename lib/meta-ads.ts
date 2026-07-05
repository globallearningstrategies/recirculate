import { db, BUCKET } from "./supabase";
import { cred } from "./env";

// Meta Marketing API client for the owner's ad account. Config via env:
//   META_ADS_TOKEN      — Business Manager system-user token (never expires)
//                         with ads_management (+ the Page, ad account, and IG
//                         account assigned to that system user)
//   META_AD_ACCOUNT_ID  — like act_1234567890 (the act_ prefix is optional)
//   META_PAGE_ID        — the Facebook Page behind the Instagram account
// Every campaign this file creates is PAUSED — money only moves after the
// owner reviews and publishes in Ads Manager.
const GRAPH = "https://graph.facebook.com/v23.0";

export function adsConfigured(): boolean {
  return !!(cred("META_ADS_TOKEN") && cred("META_AD_ACCOUNT_ID") && cred("META_PAGE_ID"));
}

function account(): string {
  const raw = cred("META_AD_ACCOUNT_ID");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

async function mfetch(path: string, init?: RequestInit & { form?: Record<string, string> }): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  let body: BodyInit | undefined;
  if (init?.form) {
    const f = new URLSearchParams(init.form);
    f.set("access_token", cred("META_ADS_TOKEN"));
    body = f;
  } else {
    url.searchParams.set("access_token", cred("META_ADS_TOKEN"));
  }
  const res = await fetch(url.toString(), {
    method: init?.method ?? (init?.form ? "POST" : "GET"),
    ...(body ? { body } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json?.error?.error_user_msg || json?.error?.message || `Meta API ${res.status}`);
  }
  return json;
}

// Saved Audiences hold a reusable targeting spec; the ad set copies it verbatim.
export async function listSavedAudiences(): Promise<{ id: string; name: string }[]> {
  const res = await mfetch(`${account()}/saved_audiences?fields=id,name&limit=50`);
  return (res.data ?? []).map((a: any) => ({ id: a.id, name: a.name }));
}

async function igActorId(): Promise<string | null> {
  try {
    const res = await mfetch(`${cred("META_PAGE_ID")}?fields=instagram_business_account`);
    return res?.instagram_business_account?.id ?? null;
  } catch {
    return null;
  }
}

// Sensible fallback when no saved audience is picked. Instagram-only.
const DEFAULT_TARGETING = {
  age_min: 18,
  geo_locations: { countries: ["US"] },
  publisher_platforms: ["instagram"],
  instagram_positions: ["stream", "profile_feed", "explore", "reels"],
};

export async function createDraftCampaign(opts: {
  clip: { id: string; title: string | null; caption: string | null; hashtags: string | null; video_path: string; thumb_path: string | null };
  listenUrl: string;
  dailyBudgetCents: number;
  days: number;
  savedAudienceId?: string | null;
}): Promise<{ campaignId: string; manageUrl: string }> {
  const act = account();
  const title = opts.clip.title || "Recirculate clip";

  // 1. Upload the clip video as an ad video (Meta pulls it from the public URL).
  const videoUrl = db.storage.from(BUCKET).getPublicUrl(opts.clip.video_path).data.publicUrl;
  const vid = await mfetch(`${act}/advideos`, { form: { file_url: videoUrl, name: title } });
  // Wait for processing — creatives can't reference a video that isn't ready.
  for (let i = 0; i < 30; i++) {
    const st = await mfetch(`${vid.id}?fields=status`);
    if (st?.status?.video_status === "ready") break;
    if (st?.status?.video_status === "error") throw new Error("Meta couldn't process the video.");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 2. Campaign (paused).
  const campaign = await mfetch(`${act}/campaigns`, {
    form: {
      name: `Recirculate · ${title}`,
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: "[]",
    },
  });

  // 3. Ad set: budget, schedule, audience (paused).
  let targeting: any = DEFAULT_TARGETING;
  if (opts.savedAudienceId) {
    const saved = await mfetch(`${opts.savedAudienceId}?fields=targeting`);
    if (saved?.targeting) targeting = saved.targeting;
  }
  const end = new Date(Date.now() + opts.days * 86400000).toISOString();
  const adset = await mfetch(`${act}/adsets`, {
    form: {
      name: `${title} · ${opts.days}d`,
      campaign_id: campaign.id,
      daily_budget: String(opts.dailyBudgetCents),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      end_time: end,
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
    },
  });

  // 4. Creative: the clip video, caption, and a Listen Now button to /listen.
  if (!opts.clip.thumb_path) {
    throw new Error("This clip has no thumbnail — Meta requires one for video ads. Pick an imported clip or add a thumbnail.");
  }
  const ig = await igActorId();
  const creative = await mfetch(`${act}/adcreatives`, {
    form: {
      name: `${title} creative`,
      object_story_spec: JSON.stringify({
        page_id: cred("META_PAGE_ID"),
        ...(ig ? { instagram_actor_id: ig } : {}),
        video_data: {
          video_id: vid.id,
          image_url: db.storage.from(BUCKET).getPublicUrl(opts.clip.thumb_path).data.publicUrl,
          message: [opts.clip.caption, opts.clip.hashtags].filter(Boolean).join("\n\n"),
          call_to_action: { type: "LISTEN_NOW", value: { link: opts.listenUrl } },
        },
      }),
    },
  });

  // 5. The ad itself (paused).
  await mfetch(`${act}/ads`, {
    form: {
      name: title,
      adset_id: adset.id,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: "PAUSED",
    },
  });

  return {
    campaignId: campaign.id,
    manageUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace("act_", "")}`,
  };
}

// Last-7-days account performance for the weekly scorecard.
export async function adInsightsLast7d(): Promise<{
  spend: number;
  impressions: number;
  linkClicks: number;
} | null> {
  try {
    const res = await mfetch(
      `${account()}/insights?date_preset=last_7d&fields=spend,impressions,inline_link_clicks`
    );
    const row = res?.data?.[0];
    if (!row) return { spend: 0, impressions: 0, linkClicks: 0 };
    return {
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      linkClicks: Number(row.inline_link_clicks ?? 0),
    };
  } catch {
    return null;
  }
}
