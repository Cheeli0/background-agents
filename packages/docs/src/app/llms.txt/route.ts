import { renderLlmsIndex } from "@/lib/llms";

// Prerendered at build time. Not `revalidate = false`: vinext reads that as ISR.
export const dynamic = "force-static";

export function GET() {
  return new Response(renderLlmsIndex(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
