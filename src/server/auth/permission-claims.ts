export type PermissionClaimUser = {
  role?: string | null;
  companyPermissions?: readonly string[] | null;
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
  if(permissionKey.startsWith('platform.'))return false; // Platform authority never comes from tenant claims.
  return user?.role === 'hr_admin' || Boolean(user?.permissions?.includes(permissionKey));
}

/** Company-wide features require an explicit company assignment, not a demo name. */
export function hasCompanyPermissionClaim(user: PermissionClaimUser | null | undefined,key:string) {
 return !key.startsWith('platform.') && (user?.role==='hr_admin'||Boolean(user?.companyPermissions?.includes(key)));
}
