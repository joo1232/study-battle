import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@^2'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { getAdminKey } from '../_shared/admin.ts'

const cryptoProvider = Stripe.createSubtleCryptoProvider()

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = getAdminKey()
  const signature = request.headers.get('Stripe-Signature')
  if (!webhookSecret || !stripeSecret || !supabaseUrl || !serviceRoleKey || !signature) {
    return jsonResponse({ error: 'Webhook is not configured.' }, 400)
  }

  const stripe = new Stripe(stripeSecret, { httpClient: Stripe.createFetchHttpClient() })
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(), signature, webhookSecret, undefined, cryptoProvider,
    )
  } catch (error) {
    console.error('Stripe signature verification failed:', error)
    return jsonResponse({ error: 'Invalid webhook signature.' }, 400)
  }

  if (!['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    return jsonResponse({ received: true })
  }

  try {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    let userId = subscription.metadata.supabase_user_id
    if (!userId) {
      const { data, error } = await admin.from('billing_subscriptions').select('user_id')
        .eq('stripe_customer_id', customerId).maybeSingle()
      if (error) throw error
      userId = data?.user_id
    }
    if (!userId) {
      console.error('Stripe subscription has no matching Study Battle account.', subscription.id)
      return jsonResponse({ error: 'Subscription is not linked to a Study Battle user.' }, 400)
    }

    const { error: billingError } = await admin.from('billing_subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (billingError) throw billingError

    const isPlus = subscription.status === 'active' || subscription.status === 'trialing'
    const { error: profileError } = await admin.from('profiles').update({ is_plus: isPlus }).eq('id', userId)
    if (profileError) throw profileError
    return jsonResponse({ received: true })
  } catch (error) {
    console.error('Stripe subscription update failed:', error)
    return jsonResponse({ error: 'Could not apply subscription update.' }, 500)
  }
})
