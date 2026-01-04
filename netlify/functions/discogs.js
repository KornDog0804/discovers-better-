// netlify/functions/discogs.js
// Server-side proxy for Discogs API so your token stays private.

export async function handler(event) {
  try {
    const token = process.env.DISCOGS_TOKEN; // <-- your Netlify env var stays THIS name
    if (!token) {
      return json(500, { error: "Missing DISCOGS_TOKEN on server (Netlify env var)." });
    }

    // Allow only Discogs API routes (safety)
    const qs = event.queryStringParameters || {};
    const username = (qs.username || "").trim();
    const page = Number(qs.page || 1);
    const per_page = Number(qs.per_page || 100);

    // Only supporting the one endpoint your app uses:
    // /users/:username/collection/folders/0/releases
    if (!username) {
      return json(400, { error: "Missing username." });
    }

    // Build Discogs URL
    const url =
      `https://api.discogs.com/users/${encodeURIComponent(username)}` +
      `/collection/folders/0/releases?per_page=${encodeURIComponent(per_page)}` +
      `&page=${encodeURIComponent(page)}` +
      `&sort=added&sort_order=desc`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Discogs token=${token}`,
        "User-Agent": "discovers-better/1.0 (+netlify)",
        Accept: "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      // pass through useful error details
      return json(res.status, {
        error: `Discogs error ${res.status}`,
        details: text.slice(0, 500),
      });
    }

    // Return JSON + CORS
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
      body: text,
    };
  } catch (e) {
    return json(500, { error: "Server function crashed.", details: String(e?.message || e) });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}
