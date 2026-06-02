import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://clerk.readabook.newsoul.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
