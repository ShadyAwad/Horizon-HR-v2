export type PermissionClaimUser = {
  role?: string | null;
  permissions?: readonly string[] | null;
};

/**
 * Checks the permission claims already established by the authenticated session.
 * Scope, hierarchy, and delegation decisions still belong to scoped-permissions.
 */
export function hasPermissionClaim(
  user: PermissionClaimUser | null | undefined,
  permissionKey: string,
) {
  return user?.role === 'hr_admin' || Boolean(user?.permissions?.includes(permissionKey));
}
