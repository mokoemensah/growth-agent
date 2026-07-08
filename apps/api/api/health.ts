/** Lightweight health probe — no DB, no Hono bundle. */
export default function handler(): Response {
  return Response.json({
    ok: true,
    runtime: "vercel",
    mock: process.env.MOCK_INTEGRATIONS === "true",
    timestamp: new Date().toISOString(),
  });
}
