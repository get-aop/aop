export type BunRequestInit = RequestInit & { duplex?: "half" };

export const createProxyRequestInit = (request: Request, headers: Headers): BunRequestInit => {
  const proxyHeaders = new Headers(headers);
  // Bun fetch transparently decompresses upstream bodies. Asking for identity keeps
  // the browser from receiving a decoded body with a stale Content-Encoding header.
  proxyHeaders.set("Accept-Encoding", "identity");
  const init: BunRequestInit = {
    method: request.method,
    headers: proxyHeaders,
  };
  if (request.method === "GET" || request.method === "HEAD") return init;
  init.body = request.body;
  init.duplex = "half";
  return init;
};
