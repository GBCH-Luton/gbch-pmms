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

// PGRST303 covers both "JWT expired" and "JWT issued at future" -- the
// latter a Supabase-side Auth/Postgres clock-skew glitch seen spread
// across several unrelated staff accounts/devices the same week (found
// live 2026-08-28 via this exact log -- not one person's wrong clock).
// Retried once below rather than just logged.
const JWT_AUTH_ERROR_CODE = 'PGRST303'

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
        originalThen(async result => {
          // Auth is checked before a query ever reaches the database, so
          // retrying is safe for every method here including insert/
          // update/delete -- a PGRST303 rejection means the original
          // attempt never wrote anything. Confirmed against this exact
          // postgrest-js version that re-invoking .then() on the same
          // builder re-runs a real fetch (not a cached promise), and that
          // supabase-js's own fetchWithAuth wrapper injects the
          // Authorization header fresh on every call rather than baking
          // it into the builder -- so refreshSession() + one retry
          // genuinely picks up a new token instead of resending the
          // stale one that got rejected.
          if (result?.error?.code === JWT_AUTH_ERROR_CODE) {
            try {
              await supabase.auth.refreshSession()
              const retryResult = await new Promise((resolve, reject) => { originalThen(resolve, reject) })
              if (retryResult && !retryResult.error) {
                return onFulfilled ? onFulfilled(retryResult) : retryResult
              }
              // Retry also failed -- log ITS error (more current/useful
              // than the original) by falling through below.
              if (retryResult) result = retryResult
            } catch {
              // refreshSession() itself failed -- fall through and log
              // the original result untouched.
            }
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
