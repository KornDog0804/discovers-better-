export default async (req) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (!path) {
    return new Response(JSON.stringify({ error: "Missing path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // only allow Discogs API paths
  if (!path.startsWith("/")) {
    return new Response(JSON.stringify({ error: "Bad path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const discogsUrl = `https://api.discogs.com${path}`;

  const res = await fetch(discogsUrl, {
    headers: {
      Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
      "User-Agent": "discovers-better/1.0 (+Netlify)",
    },
  });

  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
      "Cache-Control": "public, max-age=300", // 5 min cache
    },
  });
};
