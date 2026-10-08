export function getAdminKey() {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  // Current Supabase projects expose secret keys as a JSON map of key names to values.
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
  return secretKeys.default ?? Object.values(secretKeys)[0]
}
