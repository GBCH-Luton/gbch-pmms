export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // Without this, Deno's Response defaults to no content-type, and
  // supabase-js's functions.invoke() then hands back the raw JSON text
  // as a string instead of parsing it -- every caller here expects data
  // to already be a parsed object.
  'Content-Type': 'application/json',
}
