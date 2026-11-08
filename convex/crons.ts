import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "Resume AI requests after key setup",
  { minutes: 1 },
  internal.ai.resumeConfigured,
  {},
);
crons.interval(
  "Refresh calendar subscriptions",
  { minutes: 15 },
  internal.calendars.tick,
  {},
);
crons.interval(
  "Prepare and adjust daily plans",
  { minutes: 15 },
  internal.planning.tick,
  {},
);
crons.interval(
  "Resume receipt collection requests",
  { minutes: 1 },
  internal.contentJobs.resume,
  {},
);
crons.interval(
  "Prepare daily briefings",
  { minutes: 1 },
  internal.briefings.tick,
  {},
);
export default crons;
