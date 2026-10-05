import assert from 'node:assert/strict';
import {dashboardCommandFixture} from './command-registry-fixture';
import {arbitrateLocalCommands,rankCommandMatches} from '../src/components/command-palette/command-search';
const commands=dashboardCommandFixture();
for(const [query,destination] of [['theme','settings:appearance'],['font','settings:font'],['news','navigation:feed'],['announcement','navigation:feed'],['announcements','navigation:feed'],['change font','settings:font'],['text size','settings:font'],['change my cursor','settings:appearance'],['dark mode','settings:appearance'],['language','settings:open'],['payday','router:payslips'],['schedule','roster:schedule'],['الثيم','settings:appearance'],['كبر الخط','settings:font'],['اخبار الشركة','navigation:feed']]){
 const r=arbitrateLocalCommands(commands,query);assert.equal(r.confidence,'exact',query);assert(r.commands.some(c=>c.id===destination),query);assert.equal(r.shouldResolve,false,query);
 if(['theme','news','font'].includes(query))assert(r.commands.every(c=>c.id===destination),query+' hides unrelated fuzzy results');
 console.log(JSON.stringify({query,chosen:'local exact',rank:r.ranked.slice(0,3).map(x=>({id:x.command.id,score:x.score,confidence:x.confidence})),accepted:r.commands.map(c=>c.id)}));
}
const weak=arbitrateLocalCommands(commands,'rstr');assert.equal(weak.shouldResolve,true);assert.equal(weak.commands.length,0);assert(weak.ranked.some(r=>r.confidence==='weak'),'raw weak evidence is available for tests');
const strong=arbitrateLocalCommands(commands,'weekly');assert.equal(strong.shouldResolve,false);assert.equal(strong.confidence,'strong');assert.equal(strong.commands[0].id,'navigation:roster');
for(const q of ["who's clocked in right now?",'when is my shift?','when is my next payday?','nonsense zigzag'])assert.equal(arbitrateLocalCommands(commands,q).shouldResolve,true,q);
assert.equal(arbitrateLocalCommands(commands,'font',{recentCommandIds:['expenses:reimbursements'],currentContextId:'expenses'}).commands[0].id,'settings:font','history never overrules lexical relevance');
assert.equal(rankCommandMatches(commands,'font').find(r=>r.command.id==='settings:font')?.confidence,'exact');
assert.equal(arbitrateLocalCommands(commands.filter(c=>c.id!=='navigation:liveEmployees'),'live employees').commands.length,0,'absent authorized command cannot be restored by an alias');
console.log('PASS actual registry arbitration: exact, strong, weak, authorization, Arabic and recency boundaries');
