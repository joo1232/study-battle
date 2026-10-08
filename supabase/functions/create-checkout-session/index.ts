import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@^2'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { getAdminKey } from '../_shared/admin.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  const priceId = Deno.env.get('STRIPE_PRICE_ID')
  const siteUrl = Deno.env.get('APP_SITE_URL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = getAdminKey()
  if (!stripeSecret || !priceId || !siteUrl || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Billing is not configured yet.' }, 503)
  }

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return jsonResponse({ error: 'Please sign in to continue.' }, 401)
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) return jsonResponse({ error: 'Your session is invalid. Please sign in again.' }, 401)

    const stripe = new Stripe(stripeSecret, { httpClient: Stripe.createFetchHttpClient() })
    const { data: billing, error: billingError } = await admin
      .from('billing_subscriptions').select('stripe_customer_id, status').eq('user_id', user.id).maybeSingle()
    if (billingError) throw billingError
    if (billing?.status === 'active' || billing?.status === 'trialing') {
      return jsonResponse({ error: 'Your Plus subscription is already active. Open Manage subscription instead.' }, 409)
    }

    let customerId = billing?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
      const { error } = await admin.from('billing_subscriptions').upsert({
        user_id: user.id, stripe_customer_id: customerId, status: 'incomplete', updated_at: new Date().toISOString(),
      })
      if (error) throw error
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      success_url: `${siteUrl}/?subscription=success`,
      cancel_url: `${siteUrl}/?subscription=cancelled`,
      subscription_data: { metadata: { supabase_user_id: user.id } },
    })
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL.')
    return jsonResponse({ url: checkout.url })
  } catch (error) {
    console.error('Checkout session creation failed:', error)
    return jsonResponse({ error: 'Could not start checkout. Please try again.' }, 500)
  }
})
