import app from "./app";
import { logger } from "./lib/logger";
import { hydrateProjects } from "./routes/projects";
import { recoverInterruptedAnalysisJobs } from "./lib/persistence";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const recoveredJobs = await recoverInterruptedAnalysisJobs();
if (recoveredJobs > 0) {
  logger.warn({ recoveredJobs }, "Marked interrupted analysis jobs as failed");
}
await hydrateProjects();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
