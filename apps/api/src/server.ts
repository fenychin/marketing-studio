import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { Config } from "./config.js";
import { resolveTenant } from "./tenancy.js";
import { rateLimit } from "./ratelimit.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerGenerationRoutes } from "./routes/generations.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerTemplateRoutes } from "./routes/templates.js";
import { registerProjectAndCreditRoutes } from "./routes/projects.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerPlanRoutes } from "./routes/plan.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerEndpointRoutes } from "./routes/endpoints.js";
import { registerRenderTemplateRoutes } from "./routes/render-templates.js";

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(cors, { origin: [config.webOrigin, "http://localhost:5273", "http://127.0.0.1:5273"] });
  await app.register(multipart);

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onRequest", resolveTenant);
  app.addHook("onRequest", rateLimit());

  registerModelRoutes(app);
  registerGenerationRoutes(app);
  registerAssetRoutes(app);
  registerTemplateRoutes(app);
  registerProjectAndCreditRoutes(app);
  registerAuthRoutes(app);
  registerBillingRoutes(app);
  registerAgentRoutes(app);
  registerPlanRoutes(app);
  registerCredentialRoutes(app);
  registerEndpointRoutes(app);
  registerRenderTemplateRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) app.log.error(err);
    reply.code(statusCode).send({
      error: { code: statusCode >= 500 ? "internal" : "request_failed", message: err.message },
    });
  });

  return app;
}
