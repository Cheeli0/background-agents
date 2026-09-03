import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

test("MiniMax plugin injects credentials only for the MiniMax API", async (context) => {
  process.env.MINIMAX_API_KEY = "minimax-secret";
  context.after(() => delete process.env.MINIMAX_API_KEY);

  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return new Response(null, { status: 204 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const pluginUrl = new URL(
    "../src/sandbox_runtime/plugins/minimax-auth-plugin.js",
    import.meta.url
  );
  pluginUrl.searchParams.set("test", String(Date.now()));
  const { MiniMaxAuthPlugin } = await import(pluginUrl.href);
  const plugin = await MiniMaxAuthPlugin();
  const auth = await plugin.auth.loader();

  await auth.fetch("https://api.minimax.chat/v1/chat/completions", {
    headers: { "content-type": "application/json" },
  });
  await auth.fetch("https://example.com/health");

  assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer minimax-secret");
  assert.equal(requests[1].init, undefined);
});
