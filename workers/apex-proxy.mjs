const PAGES_ORIGIN = "has-codex-rate-limits-reset-today.pages.dev";

const shouldIncludeBody = (method) => method !== "GET" && method !== "HEAD";

const rewriteLocation = (location, requestUrl) => {
  if (!location) {
    return location;
  }

  const target = new URL(location, `https://${PAGES_ORIGIN}`);
  if (target.hostname !== PAGES_ORIGIN) {
    return location;
  }

  target.protocol = requestUrl.protocol;
  target.host = requestUrl.host;
  return target.toString();
};

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = "https:";
    upstreamUrl.hostname = PAGES_ORIGIN;

    const headers = new Headers(request.headers);
    headers.set("host", PAGES_ORIGIN);
    headers.set("x-forwarded-host", requestUrl.host);
    headers.set("x-forwarded-proto", requestUrl.protocol.replace(/:$/, ""));

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: shouldIncludeBody(request.method) ? request.body : undefined,
      redirect: "manual",
    });

    const response = new Response(upstreamResponse.body, upstreamResponse);
    const location = response.headers.get("location");
    if (location) {
      response.headers.set("location", rewriteLocation(location, requestUrl));
    }

    response.headers.set("x-codex-proxy", "cloudflare-apex");
    return response;
  },
};
