import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.string().optional(),
    // Lets a production build run a demo on mock data; a forgotten DATAFORSEO_MODE would otherwise store fake rankings as real ones.
    ALLOW_MOCKS: z.enum(["true", "false"]).default("false"),
    PORT: z.coerce.number().int().positive().default(8787),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    DATAFORSEO_MODE: z.enum(["mock", "sandbox", "live"]).default("mock"),
    DATAFORSEO_LOGIN: z.string().optional(),
    DATAFORSEO_PASSWORD: z.string().optional(),
    DATAFORSEO_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    MOCK_ERROR_RATE: z.coerce.number().min(0).max(1).default(0.05),
    MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(800),
    // DataForSEO allows 30 simultaneous requests per account (status 40209).
    PULL_CONCURRENCY: z.coerce.number().int().min(1).max(30).default(10),
    // Built web app to serve from the API; defaults to apps/web/dist when it exists (see web-dist.ts).
    WEB_DIST: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DATAFORSEO_MODE !== "mock" && (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["DATAFORSEO_LOGIN"], message: `DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required in ${env.DATAFORSEO_MODE} mode` });
    }
    if (env.NODE_ENV === "production" && env.ALLOW_MOCKS !== "true" && env.DATAFORSEO_MODE !== "live") {
      ctx.addIssue({ code: "custom", path: ["DATAFORSEO_MODE"], message: "must be live in production (set ALLOW_MOCKS=true for a demo deploy)" });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid API configuration - ${details}`);
  }
  return parsed.data;
}
