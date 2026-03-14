export const onRequestGet = async (context) => {
  const response = await context.env.ASSETS.fetch(new URL("/config/index.html", context.request.url));
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
