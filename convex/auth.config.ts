import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://placeholder.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
