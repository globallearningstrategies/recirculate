// Server only. Never send authorization headers or raw provider errors to clients.
export async function runway(endpoint: string, body?: unknown) {
  const key = process.env.RUNWAYML_API_SECRET?.trim();
  if (!key) throw new Error("Runway is not connected. Save RUNWAYML_API_SECRET in Production and redeploy.");
  const response = await fetch(`https://api.dev.runwayml.com/v1/${endpoint}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": "2024-11-06", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Runway rejected the API key. Check the Production key in Vercel." : response.status === 429 ? "Runway is at its limit or needs more API credits. Check the developer dashboard." : `Runway could not complete the request (HTTP ${response.status}).`);
  return response.json();
}

export async function downloadRunwayVideo(raw: string) {
  // Only provider-returned URLs reach here. Reject local addresses and redirects.
  const url = new URL(raw);
  if (url.protocol !== "https:" || !(/(^|\.)(runwayml\.com|cloudfront\.net|amazonaws\.com|runwaycdn\.com)$/.test(url.hostname))) throw new Error("Runway returned an unsupported video host.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error("Could not download the generated scene. Resume to try downloading again.");
  const parts: Uint8Array[] = []; let size = 0;
  for await (const part of response.body as any) {
    size += part.length;
    if (size > 50 * 1024 * 1024) throw new Error("The generated scene exceeds the 50 MB limit.");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
