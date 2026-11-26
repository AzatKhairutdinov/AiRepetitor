import { createAuthClient } from "better-auth/react";

// Same origin: the Vite dev server proxies /api to the Worker.
export const authClient = createAuthClient();
