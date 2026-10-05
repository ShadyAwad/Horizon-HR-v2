import type { StanzaCommand } from './command-palette-types';

const COMBINING_MARKS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;

export function normaliseCommandSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isSubsequence(needle: string, haystack: string) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function scoreValue(value: string, query: string) {
  if (!value || !query) return 0;
  if (value === query) return 1_000;
  if (value.startsWith(query)) return 850 - Math.min(100, value.length - query.length);
  if (value.split(' ').some((token) => token.startsWith(query))) return 700;
  const substringIndex = value.indexOf(query);
  if (substringIndex >= 0) return 550 - Math.min(100, substringIndex);
  if (query.length >= 2 && isSubsequence(query, value)) return 250;
  return 0;
}

export function scoreCommand(
  command: StanzaCommand,
  query: string,
  options: {
    recentCommandIds?: readonly string[];
    currentContextId?: string;
  } = {},
) {
  const normalisedQuery = normaliseCommandSearchText(query);
  const label = normaliseCommandSearchText(command.label);
  const description = normaliseCommandSearchText(command.description);
  const keywords = command.keywords.map(normaliseCommandSearchText);

  let relevance = normalisedQuery ? scoreValue(label, normalisedQuery) : 1;
  if (normalisedQuery) {
    relevance = Math.max(
      relevance,
      Math.max(0, ...keywords.map((keyword) => scoreValue(keyword, normalisedQuery) - 40)),
      scoreValue(description, normalisedQuery) - 100,
    );
  }
  if (relevance <= 0) return Number.NEGATIVE_INFINITY;

  const recentIndex = options.recentCommandIds?.indexOf(command.id) ?? -1;
  const recentBoost = recentIndex >= 0 ? Math.max(1, 24 - recentIndex * 3) : 0;
  const contextBoost = options.currentContextId && command.contextId === options.currentContextId ? 12 : 0;
  return relevance * 1_000 + recentBoost + contextBoost;
}

export function searchCommands(
  commands: readonly StanzaCommand[],
  query: string,
  options: {
    recentCommandIds?: readonly string[];
    currentContextId?: string;
  } = {},
) {
  return commands
    .map((command, registryIndex) => ({
      command,
      registryIndex,
      score: scoreCommand(command, query, options),
    }))
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => right.score - left.score || left.registryIndex - right.registryIndex)
    .map((result) => result.command);
}

/** Raw scores retain weak candidates for diagnostics; only lexical evidence wins arbitration. */
export function rankCommandMatches(commands:readonly StanzaCommand[],query:string,options:Parameters<typeof scoreCommand>[2]={}) {
  const q=normaliseCommandSearchText(query);
  const lexical=(value:string)=>{const v=normaliseCommandSearchText(value);return v===q?'exact':q.length>=3&&(v.startsWith(q)||v.split(' ').some(token=>token.startsWith(q)))?'strong':'weak';};
  return commands.map((command,registryIndex)=>{
    const fields=[command.label,...command.keywords,command.description];
    const evidence=fields.map(lexical);
    // Descriptions explain destinations; they never constitute exact command aliases.
    const confidence=!q?'strong':evidence.slice(0,-1).includes('exact')?'exact':evidence.includes('strong')?'strong':'weak';
    return {command,registryIndex,score:scoreCommand(command,query,options),confidence};
  }).filter(r=>Number.isFinite(r.score)).sort((a,b)=>b.score-a.score||a.registryIndex-b.registryIndex);
}
export function arbitrateLocalCommands(commands:readonly StanzaCommand[],query:string,options:Parameters<typeof scoreCommand>[2]={}) {
  const ranked=rankCommandMatches(commands,query,options);
  const exact=ranked.filter(r=>r.confidence==='exact');
  const accepted=exact.length?exact:ranked.filter(r=>r.confidence==='strong');
  return {ranked,commands:accepted.map(r=>r.command),confidence:exact.length?'exact':accepted.length?'strong':'weak',shouldResolve:!!query.trim()&&!accepted.length};
}
