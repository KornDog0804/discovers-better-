// netlify/functions/img-proxy.js
// Proxies Discogs cover images so canvas exports don't go blank due to CORS.
// Usage: /.netlify/functions/img-proxy?url=https%3A%2F%2Fi.discogs.com%2F...

const ALLOW_HOSTS = new Set([
  "i.discogs.com",
  "img.discogs.com",
  "api.discogs.com",
  // sometimes discogs images redirect through other hosts; add if needed
]);

function isAllowed(urlObj) {
  const host = (urlObj.hostname || "").toLowerCase();
  if (ALLOW_HOSTS.has(host)) return true;

  // Allow Discogs subdomains (safer than "anything")
  if (host.endsWith(".discogs.com")) return true;

  return false;
}

export async function handler(event) {
  try {
    const raw = event.queryStringParameters?.url || "";
    if (!raw) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Missing url parameter" }),
      };
    }

    let target;
    try {
      target = new URL(raw);
    } catch {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Invalid url" }),
      };
    }

    if (!isAllowed(target)) {
      return {
        statusCode: 403,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Host not allowed" }),
      };
    }

    // Fetch server-side (bypasses browser CORS restrictions)
    const res = await fetch(target.toString(), {
      // Avoid sending your site referrer to discogs
      headers: {
        "User-Agent": "VinylWall-Proxy/1.0",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: `Upstream error ${res.status}` }),
      };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const cacheControl =
      res.headers.get("cache-control") || "public, max-age=86400";

    // Convert to base64 for Netlify Functions response
    const arrayBuffer = await res.arrayBuffer();
    const body = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
      body,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Proxy failed", details: String(err) }),
    };
  }
}
