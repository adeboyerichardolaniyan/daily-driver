/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as aiJobs from "../aiJobs.js";
import type * as auth from "../auth.js";
import type * as briefingWeather from "../briefingWeather.js";
import type * as briefings from "../briefings.js";
import type * as calendarFetch from "../calendarFetch.js";
import type * as calendars from "../calendars.js";
import type * as contentAI from "../contentAI.js";
import type * as contentJobs from "../contentJobs.js";
import type * as crons from "../crons.js";
import type * as deletion from "../deletion.js";
import type * as http from "../http.js";
import type * as ical from "../ical.js";
import type * as planning from "../planning.js";
import type * as planningAI from "../planningAI.js";
import type * as printing from "../printing.js";
import type * as publish from "../publish.js";
import type * as workspace from "../workspace.js";
import type * as workspaceHistory from "../workspaceHistory.js";
import type * as workspaceReader from "../workspaceReader.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  admin: typeof admin;
  ai: typeof ai;
  aiJobs: typeof aiJobs;
  auth: typeof auth;
  briefingWeather: typeof briefingWeather;
  briefings: typeof briefings;
  calendarFetch: typeof calendarFetch;
  calendars: typeof calendars;
  contentAI: typeof contentAI;
  contentJobs: typeof contentJobs;
  crons: typeof crons;
  deletion: typeof deletion;
  http: typeof http;
  ical: typeof ical;
  planning: typeof planning;
  planningAI: typeof planningAI;
  printing: typeof printing;
  publish: typeof publish;
  workspace: typeof workspace;
  workspaceHistory: typeof workspaceHistory;
  workspaceReader: typeof workspaceReader;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
