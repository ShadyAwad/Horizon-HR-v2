import { Pool, type PoolClient } from 'pg';

export async function assertRuntimeRole(client: PoolClient) {
  const { rows } = await client.query(
    `SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication AS elevated, r.rolcanlogin AS can_login,
      EXISTS (SELECT 1 FROM pg_roles privileged WHERE privileged.oid<>r.oid AND
        pg_has_role(r.oid,privileged.oid,'MEMBER')) AS memberships,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner=r.oid) OR
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relowner=r.oid) OR
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proowner=r.oid) OR
      EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) AS owns_objects
      FROM pg_roles r WHERE rolname=current_user`);
  const role = rows[0];
  if (!role || !role.can_login || role.elevated || role.memberships || role.schema_create || role.owns_objects)
    throw new Error('DATABASE_URL must use a dedicated non-owner runtime role without elevated privileges or role memberships. Use DATABASE_MIGRATION_URL for administration.');
}

// Validate every borrowed connection before it reaches application code. Pool.query
// also borrows through connect; outages still use the existing readiness path.
export class RuntimePool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: (err: Error, client: PoolClient, done: (release?: any) => void) => void): void;
  override connect(callback?: (err: Error, client: PoolClient, done: (release?: any) => void) => void): Promise<PoolClient> | void {
    const borrow = async () => {
      const client = await super.connect();
      try { await assertRuntimeRole(client); return client; }
      catch (error) { client.release(true); throw error; }
    };
    if (!callback) return borrow();
    void borrow().then(client => callback(null!, client, client.release.bind(client)),
      error => callback(error, undefined!, () => {}));
  }
}
