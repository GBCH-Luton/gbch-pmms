import { supabase } from './supabase'

const REPORT_TABLE = 'error_logs'
const CRUD_METHODS = ['select', 'insert', 'update', 'upsert', 'delete']

// Fire-and-forget, matching loginEvents.js's style -- a failed insert here
// must never cascade into the app itself, so every path is swallowed.
export async function logClientError(errorType, message, { stack, context } = {}) {
  try {
    await supabase
      .schema('pmms')
      .from(REPORT_TABLE)
      .insert({
        error_type: errorType,
        message: String(message ?? '').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 8000) : null,
        context: context || null,
      })
  } catch {
    // swallow -- see comment above
  }
}

// A query failing with PGRST303 means the access token expired and
// supabase-js's own silent background refresh didn't happen in time (the
// tab was asleep/backgrounded past the token's lifetime, a network blip
// during the refresh window, etc.) -- confirmed live via Paulo Da Silva's
// error log entry, a tab actively in use hitting this mid-session, not
// just at login. Left alone, the query just silently fails and whatever
// screen depended on it looks broken or empty. Same recovery as the
// stale-chunk case in ErrorBoundary.jsx: reload once, guarded by
// sessionStorage so a genuinely dead account (not just an expired token)
// doesn't loop forever -- a reload either picks the session back up
// cleanly via the refresh token, or lands on the login screen, both far
// better than a query that quietly does nothing. This also happens to be
// a real, frequent-enough moment (unlike a deliberate sign-in) to catch a
// tab that's been open across a deploy and pull it onto current code.
const JWT_EXPIRED_RELOAD_KEY = 'pmms_jwt_reload_at'
const JWT_RELOOP_GUARD_MS = 15000

function handleJwtExpired() {
  const lastReload = Number(sessionStorage.getItem(JWT_EXPIRED_RELOAD_KEY) || 0)
  if (Date.now() - lastReload < JWT_RELOOP_GUARD_MS) return false
  sessionStorage.setItem(JWT_EXPIRED_RELOAD_KEY, String(Date.now()))
  window.location.reload()
  return true
}

// PostgrestQueryBuilder (what .from() returns) isn't itself thenable --
// only the builder returned by .select()/.insert()/.update()/.upsert()/
// .delete() is (confirmed against this project's supabase-js version by
// live-testing a deliberately failing query, not just reading docs). Those
// methods return `this` for further chaining (.eq(), .order(), etc.), so
// patching .then right after one of them is called is enough to observe
// every call site's final result, however much filtering/chaining follows.
function wrapQueryBuilder(queryBuilder, table, schemaName) {
  if (table === REPORT_TABLE) return queryBuilder

  for (const method of CRUD_METHODS) {
    const original = queryBuilder[method]
    if (typeof original !== 'function') continue

    queryBuilder[method] = (...args) => {
      const filterBuilder = original.apply(queryBuilder, args)
      const originalThen = filterBuilder.then.bind(filterBuilder)

      filterBuilder.then = (onFulfilled, onRejected) =>
        originalThen(result => {
          if (result?.error?.code === 'PGRST303' && handleJwtExpired()) {
            return new Promise(() => {}) // reloading -- never resolve into a broken screen
          }
          if (result?.error) {
            logClientError('supabase_query', result.error.message, {
              context: {
                table,
                schema: schemaName,
                method,
                code: result.error.code,
                details: result.error.details,
                hint: result.error.hint,
              },
            })
          }
          return onFulfilled ? onFulfilled(result) : result
        }, onRejected)

      return filterBuilder
    }
  }

  return queryBuilder
}

function wrapFrom(fromFn, schemaName) {
  return (table, ...rest) => wrapQueryBuilder(fromFn(table, ...rest), table, schemaName)
}

// Patches the shared client in place, once, at import time -- main.jsx
// imports this module first (before <App /> renders and fires any query)
// so every one of this app's 160 `.from(...)` call sites -- confirmed to
// only ever go through supabase.from(...) directly (schema 'public') or
// supabase.schema('pmms').from(...), never .rpc() -- gets covered without
// touching any of those call sites.
supabase.from = wrapFrom(supabase.from.bind(supabase), 'public')

const originalSchema = supabase.schema.bind(supabase)
supabase.schema = (name) => {
  const scoped = originalSchema(name)
  scoped.from = wrapFrom(scoped.from.bind(scoped), name)
  return scoped
}
