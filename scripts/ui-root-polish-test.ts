import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RefreshButton} from '../src/components/ui/RefreshButton';
for(const loading of [false,true])for(const disabled of [false,true]){
 const html=renderToStaticMarkup(createElement(RefreshButton,{loading,disabled,'aria-label':'تحديث'},'تحديث'));
 assert.equal((html.match(/<button/g)||[]).length,1);
 assert(html.includes('type="button"'));
 assert(html.includes(`aria-busy="${loading}"`));
 assert.equal(html.includes('disabled=""'),loading||disabled);
 assert(html.includes('aria-label="تحديث"'));
 assert(html.includes('aria-hidden="true"'),'decorative icon does not duplicate the accessible label');
 assert.equal((html.match(/<svg/g)||[]).length,1);
 assert(!html.includes('animate-spin'),'pending presentation is keyed by actual request state in CSS');
}
console.log('PASS native Refresh utility: busy/disabled truth table, one icon, Arabic accessible label, no submit side effect');
