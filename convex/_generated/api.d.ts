import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as admin from "../admin";
import type * as auth from "../auth";
import type * as workspace from "../workspace";
import type * as printing from "../printing";
import type * as powersync_checkpoints from "../powersync_checkpoints";
declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  workspace: typeof workspace;
  printing: typeof printing;
  powersync_checkpoints: typeof powersync_checkpoints;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
