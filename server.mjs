import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const PUBLIC_FILES = new Map([
  ["/app.js", { filePath: path.join(__dirname, "app.js"), contentType: "text/javascript; charset=utf-8" }],
  ["/config-page.js", { filePath: path.join(__dirname, "config-page.js"), contentType: "text/javascript; charset=utf-8" }],
  ["/favicon.svg", { filePath: path.join(__dirname, "favicon.svg"), contentType: "image/svg+xml" }],
  ["/site-api.js", { filePath: path.join(__dirname, "site-api.js"), contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { filePath: path.join(__dirname, "styles.css"), contentType: "text/css; charset=utf-8" }],
]);

const PAGE_FILES = {
  "/": path.join(__dirname, "index.html"),
  "/config": path.join(__dirname, "config.html"),
};

const API_ROUTES = new Map([
  ["/api/admin/automation", { modulePath: "./api/admin/automation.mjs" }],
  ["/api/admin/config", { modulePath: "./api/admin/config.mjs" }],
  ["/api/admin/session", { modulePath: "./api/admin/session.mjs" }],
  ["/api/automation/poll", { modulePath: "./api/automation/poll.mjs" }],
  ["/api/status", { modulePath: "./api/status.mjs" }],
]);

const pageHeaders = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "cdn-cache-control": "no-store",
  expires: "0",
  pragma: "no-cache",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const send = (response, statusCode, headers, body, method = "GET") => {
  response.writeHead(statusCode, headers);

  if (method === "HEAD") {
    response.end();
    return;
  }

  response.end(body);
};

const normalizePathname = (pathname) => {
  if (!pathname) {
    return "/";
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
};

const getRequestOrigin = (request) => {
  const protoHeader = request.headers["x-forwarded-proto"];
  const protocol = typeof protoHeader === "string" && protoHeader ? protoHeader.split(",")[0].trim() : "http";
  const host = request.headers.host || `127.0.0.1:${PORT}`;
  return `${protocol}://${host}`;
};

const toFetchRequest = (request, url) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const init = {
    headers,
    method: request.method || "GET",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(url, init);
};

const sendFetchResponse = async (nodeResponse, fetchResponse, requestMethod) => {
  const headers = {};

  fetchResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const setCookie = fetchResponse.headers.get("set-cookie");
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }

  const body = requestMethod === "HEAD" ? null : Buffer.from(await fetchResponse.arrayBuffer());
  send(nodeResponse, fetchResponse.status, headers, body, requestMethod);
};

const serveStaticFile = async (request, response, pathname) => {
  const asset = PUBLIC_FILES.get(pathname);
  if (!asset) {
    return false;
  }

  const body = await fs.readFile(asset.filePath);
  send(
    response,
    200,
    {
      ...pageHeaders,
      "content-type": asset.contentType,
    },
    body,
    request.method,
  );
  return true;
};

const servePage = async (request, response, pathname) => {
  const pageFile = PAGE_FILES[pathname];
  if (!pageFile) {
    return false;
  }

  const body = await fs.readFile(pageFile);
  const headers = {
    ...pageHeaders,
    "content-type": "text/html; charset=utf-8",
  };

  if (pathname === "/config") {
    headers["x-robots-tag"] = "noindex, nofollow";
  }

  send(response, 200, headers, body, request.method);
  return true;
};

const routeApiRequest = async (request, response, pathname, url) => {
  const route = API_ROUTES.get(pathname);
  if (!route) {
    return false;
  }

  const moduleUrl = pathToFileURL(path.join(__dirname, route.modulePath)).href;
  const apiModule = await import(moduleUrl);
  const handler = apiModule[request.method || "GET"];

  if (typeof handler !== "function") {
    send(
      response,
      405,
      {
        allow: Object.keys(apiModule).filter((key) => typeof apiModule[key] === "function").join(", "),
        "content-type": "application/json; charset=utf-8",
      },
      JSON.stringify({ error: "Method not allowed" }),
      request.method,
    );
    return true;
  }

  const fetchRequest = toFetchRequest(request, url);
  const fetchResponse = await handler(fetchRequest);
  await sendFetchResponse(response, fetchResponse, request.method || "GET");
  return true;
};

const server = http.createServer(async (request, response) => {
  try {
    const origin = getRequestOrigin(request);
    const url = new URL(request.url || "/", origin);
    const pathname = normalizePathname(url.pathname);

    if (pathname === "/config.html") {
      response.writeHead(301, { location: "/config" });
      response.end();
      return;
    }

    if (await routeApiRequest(request, response, pathname, url.toString())) {
      return;
    }

    if (await servePage(request, response, pathname)) {
      return;
    }

    if (await serveStaticFile(request, response, pathname)) {
      return;
    }

    send(
      response,
      404,
      {
        "content-type": "text/plain; charset=utf-8",
      },
      "Not found",
      request.method,
    );
  } catch (error) {
    console.error("Unhandled request failure", error);
    send(
      response,
      500,
      {
        "content-type": "application/json; charset=utf-8",
      },
      JSON.stringify({ error: "Internal server error" }),
      request.method,
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`codex-limit listening on http://${HOST}:${PORT}`);
});
