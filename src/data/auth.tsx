import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  ConvexAuthProvider,
  useAuthActions,
  useAuthToken,
} from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { attachSync, convex } from "./sync";

type Login = (email: string, password: string) => Promise<unknown>;
const LoginContext = createContext<Login>(async () => {
  throw new Error("Sync is not configured. See docs/stage-one.md.");
});
export const useSignIn = () => useContext(LoginContext);
function AuthBridge({ children }: { children: ReactNode }) {
  const token = useAuthToken();
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  // This effect owns an external database connection and cleans it up.
  useEffect(() => attachSync(token, isAuthenticated), [token, isAuthenticated]);
  return (
    <LoginContext.Provider
      value={(email, password) =>
        signIn("password", { email, password, flow: "signIn" })
      }
    >
      {children}
    </LoginContext.Provider>
  );
}
export function WorkspaceAuth({ children }: { children: ReactNode }) {
  if (!convex) return children;
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <AuthBridge>{children}</AuthBridge>
    </ConvexAuthProvider>
  );
}
