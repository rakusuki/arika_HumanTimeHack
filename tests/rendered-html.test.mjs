import assert from "node:assert/strict";
import test from "node:test";
import {register} from "node:module";
register("./cloudflare-loader.mjs",import.meta.url);


test("renders the production app with security headers and no-index metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html=await response.text();
  assert.match(html,/<title>ありか/);
  assert.match(html,/<meta(?=[^>]*name="robots")(?=[^>]*content="noindex, nofollow")[^>]*>/);
  assert.match(html,/signin-with-chatgpt/);
  assert.doesNotMatch(html,/API_ENCRYPTION_KEY|ADMIN_TOKEN/);
});
