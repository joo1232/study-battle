import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, ArrowUpRight, Award, BookOpen, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Coins, Flame, Gift, GraduationCap, LayoutDashboard,
  LockKeyhole, LogOut, Mail, Menu, Moon, Pause, Play, Plus, Rocket,
  ShieldCheck, ShoppingBag, Sparkles,
  Sprout, TimerReset, Trophy, UserPlus, Users, X,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'

const subjects = ['Deep work', 'Mathematics', 'Science', 'Languages', 'Reading', 'Other']
let pendingAuthCodeExchange = null
const navItems = [
  { id: 'focus', label: 'Focus room', icon: LayoutDashboard },
  { id: 'friends', label: 'Study circle', icon: Users },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'store', label: 'Coin store', icon: ShoppingBag },
]

function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function friendlyDuration(totalSeconds = 0) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function initials(username = 'SB') {
  return username.slice(0, 2).toUpperCase()
}

function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState('signin')
  const [profile, setProfile] = useState(null)
  const [recentSessions, setRecentSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [friends, setFriends] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [products, setProducts] = useState([])
  const [ownedProducts, setOwnedProducts] = useState([])
  const [activeTab, setActiveTab] = useState('focus')
  const [subject, setSubject] = useState(subjects[0])
  const [clockNow, setClockNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [setupVisible, setSetupVisible] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [usernameDraft, setUsernameDraft] = useState('')
  const [authError, setAuthError] = useState('')
  const [dashboardError, setDashboardError] = useState('')
  const [todaySeconds, setTodaySeconds] = useState(0)
  const [subscriptionReturn, setSubscriptionReturn] = useState(false)

  const notify = useCallback((message, type = 'success') => {
    setNotice({ message, type })
    window.setTimeout(() => setNotice(null), 4200)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthReady(true)
      return undefined
    }
    let alive = true
    const start = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        if (!pendingAuthCodeExchange) pendingAuthCodeExchange = supabase.auth.exchangeCodeForSession(code)
        const { error } = await pendingAuthCodeExchange
        pendingAuthCodeExchange = null
        if (error && alive) notify(`Could not complete email verification: ${error.message}`, 'error')
        params.delete('code')
        const query = params.toString()
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      }
      if (params.get('mode') === 'reset') setAuthMode('reset-password')
      if (params.get('tab') === 'store' || params.has('subscription')) setActiveTab('store')
      if (params.get('verified') === '1') notify('Email verified. Welcome to Study Battle!')
      if (params.get('subscription') === 'success') {
        setSubscriptionReturn(true)
        notify('Checkout complete. Plus activates as soon as Stripe confirms your subscription.')
      }
      if (params.get('subscription') === 'cancelled') notify('Checkout was cancelled. Your study space is unchanged.')
      if (params.has('subscription') || params.has('verified')) {
        params.delete('subscription'); params.delete('verified')
        const query = params.toString()
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      }
      const { data } = await supabase.auth.getSession()
      if (alive) {
        setSession(data.session)
        setAuthReady(true)
      }
    }
    start().catch((error) => {
      if (alive) {
        notify(error.message || 'Could not connect to Supabase.', 'error')
        setAuthReady(true)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY') setAuthMode('reset-password')
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [notify])

  const loadDashboard = useCallback(async () => {
    if (!session?.user) return
    setDashboardError('')
    const userId = session.user.id
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const [profileResult, sessionsResult, activeResult, friendsResult, leaderboardResult, productsResult, ownedResult, todayResult] = await Promise.all([
      supabase.from('profiles').select('id, username, coins, focus_seconds, coin_progress_seconds, streak_days, is_plus').eq('id', userId).single(),
      supabase.from('study_sessions').select('id, subject, started_at, ended_at, elapsed_seconds, coins_awarded, status').eq('user_id', userId).eq('status', 'finished').order('ended_at', { ascending: false }).limit(8),
      supabase.from('study_sessions').select('id, subject, started_at, resumed_at, elapsed_seconds, status').eq('user_id', userId).in('status', ['active', 'paused']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('friendships').select('friend_id').eq('user_id', userId),
      supabase.from('profiles').select('id, username, focus_seconds, streak_days').order('focus_seconds', { ascending: false }).limit(10),
      supabase.from('shop_products').select('id, name, description, emoji, coin_cost, category').eq('is_active', true).order('sort_order'),
      supabase.from('user_items').select('product_id').eq('user_id', userId),
      supabase.from('study_sessions').select('elapsed_seconds').eq('user_id', userId).eq('status', 'finished').gte('ended_at', dayStart.toISOString()),
    ])
    const firstError = [profileResult, sessionsResult, activeResult, friendsResult, leaderboardResult, productsResult, ownedResult, todayResult].find((result) => result.error)
    if (firstError) throw firstError.error
    setProfile(profileResult.data)
    setUsernameDraft(profileResult.data.username)
    setRecentSessions(sessionsResult.data || [])
    setActiveSession(activeResult.data || null)
    setLeaderboard(leaderboardResult.data || [])
    setProducts(productsResult.data || [])
    setOwnedProducts((ownedResult.data || []).map((item) => item.product_id))
    setTodaySeconds((todayResult.data || []).reduce((total, item) => total + item.elapsed_seconds, 0))
    const friendIds = (friendsResult.data || []).map((item) => item.friend_id)
    if (!friendIds.length) setFriends([])
    else {
      const { data, error } = await supabase.from('profiles').select('id, username, focus_seconds, streak_days').in('id', friendIds).order('focus_seconds', { ascending: false })
      if (error) throw error
      setFriends(data || [])
    }
    return profileResult.data
  }, [session])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    loadDashboard().catch((error) => { setDashboardError(error.message || 'Could not load your study data.'); notify(error.message || 'Could not load your study data.', 'error') })
  }, [session?.user?.id, loadDashboard, notify])

  useEffect(() => {
    if (!session?.user || !subscriptionReturn) return undefined
    let cancelled = false
    let timer
    let attempts = 0
    const refreshUntilWebhook = async () => {
      const latestProfile = await loadDashboard()
      attempts += 1
      if (cancelled) return
      if (latestProfile?.is_plus || attempts >= 10) {
        setSubscriptionReturn(false)
        return
      }
      timer = window.setTimeout(refreshUntilWebhook, 2000)
    }
    refreshUntilWebhook().catch((error) => {
      if (!cancelled) {
        setSubscriptionReturn(false)
        notify(error.message || 'Could not refresh subscription status.', 'error')
      }
    })
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [session?.user?.id, subscriptionReturn, loadDashboard, notify])

  useEffect(() => {
    if (!activeSession) return undefined
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [activeSession])

  const elapsedSeconds = useMemo(() => {
    if (!activeSession) return 0
    const alreadyElapsed = activeSession.elapsed_seconds || 0
    if (activeSession.status !== 'active' || !activeSession.resumed_at) return alreadyElapsed
    return alreadyElapsed + Math.max(0, Math.floor((clockNow - new Date(activeSession.resumed_at).getTime()) / 1000))
  }, [activeSession, clockNow])

  const focusedToday = todaySeconds + elapsedSeconds

  const startSession = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('start_study_session', { p_subject: subject })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    setActiveSession(data)
    notify('Focus session started. You’ve got this!')
  }

  const updateSessionState = async (rpcName) => {
    if (!activeSession) return
    setBusy(true)
    const { data, error } = await supabase.rpc(rpcName, { p_session_id: activeSession.id })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    setActiveSession(data)
  }

  const finishSession = async () => {
    if (!activeSession) return
    setBusy(true)
    const { data, error } = await supabase.rpc('finish_study_session', { p_session_id: activeSession.id })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    setActiveSession(null)
    await loadDashboard()
    notify(data.coins_earned ? `Session saved · +${data.coins_earned} focus coins 🪙` : 'Session saved. Every focused minute counts!')
  }

  const addFriend = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc('add_friend_by_username', { p_username: friendUsername.trim() })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    setFriendUsername('')
    await loadDashboard()
    notify('Study buddy added to your circle!')
  }

  const removeFriend = async (friendId) => {
    const { error } = await supabase.from('friendships').delete().eq('friend_id', friendId)
    if (error) return notify(error.message, 'error')
    await loadDashboard()
  }

  const buyProduct = async (productId) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('purchase_shop_item', { p_product_id: productId })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    await loadDashboard()
    notify(data.message || 'Added to your collection!')
  }

  const openCheckout = async () => {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: {} })
    setBusy(false)
    if (error || !data?.url) return notify(error?.message || data?.error || 'Could not start checkout.', 'error')
    window.location.assign(data.url)
  }

  const openBillingPortal = async () => {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} })
    setBusy(false)
    if (error || !data?.url) return notify(error?.message || data?.error || 'Could not open billing settings.', 'error')
    window.location.assign(data.url)
  }

  const saveUsername = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.rpc('update_my_username', { p_username: usernameDraft.trim() })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    setProfile((current) => ({ ...current, username: data }))
    setAccountOpen(false)
    notify('Username updated.')
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) notify(error.message, 'error')
  }

  if (!authReady) return <FullScreenMessage icon={<Sparkles />} title="Getting your desk ready" detail="Connecting securely to Study Battle…" />
  if (!isSupabaseConfigured) return <SetupScreen visible={setupVisible} onDismiss={() => setSetupVisible(false)} />
  if (!session) return <AuthScreen mode={authMode} setMode={(mode) => { setAuthError(''); setAuthMode(mode) }} error={authError} setError={setAuthError} notify={notify} />
  if (authMode === 'reset-password') return <AuthScreen mode={authMode} setMode={(mode) => { setAuthError(''); setAuthMode(mode) }} error={authError} setError={setAuthError} notify={notify} />
  if (!profile) return dashboardError
    ? <FullScreenMessage icon={<GraduationCap />} title="We couldn’t load your study space" detail={dashboardError} action={<button className="primary-button" onClick={() => loadDashboard().catch((error) => setDashboardError(error.message))}>Try again <ArrowRight size={16} /></button>} />
    : <FullScreenMessage icon={<GraduationCap />} title="Setting up your study space" detail="Loading your profile and focus stats…" />

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Sparkles size={19} /></div><div><strong>study<span>battle</span></strong><small>FOCUS TOGETHER</small></div><button className="icon-button mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${activeTab === id ? 'nav-active' : ''}`} onClick={() => { setActiveTab(id); setMobileNavOpen(false) }}><Icon size={18} /><span>{label}</span>{id === 'store' && <span className="nav-new">NEW</span>}</button>)}</nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-plan"><div className="plan-orb"><Rocket size={17} /></div><div><b>Study Battle Plus</b><p>More focus, more flow.</p><span>Manage in the coin store</span></div><ArrowRight size={15} /></div>
        <div className="sidebar-user"><div className="avatar">{initials(profile.username)}</div><div className="user-copy"><strong>@{profile.username}</strong><span>Level {Math.floor((profile.focus_seconds || 0) / 3600 / 5) + 1} · Focus explorer</span></div><button className="icon-button" onClick={() => setAccountOpen(true)} aria-label="Account settings"><ChevronDown size={17} /></button></div>
        <div className="sidebar-credit">Made with focus · Bebo &amp; Joe</div>
      </aside>
      {mobileNavOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-area">
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb">Your workspace <span>/</span> <b>{navItems.find((item) => item.id === activeTab)?.label}</b></div><div className="topbar-right"><div className="coin-pill"><span className="coin-icon"><Coins size={16} /></span><span>{profile.coins}</span><small>COINS</small></div><button className="top-avatar" onClick={() => setAccountOpen(true)} aria-label="Open account settings">{initials(profile.username)}</button></div></header>
        <div className="page-content">
          {activeTab === 'focus' && <FocusPage profile={profile} elapsed={elapsedSeconds} activeSession={activeSession} subject={subject} setSubject={setSubject} busy={busy} onStart={startSession} onPause={() => updateSessionState('pause_study_session')} onResume={() => updateSessionState('resume_study_session')} onFinish={finishSession} sessions={recentSessions} focusedToday={focusedToday} />}
          {activeTab === 'friends' && <FriendsPage friends={friends} username={friendUsername} setUsername={setFriendUsername} onAdd={addFriend} onRemove={removeFriend} busy={busy} />}
          {activeTab === 'leaderboard' && <LeaderboardPage entries={leaderboard} userId={profile.id} />}
          {activeTab === 'store' && <StorePage products={products} ownedProducts={ownedProducts} coins={profile.coins} isPlus={profile.is_plus} onBuy={buyProduct} onSubscribe={openCheckout} onManage={openBillingPortal} busy={busy} />}
        </div>
        <footer className="page-footer"><span>© {new Date().getFullYear()} Study Battle</span><span>Small steps. Serious momentum.</span><span>Developed by <b>Bebo &amp; Joe</b></span></footer>
      </main>
      {accountOpen && <AccountModal username={usernameDraft} setUsername={setUsernameDraft} onSave={saveUsername} onClose={() => setAccountOpen(false)} onSignOut={signOut} busy={busy} />}
      {notice && <div role="status" className={`toast ${notice.type === 'error' ? 'toast-error' : ''}`}><span>{notice.type === 'error' ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}
    </div>
  )
}

function AuthScreen({ mode, setMode, error, setError, notify }) {
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [resendBusy, setResendBusy] = useState(false)
  const isSignup = mode === 'signup'
  const isReset = mode === 'reset'
  const isNewPassword = mode === 'reset-password'

  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true)
    try {
      if (isSignup) {
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/?verified=1`, data: { username: username.trim().toLowerCase() } } })
        if (authError) throw authError
        if (!data.session) setMessage('Check your inbox for a verification link. Confirm your email to unlock your study space.')
      } else if (isReset) {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/?mode=reset` })
        if (authError) throw authError
        setMessage('If an account matches that email, a password reset link is on its way.')
      } else if (isNewPassword) {
        const { error: authError } = await supabase.auth.updateUser({ password })
        if (authError) throw authError
        setMessage('Password updated. You’re ready to get back to it.')
        window.history.replaceState({}, '', window.location.pathname)
        window.setTimeout(() => setMode('signin'), 1400)
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) throw authError
      }
    } catch (authError) { setError(authError.message || 'Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  const title = isSignup ? 'Make room for better focus.' : isNewPassword ? 'Choose a new password.' : isReset ? 'Let’s get you back in.' : 'A little focus goes a long way.'
  const subtitle = isSignup ? 'Create your account and build a study habit that sticks.' : isNewPassword ? 'Use a strong password you have not used elsewhere.' : isReset ? 'Enter the email linked to your account and we’ll send a reset link.' : 'Welcome back. Your next good study session starts here.'

  const resendVerification = async () => {
    setResendBusy(true); setError('')
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/?verified=1` } })
    setResendBusy(false)
    if (resendError) setError(resendError.message)
    else setMessage('A fresh verification link is on its way. Check your inbox and spam folder.')
  }

  return <div className="auth-layout"><section className="auth-showcase"><div className="auth-brand"><div className="brand-mark"><Sparkles size={19} /></div><strong>study<span>battle</span></strong></div><div className="showcase-copy"><span className="eyebrow"><span className="live-dot" />YOUR CALM, COMPETITIVE STUDY SPACE</span><h1>Make focus<br />feel <em>rewarding.</em></h1><p>Find your rhythm, show up for your goals, and make progress with your people.</p><div className="showcase-stats"><div><b>01</b><span>Start small</span></div><div><b>02</b><span>Stay consistent</span></div><div><b>03</b><span>Celebrate progress</span></div></div></div><div className="showcase-card"><div className="showcase-card-icon"><Flame size={19} /></div><div><b>One focused hour at a time.</b><span>Coins are earned from completed study sessions.</span></div><ArrowUpRight size={17} /></div><div className="showcase-footer">A thoughtful little project by <b>Bebo &amp; Joe</b></div><div className="showcase-decoration deco-one" /><div className="showcase-decoration deco-two" /></section>
    <section className="auth-form-side"><div className="auth-form-wrap"><div className="mobile-auth-brand"><div className="brand-mark"><Sparkles size={19} /></div><strong>study<span>battle</span></strong></div><span className="form-kicker">{isSignup ? 'YOUR ACCOUNT STARTS HERE' : 'YOUR STUDY SPACE AWAITS'}</span><h2>{title}</h2><p className="auth-subtitle">{subtitle}</p>
      <form className="auth-form" onSubmit={submit}>
        {isSignup && <label>Username<div className="input-wrap"><Users size={17} /><input value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" autoComplete="username" placeholder="Choose a username" /></div><small>3–20 characters · letters, numbers, underscores</small></label>}
        {!isNewPassword && <label>Email address<div className="input-wrap"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></div></label>}
        {!isReset && <label>{isNewPassword ? 'New password' : 'Password'}<div className="input-wrap"><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={isSignup || isNewPassword ? 'new-password' : 'current-password'} placeholder={isSignup || isNewPassword ? 'At least 8 characters' : 'Enter your password'} /></div>{(isSignup || isNewPassword) && <small>At least 8 characters. Supabase securely manages passwords.</small>}</label>}
        {error && <div role="alert" className="form-alert">{error}</div>}{message && <div role="status" className="form-success"><CheckCircle2 size={17} />{message}</div>}
        {isSignup && message && <button type="button" className="text-action" disabled={resendBusy || !email} onClick={resendVerification}>{resendBusy ? 'Sending a new link…' : 'Didn’t receive it? Resend verification email'}</button>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : null}{busy ? 'One moment…' : isSignup ? 'Create my account' : isReset ? 'Send reset link' : isNewPassword ? 'Update password' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      {mode === 'signin' && <button className="text-action forgot-action" onClick={() => { setError(''); setMode('reset') }}>Forgot your password?</button>}
      <div className="auth-switch">{isSignup ? <>Already have an account? <button onClick={() => setMode('signin')}>Sign in</button></> : isReset || isNewPassword ? <button onClick={() => setMode('signin')}>Back to sign in</button> : <>New to Study Battle? <button onClick={() => setMode('signup')}>Create account</button></>}</div>
      <div className="auth-security"><ShieldCheck size={16} /><span>Secure sign-in powered by Supabase Auth</span></div>
    </div><div className="auth-bottom-note">© {new Date().getFullYear()} Study Battle · <a href="https://supabase.com/docs/guides/auth" target="_blank" rel="noreferrer">Privacy-first authentication</a></div></section></div>
}

function SetupScreen({ visible, onDismiss }) {
  return <div className="setup-page"><div className="setup-card"><div className="brand-mark setup-logo"><Sparkles size={21} /></div><span className="form-kicker">PROJECT SETUP</span><h1>Connect your study space.</h1><p>Study Battle is ready to run. Add your Supabase project keys to enable verified accounts, persistent study sessions, friends, and the coin store.</p><ol className="setup-steps"><li><span>01</span><div><b>Create a Supabase project</b><small>Start a project in the Supabase dashboard.</small></div><ArrowUpRight size={16} /></li><li><span>02</span><div><b>Copy your project URL and publishable key</b><small>Place both values in your local <code>.env</code> file.</small></div><ArrowUpRight size={16} /></li><li><span>03</span><div><b>Apply the database migration</b><small>Run the SQL file in <code>supabase/migrations</code>.</small></div><ArrowUpRight size={16} /></li></ol><div className="setup-code"><code>cp .env.example .env</code><button onClick={() => navigator.clipboard?.writeText('cp .env.example .env')} aria-label="Copy setup command"><Check size={16} /></button></div><div className="setup-actions"><a className="primary-button" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase <ArrowUpRight size={16} /></a><a className="quiet-link" href="https://supabase.com/docs/guides/auth/auth-smtp" target="_blank" rel="noreferrer">Email setup guide</a></div>{visible && <div className="setup-demo-note"><CircleHelp size={17} /><span>Preview mode is waiting on your Supabase keys. No fake registration or pretend purchases are enabled.</span></div>}<div className="setup-credit">Developed by <b>Bebo &amp; Joe</b></div></div></div>
}

function FullScreenMessage({ icon, title, detail, action }) { return <div className="full-screen-message"><div>{icon}</div><h1>{title}</h1><p>{detail}</p>{action || <span className="spinner large-spinner" />}</div> }

function PageHeading({ eyebrow, title, detail, action }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{action}</div> }

function FocusPage({ profile, elapsed, activeSession, subject, setSubject, busy, onStart, onPause, onResume, onFinish, sessions, focusedToday }) {
  const progress = Math.min(100, (focusedToday / (2 * 3600)) * 100)
  const currentHourProgress = Math.floor((profile.coin_progress_seconds || 0) / 3600 * 100)
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()
  return <>
    <PageHeading eyebrow={todayLabel} title={<>Good to see you, <span className="heading-accent">{profile.username}</span>.</>} detail="A clear mind is built one focused minute at a time." action={<div className="streak-chip"><span>🔥</span><div><b>{profile.streak_days} day streak</b><small>Keep the rhythm going</small></div></div>} />
    <div className="focus-layout"><section className="timer-card"><div className="timer-topline"><span className="session-status"><span className={`status-dot ${activeSession?.status === 'active' ? 'status-live' : ''}`} />{activeSession?.status === 'active' ? 'FOCUS SESSION LIVE' : activeSession?.status === 'paused' ? 'SESSION PAUSED' : 'YOUR FOCUS ROOM'}</span><span className="timer-mode"><Moon size={14} /> Deep focus</span></div><div className="timer-ambient ambient-one" /><div className="timer-ambient ambient-two" /><div className="timer-center"><div className="timer-ring"><div className="timer-ring-inner"><span className="timer-time">{formatDuration(elapsed)}</span><span className="timer-caption">{activeSession ? activeSession.status === 'paused' ? 'PAUSED — TAKE YOUR TIME' : 'PROTECT THIS MOMENT' : 'READY WHEN YOU ARE'}</span></div></div><div className="timer-subject"><BookOpen size={15} /><select aria-label="Study subject" value={activeSession?.subject || subject} disabled={Boolean(activeSession)} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div><div className="timer-controls">{!activeSession ? <button className="primary-button start-button" disabled={busy} onClick={onStart}><Play size={17} fill="currentColor" />Start focus</button> : <>{activeSession.status === 'active' ? <button className="secondary-button" disabled={busy} onClick={onPause}><Pause size={17} fill="currentColor" />Pause</button> : <button className="primary-button" disabled={busy} onClick={onResume}><Play size={17} fill="currentColor" />Resume</button>}<button className="finish-button" disabled={busy} onClick={onFinish}><Check size={17} />Finish session</button></>}</div><div className="timer-footnote"><ShieldCheck size={14} />Your focus time is saved securely to your account</div></div></section>
      <div className="focus-side"><section className="metric-card"><div className="metric-card-header"><div><span className="metric-label">TODAY’S FOCUS</span><h2>{friendlyDuration(focusedToday)}</h2></div><div className="metric-icon mint-icon"><Clock3 size={19} /></div></div><div className="goal-line"><span>Daily intention</span><b>{Math.round(progress)}% <small>of 2 hours</small></b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="goal-footer"><span>Keep your promise to yourself.</span><span>{friendlyDuration(focusedToday)} / 2h</span></div></section>
        <section className="metric-card coin-progress-card"><div className="metric-card-header"><div><span className="metric-label">NEXT COIN DROP</span><h2>{10 - Math.floor((profile.coin_progress_seconds || 0) / 3600 * 10)} <small>coins away</small></h2></div><div className="metric-icon gold-icon"><Coins size={19} /></div></div><div className="progress-track gold-track"><span style={{ width: `${currentHourProgress}%` }} /></div><div className="goal-footer"><span>Earn 10 for every focused hour.</span><span>{Math.floor(currentHourProgress)}%</span></div></section>
        <section className="quote-card"><div className="quote-icon"><Sprout size={18} /></div><p>“You don’t have to see the whole staircase. Just take the first step.”</p><span>— MARTIN LUTHER KING JR.</span><div className="quote-decoration">✳</div></section></div></div>
    <div className="section-heading"><div><span className="eyebrow">YOUR MOMENTUM</span><h2>Recent focus sessions</h2></div><div className="section-hint"><span className="live-dot" />Synced to your account</div></div>
    <section className="sessions-card">{sessions.length ? sessions.slice(0, 5).map((item) => <div className="session-row" key={item.id}><div className="session-subject-icon"><BookOpen size={17} /></div><div className="session-details"><b>{item.subject}</b><span>{new Date(item.ended_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(item.ended_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div><div className="session-duration">{friendlyDuration(item.elapsed_seconds)}</div><div className="session-earned"><Coins size={14} />+{item.coins_awarded}</div></div>) : <div className="empty-state"><div className="empty-icon"><TimerReset size={21} /></div><b>Your first session is waiting.</b><span>Start a focus session and your progress will show up here.</span></div>}</section>
  </>
}

function FriendsPage({ friends, username, setUsername, onAdd, onRemove, busy }) {
  return <><PageHeading eyebrow="BETTER TOGETHER" title="Your study circle." detail="Add a study buddy and keep each other moving forward." /><div className="friends-layout"><section className="surface-card friend-add-card"><div className="surface-icon lavender-icon"><UserPlus size={19} /></div><h2>Invite a study buddy</h2><p>Enter their Study Battle username. You’ll see their public focus hours and streak.</p><form className="friend-form" onSubmit={onAdd}><label htmlFor="friend-username">USERNAME</label><div className="friend-input"><span>@</span><input id="friend-username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} required placeholder="their_username" /><button aria-label="Add friend" disabled={busy}><Plus size={18} /></button></div></form><div className="friend-privacy"><ShieldCheck size={15} />Only usernames, focus totals, and streaks are shared.</div></section><section className="surface-card friends-list-card"><div className="list-title"><div><h2>Your circle</h2><span>{friends.length} {friends.length === 1 ? 'study buddy' : 'study buddies'}</span></div><Users size={20} /></div>{friends.length ? friends.map((friend, index) => <div className="friend-row" key={friend.id}><div className={`avatar friend-avatar friend-avatar-${index % 4}`}>{initials(friend.username)}</div><div className="friend-info"><b>@{friend.username}</b><span>🔥 {friend.streak_days} day streak</span></div><div className="friend-hours"><b>{friendlyDuration(friend.focus_seconds)}</b><span>FOCUS TIME</span></div><button className="icon-button remove-friend" onClick={() => onRemove(friend.id)} title="Remove study buddy"><X size={15} /></button></div>) : <div className="empty-state friends-empty"><div className="empty-icon"><Users size={21} /></div><b>Your circle starts with one.</b><span>Add a friend by their Study Battle username.</span></div>}</section></div></>
}

function LeaderboardPage({ entries, userId }) {
  return <><PageHeading eyebrow="CELEBRATE THE WORK" title="The focus leaderboard." detail="A little friendly momentum for the week ahead." /><section className="leaderboard-card"><div className="leaderboard-head"><span>RANK</span><span>STUDY BATTLE MEMBER</span><span>FOCUS TIME</span></div>{entries.length ? entries.map((item, index) => <div className={`leaderboard-row ${item.id === userId ? 'leaderboard-me' : ''}`} key={item.id}><div className={`rank-number ${index < 3 ? `rank-${index + 1}` : ''}`}>{index === 0 ? '✦' : String(index + 1).padStart(2, '0')}</div><div className="leader-user"><div className="avatar leaderboard-avatar">{initials(item.username)}</div><div><b>@{item.username}{item.id === userId && <span className="you-badge">YOU</span>}</b><span>🔥 {item.streak_days} day streak</span></div></div><div className="leader-time"><b>{friendlyDuration(item.focus_seconds)}</b>{index < 3 ? <Award size={16} /> : null}</div></div>) : <div className="empty-state"><Trophy size={23} /><b>Be the first on the board.</b><span>Start a focus session to add your name.</span></div>}<div className="leaderboard-note"><ShieldCheck size={15} />Only username, streak, and completed focus time appear here.</div></section></>
}

function StorePage({ products, ownedProducts, coins, isPlus, onBuy, onSubscribe, onManage, busy }) {
  return <><PageHeading eyebrow="A LITTLE REWARD FOR SHOWING UP" title="The coin store." detail="Spend the coins you earn by focusing. The best rewards are delightfully silly." action={<div className="coin-balance"><Coins size={18} /><span>{coins}</span><small>YOUR COINS</small></div>} /><div className="store-banner"><div className="banner-sparkle"><Sparkles size={22} /></div><div className="plus-copy"><span className="eyebrow">STUDY BATTLE PLUS</span><h2>{isPlus ? 'Your focus has a little extra.' : 'A little extra room to grow.'}</h2><p>{isPlus ? 'Your subscription is active. Plus members earn 20 coins per focused hour.' : 'Bonus coin rewards and a calmer place to build your study habit.'}</p><button className="plus-button" disabled={busy} onClick={isPlus ? onManage : onSubscribe}>{isPlus ? 'Manage subscription' : 'Subscribe · $4.99 / month'} <ArrowUpRight size={14} /></button></div><span className={`coming-pill ${isPlus ? 'active-pill' : ''}`}><span />{isPlus ? 'PLUS ACTIVE' : 'SECURE CHECKOUT'}</span></div><div className="store-section-head"><div><h2>Focus rewards</h2><p>Cosmetic fun and tiny study breaks. Your real scores stay yours.</p></div><span className="product-count">{products.length} ITEMS</span></div>{products.length ? <div className="product-grid">{products.map((product) => { const owned = ownedProducts.includes(product.id); return <article className="product-card" key={product.id}><div className={`product-art product-${product.category}`}><span>{product.emoji}</span><span className="product-spark">✦</span></div><div className="product-card-body"><div className="product-category">{product.category}</div><h3>{product.name}</h3><p>{product.description}</p><button className={`buy-button ${owned ? 'owned-button' : ''}`} disabled={busy || owned || coins < product.coin_cost} onClick={() => onBuy(product.id)}>{owned ? <><Check size={15} />In your collection</> : <><Coins size={15} />{product.coin_cost} coins <span>·</span> Get it</>}</button>{!owned && coins < product.coin_cost && <small className="not-enough">{product.coin_cost - coins} more coins needed</small>}</div></article> })}</div> : <div className="empty-state store-empty"><Gift size={23} /><b>The store is getting set up.</b><span>Apply the project database migration to load the items.</span></div>}<div className="store-note"><ShieldCheck size={16} />Purchases use Stripe Checkout. Coin items never cost real money.</div></>
}

function AccountModal({ username, setUsername, onSave, onClose, onSignOut, busy }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="modal-close icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button><div className="avatar account-avatar">{initials(username)}</div><span className="eyebrow">YOUR STUDY IDENTITY</span><h2 id="account-title">Account settings</h2><p>Your email and password are securely managed by Supabase Auth.</p><form className="account-form" onSubmit={onSave}><label htmlFor="account-username">USERNAME</label><div className="input-wrap account-input"><Users size={16} /><input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" required /></div><button className="primary-button" disabled={busy}>Save username <Check size={16} /></button></form><button className="signout-button" onClick={onSignOut}><LogOut size={16} />Sign out</button></section></div>
}

export default App
