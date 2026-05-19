import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claudeRouter from "./claude";
import cricketRouter from "./cricket";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);
router.use(cricketRouter);

export default router;
