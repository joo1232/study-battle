import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@^2'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { getAdminKey } from '../_shared/admin.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  const siteUrl = Deno.env.get('APP_SITE_URL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = getAdminKey()
  if (!stripeSecret || !siteUrl || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Billing is not configured yet.' }, 503)
  }

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return jsonResponse({ error: 'Please sign in to continue.' }, 401)
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) return jsonResponse({ error: 'Your session is invalid. Please sign in again.' }, 401)
    const { data: billing, error } = await admin.from('billing_subscriptions')
      .select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    if (error) throw error
    if (!billing?.stripe_customer_id) return jsonResponse({ error: 'No billing account is linked to this profile.' }, 404)

    const stripe = new Stripe(stripeSecret, { httpClient: Stripe.createFetchHttpClient() })
    const portal = await stripe.billingPortal.sessions.create({ customer: billing.stripe_customer_id, return_url: `${siteUrl}/?tab=store` })
    return jsonResponse({ url: portal.url })
  } catch (error) {
    console.error('Billing portal creation failed:', error)
    return jsonResponse({ error: 'Could not open billing settings. Please try again.' }, 500)
  }
})
