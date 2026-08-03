// listUsers() defaults to page 1 / 50 users per page. This shared project
// (PMMS + every other company system) passed 50 total auth users on
// 2026-08-03, which started silently hiding older accounts from any caller
// that only looked at the first page -- e.g. create-staff-account treating
// a real existing account as not-found and trying (and failing) to create
// a duplicate. Walk every page instead of trusting page 1 alone.
export async function findAuthUserByEmail(adminClient: any, email: string) {
  const target = email.toLowerCase()
  const perPage = 200
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error) return null
    const match = data?.users?.find((u: any) => u.email?.toLowerCase() === target)
    if (match) return match
    if (!data?.users?.length || data.users.length < perPage) break
  }
  return null
}
