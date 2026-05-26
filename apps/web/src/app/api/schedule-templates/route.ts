import { jsonResponse } from "@/lib/api/json-response";
import { withRoute } from "@/lib/api/route-wrapper";

// ---------------------------------------------------------------------------
// Static template definitions — no DB, no computation
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    id: "4yr-linear-1yr-cliff",
    name: "4-Year Linear with 1-Year Cliff",
    description:
      "Standard employee vesting. 25% unlocks after 1 year, then monthly for 3 years.",
    releaseType: 1,
    params: { cliffDurationDays: 365, totalDurationDays: 1460 },
  },
  {
    id: "2yr-linear",
    name: "2-Year Linear",
    description: "Monthly unlock over 24 months. No cliff.",
    releaseType: 1,
    params: { cliffDurationDays: 0, totalDurationDays: 730 },
  },
  {
    id: "1yr-cliff",
    name: "1-Year Cliff",
    description: "Full amount unlocks after 12 months.",
    releaseType: 0,
    params: { cliffDurationDays: 365 },
  },
  {
    id: "milestone-4",
    name: "4 Milestones",
    description: "4 equal milestones. Each unlocks on creator release.",
    releaseType: 2,
    params: { milestoneCount: 4 },
  },
  {
    id: "6mo-cliff",
    name: "6-Month Cliff",
    description: "Full amount unlocks after 6 months.",
    releaseType: 0,
    params: { cliffDurationDays: 180 },
  },
] as const;

async function getScheduleTemplatesHandler() {
  return jsonResponse({ templates: TEMPLATES });
}

// Public static endpoint — rate limited, no auth required
export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getScheduleTemplatesHandler,
);
