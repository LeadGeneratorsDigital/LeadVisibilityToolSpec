import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { BriefMerger } from "./brief";
import type { PullDeps } from "./pull-service";
import { LeadNotFoundError, PullConflictError, startLeadPull, startPullAll } from "./pull-service";

export interface AppDeps {
  corsOrigin: string;
  /** Resolves a Supabase access token to a user id, or null when it is not valid. */
  verifyToken: (token: string) => Promise<string | null>;
  pull: PullDeps;
  brief: BriefMerger;
  /** Background run promises are handed here so tests can await them. */
  onBackgroundWork?: (work: Promise<void>) => void;
}

const leadParams = z.object({ id: z.string().uuid() });
const briefBody = z.object({
  brief: z.string().max(20_000),
  notes: z.string().trim().min(1, "Notes are required").max(10_000),
});

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: deps.corsOrigin.split(",").map((o) => o.trim()) });

  // Fastify rejects `Content-Type: application/json` with an empty body; the pull routes take no body.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }), undefined);
    }
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const userId = token ? await deps.verifyToken(token).catch(() => null) : null;
    if (!userId) return reply.code(401).send({ error: "Not signed in" });
  };

  const background = (work: Promise<void>) => deps.onBackgroundWork?.(work);

  app.get("/api/health", async () => ({ ok: true, serpMode: deps.pull.serp.mode, briefMode: deps.brief.mode }));

  app.post("/api/leads/:id/pull", { preHandler: authenticate }, async (request, reply) => {
    const params = leadParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid lead id" });
    try {
      const pull = await startLeadPull(deps.pull, params.data.id);
      background(pull.done);
      return reply.code(202).send({ runId: pull.runId });
    } catch (err) {
      if (err instanceof LeadNotFoundError) return reply.code(404).send({ error: err.message });
      if (err instanceof PullConflictError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/pull-all", { preHandler: authenticate }, async (_request, reply) => {
    const result = await startPullAll(deps.pull);
    background(result.done);
    return reply.code(202).send({ started: result.started, skipped: result.skipped });
  });

  app.post("/api/brief/merge", { preHandler: authenticate }, async (request, reply) => {
    const body = briefBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request" });
    try {
      const brief = await deps.brief.merge(body.data.brief, body.data.notes);
      return { brief, mode: deps.brief.mode };
    } catch (err) {
      request.log.error(err);
      return reply.code(502).send({ error: "Could not update the brief - please try again" });
    }
  });

  return app;
}
