import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        // Accounts are provisioned by an internal administrator action only.
        if (params.flow !== "signIn")
          throw new Error("Public registration is disabled.");
        if (typeof params.email !== "string")
          throw new Error("Email is required.");
        return { email: params.email.trim().toLowerCase() };
      },
    }),
  ],
  jwt: {
    customClaims: async (ctx, { userId }) => {
      const member = await ctx.db.query("app_members").first();
      return { workspace_owner: member?.user_id === userId ? userId : null };
    },
  },
});
