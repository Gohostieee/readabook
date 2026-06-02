import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://communal-beetle-31.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
