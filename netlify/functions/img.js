export async function handler(event) {
  try {
    const url = event.queryStringParameters?.url;
    if (!url) return { statusCode: 400, body: "Missing url" };

    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:")
      return { statusCode: 400, body: "Invalid url" };

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      return { statusCode: res.status, body: `Upstream error: ${res.status}` };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
      body: buf.toString("base64"),
    };
  } catch {
    return { statusCode: 500, body: "Proxy failed" };
  }
}
