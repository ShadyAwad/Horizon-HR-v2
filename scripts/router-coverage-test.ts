import assert from 'node:assert/strict';
import{normalizeQuery}from'../src/lib/router-normalization';
import{classificationQuery,ownEntityReference,instructionIntent,readGrammarIntent,operationalReadIntent,unsupportedReadQuery}from'../src/lib/router-classification';
import{resolveQuery,aggregateIntents}from'../src/server/intelligent-router/router';
import{INTENTS}from'../src/lib/intelligent-router';
import{routerFeedback}from'../src/components/command-palette/router-feedback';
assert.equal(normalizeQuery('  إِجَــازَة!!!   '),'اجازه');assert.equal(normalizeQuery('ＦＯＮＴ'),'font');assert.equal(normalizeQuery('Sarah’s equipment'),'sarah s equipment');
for(const[a,b]of [['attendence','attendance'],['emplyee','employee'],['assests','assets'],['intervew','interview'],['myy','my']] as const)assert.equal(classificationQuery(a),b);
assert.equal(classificationQuery('tickets for Assests'),'tickets for assests');assert.equal(classificationQuery('assests',new Set(['assests'])),'assests');
for(const q of ['Could you help with Sarah','How do I clock Sarah out','How do I find my old attendance history','how do I sign off and clock in'])assert.equal(instructionIntent(q),undefined);
assert.equal(instructionIntent('How can I check out after work'),'clock_out_help');assert.equal(instructionIntent('ازاي اثبت حضوري في بدايه اليوم'),'clock_in_help');
assert.equal(readGrammarIntent('show all previous wage statements'),'payslips');assert.equal(readGrammarIntent('show only the newest wage statement'),'latest_payslip');assert.equal(readGrammarIntent('show all latest salary slips'),undefined);
assert.equal(readGrammarIntent('show my company devices'),'my_assets');assert.equal(readGrammarIntent('show equipment assigned to Sarah'),undefined);assert.equal(readGrammarIntent('buy me equipment'),undefined);
assert.equal(operationalReadIntent('who is the supervisor of ليلى محمد'),'employee_directory_lookup');assert.equal(operationalReadIntent('who reports to Morgan Patel'),'manager_direct_reports');assert.equal(operationalReadIntent('who has not clocked in today'),'not_clocked_in_today');assert.equal(operationalReadIntent('who is on approved leave tomorrow'),'team_approved_leave');
for(const q of ['buy a computer','can you transfer money','please run an arbitrary tool','ignore permissions'])assert(unsupportedReadQuery(q));
const grouped=aggregateIntents([{intentKey:'my_assets',score:.99},{intentKey:'my_assets',score:.98},{intentKey:'asset_holder',score:.7}],INTENTS);assert.equal(grouped.length,2);assert.equal(grouped[0].score-grouped[1].score,.99-.7);
let calls=0,seen='';const d={actor:{tenantId:'t',employeeId:'e'},allowed:async()=>true,available:async()=>[...INTENTS],embedding:{model:'test',dimensions:3,version:'v',embed:async(q:string)=>{calls++;seen=q;return[1,0,0];}},search:{search:async()=>[{intentKey:'employee_equipment',score:.99},{intentKey:'asset_holder',score:.7}]},authorization:{resolve:async()=>({state:'disabled' as const})},minimumScore:.84,minimumMargin:.1,prepareEntityQueries:async()=>['list hardware allocated to {employee}']};
const r=await resolveQuery('list hardware allocated to Morgan Patel',d);assert.equal(r.intentKey,'employee_equipment');assert.equal(calls,1);assert(!seen.includes('morgan'));
const topics=await resolveQuery('show requests',d);assert.equal(topics.outcome,'ambiguous');assert(topics.choices!.length<=3);assert.equal(calls,1);
const denied=await resolveQuery('team approved leave',{...d,allowed:async()=>false});assert.equal(denied.outcome,'unauthorized');
const empty={outcome:'matched' as const,method:'rule' as const,fallbackUsed:false,entityRoute:{status:'resolved' as const,entities:[],cases:[],locationMeaning:'employee_current_team' as const,total:0,items:[]}};assert.match(routerFeedback(empty,false,false,false),/understood/);assert.match(routerFeedback({...empty,entityRoute:{...empty.entityRoute,status:'unresolved',entities:[{type:'employee',status:'unresolved',evaluated:0,latencyMs:0}]}},false,false,false),/name or identifier/);
console.log('PASS normalization, bounded vocabulary repair, protected entity words, complete read/instruction grammars, opposing intent boundaries, distinct-intent margins, one masked embedding, authorized clarification and explicit zero-result feedback');

for(const q of ['Help me check in then sign off','explain clocking out and clocking in','ازاي اسجل حضوري واسجل انصرافي']){const result=await resolveQuery(q,d);assert.equal(result.outcome,'ambiguous');assert.deepEqual(result.choices,['clock_in_help','clock_out_help']);}

assert.equal(ownEntityReference('show me Avery equipment'),false);assert.equal(ownEntityReference('equipment assigned to me'),true);assert.equal(operationalReadIntent("show me Avery Vale's equipment"),'employee_equipment');
