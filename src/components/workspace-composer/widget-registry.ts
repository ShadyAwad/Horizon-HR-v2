import { lazy } from 'react';
import { WIDGETS } from './widget-catalog';
const SummaryWidget=lazy(()=>import('./SummaryWidget'));
export const WIDGET_REGISTRY=WIDGETS.map(definition=>({...definition,component:SummaryWidget}));
