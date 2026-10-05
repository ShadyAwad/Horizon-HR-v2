// Read the real Dashboard registry without rendering React or executing command actions.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {buildCommandRegistry} from '../src/components/command-palette/command-registry';
import {WORKSPACE_REGISTRY} from '../src/navigation/workspace-registry';
import type {StanzaCommand} from '../src/components/command-palette/command-palette-types';
export function dashboardCommandFixture() {
 const source=fs.readFileSync('src/pages/Dashboard.tsx','utf8'),tree=ts.createSourceFile('Dashboard.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let call:ts.CallExpression|undefined;
 function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='buildCommandRegistry')call=n;ts.forEachChild(n,visit);}visit(tree);if(!call)throw Error('Registry missing');
 const languages=fs.readFileSync('src/lib/LanguageContext.tsx','utf8');
 const navigationItems=WORKSPACE_REGISTRY.map(w=>({id:w.id,group:w.group,label:languages.match(new RegExp("'"+w.labelKey.replaceAll('.', '\\.')+"': '([^']*)'"))?.[1]??w.id,icon:null,onSelect:()=>{}}));
 const context:Record<string,unknown>={buildCommandRegistry,navigationItems,text:(en:string)=>en,explicitCommandPermissions:{has:()=>true},hasLeaveApproverAuthority:true,isMobileNavigationLayout:false};for(const name of source.matchAll(/\bcan[A-Z]\w+/g))context[name[0]]=true;
 const expression=call.getText(tree).replace(/<[A-Za-z][^<>]*\/>/g,'null');
 vm.runInNewContext(ts.transpileModule('result='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 return context.result as StanzaCommand[];
}
