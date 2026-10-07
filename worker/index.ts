/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The product serves protected JPEGs through /api/image. Disable the unused
    // anonymous image proxy instead of exposing arbitrary image parsers.
    if (url.pathname === '/_vinext/image')return new Response('Not found',{status:404});

    const response = await handler.fetch(request, env, ctx);
    const secured = new Response(response.body,response);
    secured.headers.set('X-Content-Type-Options','nosniff');
    secured.headers.set('Referrer-Policy','no-referrer');
    secured.headers.set('Permissions-Policy','geolocation=(), microphone=()');
    secured.headers.set('Strict-Transport-Security','max-age=31536000');
    // Keep Sites preview embedding and existing scripts working. Block object embeds.
    secured.headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'");
    return secured;
  },
};

export default worker;
