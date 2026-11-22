import { getLLMText, source } from "@/lib/source";

// Prerendered at build time. Not `revalidate = false`: vinext reads that as ISR.
export const dynamic = "force-static";

export async function GET() {
  const content = await Promise.all(source.getPages().map(getLLMText));

  return new Response(content.join("\n\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
