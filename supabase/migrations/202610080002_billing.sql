-- Stripe subscription records are private. Only the verified webhook updates these rows and profiles.is_plus.
create table if not exists public.billing_subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text not null default 'incomplete',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;
create policy "Users can view their own subscription status"
  on public.billing_subscriptions for select to authenticated using (auth.uid() = user_id);
revoke all on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;
