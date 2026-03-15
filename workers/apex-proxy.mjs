const VPS_ORIGIN = "http://44.240.202.85";

const shouldIncludeBody = (method) => method !== "GET" && method !== "HEAD";

const buildOriginUrl = (requestUrl) => new URL(`${requestUrl.pathname}${requestUrl.search}`, VPS_ORIGIN);

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const isApiRequest = requestUrl.pathname.startsWith("/api/");

    if (!isApiRequest) {
      return Response.redirect(buildOriginUrl(requestUrl), 307);
    }

    const upstreamUrl = buildOriginUrl(requestUrl);

    const headers = new Headers(request.headers);
    headers.set("host", upstreamUrl.host);
    headers.set("x-forwarded-host", requestUrl.host);
    headers.set("x-forwarded-proto", requestUrl.protocol.replace(/:$/, ""));

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: shouldIncludeBody(request.method) ? request.body : undefined,
      redirect: "manual",
    });

    const response = new Response(upstreamResponse.body, upstreamResponse);
    response.headers.set("x-codex-proxy", "cloudflare-apex-vps");
    return response;
  },
};
