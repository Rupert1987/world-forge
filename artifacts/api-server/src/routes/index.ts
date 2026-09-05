import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import developerRouter from "./developer";
import publicApiRouter from "./public-api";
import mcpRouter from "./mcp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(developerRouter);
router.use(publicApiRouter);
router.use(mcpRouter);

export default router;
