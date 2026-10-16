/** Explicit local recruiter preview; normal application settings are untouched. */
export function publicDemoOverrides() {
 return {RESEND_API_KEY:'',EMAIL_FROM:'',STANZA_ROUTER_AI_MODE:'disabled',STANZA_ROUTER_OPENAI_LOCAL_AUTH:'false',STANZA_ROUTER_REASONING_KEY:'',STANZA_ROUTER_EMBEDDING_PROVIDER:'local',STANZA_ROUTER_EMBEDDING_KEY:'',STANZA_ROUTER_LEARNING:'false',DOCUMENT_EXTRACTION_PROVIDER:'disabled',ALLOW_DOCUMENT_EXTRACTION_FIXTURES:'false'};
}
