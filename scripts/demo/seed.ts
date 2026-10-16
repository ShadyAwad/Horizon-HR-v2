import type {PoolClient} from 'pg';
import {context,type DemoContext} from './core';
import {seedOrganisation} from './organisation';
import {seedAttendance,seedLeave} from './attendance-leave';
import {seedFinanceAssets} from './finance-assets';
import {seedHiringGoals} from './hiring-goals';
import {seedGrievances,seedCommunicationsFeed} from './cases-communications';
import {readManifest,clearMovingAttendance} from './reset';
import {seedRecruiterStory} from './curation';
export async function seedDemoContents(client:PoolClient,tenant:{id:string;default_currency:string;allows_company_loans:boolean},organisationOnly=false,onPhase:(name:string)=>void=()=>{}) {
        const policy = (await client.query('SELECT location_mode FROM attendance_policies WHERE tenant_id=$1', [tenant.id])).rows[0];
        const ctx = context(client, tenant, policy?.location_mode ?? 'required');
        const previous = await readManifest(client, tenant.id);
        if (!organisationOnly)
            await clearMovingAttendance(client, tenant.id);
        const phases: [
            string,
            (ctx: DemoContext) => Promise<void>
        ][] = [['organisation and employees', seedOrganisation], ...organisationOnly ? [] : [['attendance and breaks', seedAttendance], ['leave', seedLeave], ['assets and finance', seedFinanceAssets], ['hiring and goals', seedHiringGoals], ['grievance cases', seedGrievances], ['communications, feed and audit', seedCommunicationsFeed], ['recruiter story',seedRecruiterStory]] as [
                string,
                (ctx: DemoContext) => Promise<void>
            ][]];
        for (const [name, run] of phases) {
            onPhase(name);
            await run(ctx);
            console.log(`Ready: ${name}`);
        }
        for (const table of organisationOnly ? Object.keys(previous) : ['employees', 'organisation_departments', 'company_locations'])
            if (previous[table]) {
                if (!ctx.tables.has(table))
                    ctx.tables.set(table, new Set());
                previous[table].forEach(id => ctx.tables.get(table)!.add(id));
            }
        onPhase('fixture manifest');
        await ctx.row('audit_logs', 'fixture-manifest', { action: 'demo.seed_manifest', entity_type: 'demo_seed', entity_id: tenant.id, metadata: JSON.stringify({ version: 8, fixtureIds: Object.fromEntries([...ctx.tables].map(([table, ids]) => [table, [...ids]])) }) });

return ctx;
}
