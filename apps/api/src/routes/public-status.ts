import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import { loadPublicStatus } from "../services/public-status";

/** No session, firm, or operational detail is exposed from this route. */
export const publicStatusRoutes = new Hono<{ Bindings: Env }>();

publicStatusRoutes.get("/", async (c) => c.json(await loadPublicStatus(createDb(c.env))));
