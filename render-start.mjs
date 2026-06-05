import http from "http";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 10000;

const candidates = [
  "dist/server/server.js",
  "dist/server/index.mjs",
  "dist/server/index.js",
];
const serverPath = candidates
  .map((p) => join(__dirname, p))
  .find((p) => existsSync(p));
if (!serverPath) {
  console.error("Build output not found. Looked for:", candidates.join(", "));
  console.error("Run 'npm run build' first.");
  process.exit(1);
}
console.log("Loading server entry:", serverPath);

const { default: worker } = await import(serverPath);

const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function serveAsset(pathname) {
  const safePath = pathname.replace(/^\/+/, "").replace(/\.{2,}/g, "");
  const filePath = join(__dirname, "dist/client", safePath || "index.html");

  if (!existsSync(filePath)) {
    const htmlPath = filePath + ".html";
    if (existsSync(htmlPath)) {
      const content = await readFile(htmlPath);
      return new Response(content, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return null;
  }

  const content = await readFile(filePath);
  const ext = extname(filePath);
  return new Response(content, {
    status: 200,
    headers: { "content-type": mimeTypes[ext] || "application/octet-stream" },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );

    const headers = new Headers();
    for (const [key, values] of Object.entries(req.headers)) {
      if (!values) continue;
      if (Array.isArray(values)) {
        for (const v of values) headers.append(key, v);
      } else {
        headers.append(key, values);
      }
    }

    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
    });

    const env = {
      ASSETS: {
        fetch: async (req) => {
          const assetUrl = typeof req === "string" ? req : req.url;
          const response = await serveAsset(new URL(assetUrl).pathname);
          return response || new Response("Not Found", { status: 404 });
        },
      },
    };

    const context = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };

    const response = await worker.fetch(request, env, context);

    const responseHeaders = {};
    for (const [key, value] of response.headers) {
      responseHeaders[key] = value;
    }

    res.writeHead(response.status, responseHeaders);
    const responseBody = await response.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch (error) {
    console.error("Server error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" });
    }
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
