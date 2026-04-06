/**
 * MiniMax Auth Plugin for Open-Inspect.
 *
 * Intercepts requests to the MiniMax API and injects the user's API key from
 * sandbox env vars. Auto-loaded from .opencode/plugins/ and replaces any built-in
 * provider plugin with the same provider ID.
 */
import type { Plugin } from "@opencode-ai/plugin";

const MINIMAX_API_HOST = "api.minimax.chat";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY?.trim();

function withAuthorizationHeader(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("authorization", `Bearer ${MINIMAX_API_KEY}`);
  return nextHeaders;
}

export const MiniMaxAuthPlugin: Plugin = async () => ({
  auth: {
    provider: "minimax",
    methods: [],
    async loader() {
      if (!MINIMAX_API_KEY) {
        throw new Error(
          "MiniMax credentials are not configured. Add MINIMAX_API_KEY in repository Settings."
        );
      }

      return {
        apiKey: MINIMAX_API_KEY,
        async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
          const requestUrl =
            requestInput instanceof URL
              ? requestInput
              : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);

          if (requestUrl.hostname !== MINIMAX_API_HOST) {
            return fetch(requestInput, init);
          }

          return fetch(requestInput, {
            ...init,
            headers: withAuthorizationHeader(init?.headers),
          });
        },
      };
    },
  },
});
