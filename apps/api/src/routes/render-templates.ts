import type { FastifyInstance } from "fastify";
import { listTemplatePacks } from "../video/template-pack.js";

/** Render template pack catalog: id + self-describing UI panel per pack. */
export function registerRenderTemplateRoutes(app: FastifyInstance): void {
  app.get("/v1/render-templates", async () => ({ templates: listTemplatePacks() }));
}
