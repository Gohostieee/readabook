import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://clerk.readabook.webv1.com",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
