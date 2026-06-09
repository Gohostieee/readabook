/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentShared from "../agentShared.js";
import type * as aiCosts from "../aiCosts.js";
import type * as books from "../books.js";
import type * as factChecker from "../factChecker.js";
import type * as facts from "../facts.js";
import type * as formatter from "../formatter.js";
import type * as lib from "../lib.js";
import type * as transcripts from "../transcripts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentShared: typeof agentShared;
  aiCosts: typeof aiCosts;
  books: typeof books;
  factChecker: typeof factChecker;
  facts: typeof facts;
  formatter: typeof formatter;
  lib: typeof lib;
  transcripts: typeof transcripts;
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

export declare const components: {};
