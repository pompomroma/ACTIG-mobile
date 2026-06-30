/* ACTIG CORS proxy — makes the NVIDIA NIM chat API reachable from the browser.
 *
 * Why this exists: https://integrate.api.nvidia.com is a server-to-server API
 * and does NOT return CORS headers, so a web app (PWA) calling it directly is
 * blocked by the browser. This tiny proxy adds the CORS headers and forwards the
 * request (including the streamed response) to NVIDIA unchanged.
 *
 * Deploy (free, no PC needed beyond a browser):
 *   1. Sign in at https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Replace the worker code with this file's contents and Deploy.
 *   3. Copy the worker URL (e.g. https://actig-proxy.<you>.workers.dev) and append
 *      /v1/chat/completions, then paste it into ACTIG ▸ Settings ▸ API endpoint:
 *        https://actig-proxy.<you>.workers.dev/v1/chat/completions
 *
 * Security: the proxy forwards whatever Authorization header the app sends; it
 * never stores the key. Anyone with the URL can use it, so keep it private or
 * lock it down (e.g. check a shared secret / your origin) if needed.
 */

const UPSTREAM = "https://integrate.api.nvidia.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = UPSTREAM + url.pathname + url.search;

    // Forward method, headers (Authorization/Content-Type), and body to NVIDIA.
    const upstream = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });

    // Stream the upstream response straight back, with CORS headers added.
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
