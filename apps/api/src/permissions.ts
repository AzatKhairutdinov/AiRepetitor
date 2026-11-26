// Roles (Better Auth admin plugin). "team" sees the Team pages; a Learner is "user".
import { createAccessControl } from "better-auth/plugins/access";

const statement = {
  /** Team diagrams of the Processing flows. */
  flows: ["read"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  user: ac.newRole({ flows: [] }),
  team: ac.newRole({ flows: ["read"] }),
};
