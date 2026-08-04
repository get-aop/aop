const MINIMUM_COMPRESSION_BYTES = 1_024;

export const maybeCompressJsonResponse = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  if (!acceptsGzip(request) || !isCompressibleJson(response)) return response;

  const body = await response.arrayBuffer();
  if (body.byteLength < MINIMUM_COMPRESSION_BYTES) {
    return new Response(body, response);
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.set("Vary", appendVary(headers.get("Vary"), "Accept-Encoding"));
  headers.delete("Content-Length");

  const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const acceptsGzip = (request: Request): boolean =>
  request.headers
    .get("Accept-Encoding")
    ?.split(",")
    .some((value) => {
      const [encoding, ...parameters] = value
        .trim()
        .split(";")
        .map((part) => part.trim().toLowerCase());
      if (encoding !== "gzip") return false;
      const quality = parameters.find((parameter) => parameter.startsWith("q="));
      return quality === undefined || Number(quality.slice(2)) > 0;
    }) ?? false;

const isCompressibleJson = (response: Response): boolean => {
  if (!response.body || response.headers.has("Content-Encoding")) return false;
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  return contentType.includes("application/json") || contentType.includes("+json");
};

const appendVary = (current: string | null, value: string): string => {
  const values = (current ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(", ");
};
