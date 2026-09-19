import { loadConfig } from "./config.js";
import { initDb } from "./db/index.js";
import { initRegistry } from "./providers/registry.js";
import { startWorker } from "./jobs.js";
import { buildServer } from "./server.js";

const config = loadConfig();
await initDb(config.dataDir);
initRegistry(config);
startWorker();

const app = await buildServer(config);
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`[studio-api] listening on http://127.0.0.1:${config.port}`);
console.log(`[studio-api] auth: JWT (POST /v1/auth/register|login) or x-api-key demo keys: sk_demo_alpha / sk_demo_beta`);
