// ============================================================
// 02 — Sign In / Sign Up (Portal)
// Surface: WHITE PORTAL (right) + dark accent panel (left)
// 1280×860. Showing Sign-In default state with Google SSO.
// ============================================================

const Screen02_Auth = () => {
  return (
    <div className="surface-portal" style={s02.root}>
      {/* ===== Left brand panel ===== */}
      <aside style={s02.left}>
        <div style={s02.leftPattern} aria-hidden="true">
          {/* subtle grid lines */}
          <svg width="100%" height="100%" style={{position:'absolute', inset:0, opacity:0.12}}>
            <defs>
              <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)"/>
          </svg>
          {/* radial fade */}
          <div style={s02.glow}/>
        </div>

        <div style={s02.leftHead}>
          <span style={{color:'#fff', display:'inline-flex'}}><Logo size={28}/></span>
          <span style={s02.leftHeadText}>Acme Corp <span style={{opacity:0.55, fontWeight:500}}>Support</span></span>
        </div>

        <div style={s02.leftCopy}>
          <div style={s02.leftEyebrow}>Customer support</div>
          <h2 style={s02.leftH}>Support<br/>that actually<br/>works.</h2>
          <p style={s02.leftP}>
            Create a ticket in seconds, track every reply in one place, and get
            answers from a team that knows your stack.
          </p>

          <ul style={s02.leftList}>
            {[
              'Email updates on every reply',
              'Track all of your tickets in one place',
              'Fast, human support — usually under 2 hours',
            ].map(t => (
              <li key={t} style={s02.leftItem}>
                <span style={s02.leftCheck}><Check size={12} stroke={2.5}/></span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={s02.leftFoot}>
          <div style={s02.quote}>
            "First support tool that doesn't feel like a 2010 helpdesk."
          </div>
          <div style={s02.quoter}>
            <div style={s02.quoterAvatar}>MC</div>
            <div>
              <div style={s02.quoterName}>Mia Chen</div>
              <div style={s02.quoterRole}>Marketing Lead · Northwind</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Right auth form ===== */}
      <main style={s02.right}>
        <div style={s02.formWrap}>
          <div style={s02.toggleRow}>
            <button style={s02.toggleActive}>Sign in</button>
            <button style={s02.toggleInactive}>Create account</button>
          </div>

          <h1 style={s02.h1}>Welcome back</h1>
          <p style={s02.sub}>Sign in to view and reply to your tickets.</p>

          <button style={s02.google}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{flexShrink:0}}>
              <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.13 4.13 0 0 1-1.8 2.71v2.25h2.91c1.7-1.57 2.69-3.88 2.69-6.61z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.47-.81 5.96-2.19l-2.91-2.25c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/>
              <path d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </button>

          <div style={s02.divider}>
            <span style={s02.dividerLine}/>
            <span style={s02.dividerText}>or sign in with email</span>
            <span style={s02.dividerLine}/>
          </div>

          <div style={s02.fld}>
            <label style={s02.lbl}>Email address</label>
            <input style={s02.inp} defaultValue="jordan@acmecorp.com"/>
          </div>

          <div style={s02.fld}>
            <div style={s02.lblRow}>
              <label style={s02.lbl}>Password</label>
              <a style={s02.forgot}>Forgot password?</a>
            </div>
            <div style={s02.pwWrap}>
              <input style={s02.pwInp} type="password" defaultValue="••••••••••"/>
              <button style={s02.pwToggle}><Eye size={16}/></button>
            </div>
          </div>

          <button style={s02.submit}>Sign in</button>

          <p style={s02.swap}>
            Don't have an account? <a style={s02.swapLink}>Sign up</a>
          </p>

          <div style={s02.guest}>
            <p style={s02.guestText}>Just need to submit a ticket?</p>
            <a style={s02.guestLink}>Continue as guest <Arrow size={12} stroke={2.2}/></a>
          </div>
        </div>

        <footer style={s02.legalRow}>
          <span>© 2025 Acme Corp</span>
          <span style={s02.legalSep}>·</span>
          <a style={s02.legalLink}>Privacy</a>
          <a style={s02.legalLink}>Terms</a>
          <span style={s02.poweredBy}>Powered by <strong>TMR Support</strong></span>
        </footer>
      </main>
    </div>
  );
};

const s02 = {
  root: {
    width:'100%', height:'100%', display:'flex', overflow:'hidden',
    background:'#FFFFFF',
  },
  /* ---- Left ---- */
  left: {
    flex:'0 0 58%', background:'#0A0A0A', color:'#fff',
    padding:'48px 56px', display:'flex', flexDirection:'column',
    position:'relative', overflow:'hidden',
  },
  leftPattern: { position:'absolute', inset:0, pointerEvents:'none' },
  glow: {
    position:'absolute', top:'-20%', left:'-10%', width:'70%', height:'70%',
    background:'radial-gradient(circle at center, rgba(59,130,246,0.35), transparent 60%)',
    filter:'blur(40px)',
  },
  leftHead: { display:'flex', alignItems:'center', gap:10, position:'relative', zIndex:1 },
  leftHeadText: { fontSize:15, fontWeight:600 },

  leftCopy: { marginTop:96, position:'relative', zIndex:1 },
  leftEyebrow: {
    fontSize:11, fontWeight:600, color:'#A1A1AA', letterSpacing:'0.08em',
    textTransform:'uppercase', marginBottom:20,
  },
  leftH: {
    fontFamily:'var(--font-display)', fontSize:56, fontWeight:600,
    lineHeight:1.0, letterSpacing:'-0.03em', margin:0,
  },
  leftP: {
    marginTop:24, fontSize:16, lineHeight:1.6, color:'#A1A1AA',
    maxWidth:420, margin:'24px 0 0',
  },
  leftList: { listStyle:'none', padding:0, margin:'40px 0 0', display:'flex', flexDirection:'column', gap:14 },
  leftItem: { display:'flex', alignItems:'center', gap:12, fontSize:14, color:'#D4D4D8' },
  leftCheck: {
    width:20, height:20, borderRadius:999, background:'rgba(59,130,246,0.20)',
    color:'#60A5FA', display:'flex', alignItems:'center', justifyContent:'center',
    border:'1px solid rgba(59,130,246,0.35)',
  },

  leftFoot: { marginTop:'auto', paddingTop:32, borderTop:'1px solid rgba(255,255,255,0.10)', position:'relative', zIndex:1 },
  quote: { fontSize:15, color:'#E4E4E7', lineHeight:1.5, marginBottom:14, maxWidth:420 },
  quoter: { display:'flex', alignItems:'center', gap:10 },
  quoterAvatar: {
    width:32, height:32, borderRadius:999, background:'#A78BFA',
    display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600, color:'#1B0B2A',
  },
  quoterName: { fontSize:13, fontWeight:600 },
  quoterRole: { fontSize:12, color:'#71717A', marginTop:1 },

  /* ---- Right ---- */
  right: {
    flex:1, padding:'48px 56px', display:'flex', flexDirection:'column',
  },
  formWrap: { width:'100%', maxWidth:360, margin:'auto', display:'flex', flexDirection:'column' },

  toggleRow: {
    display:'inline-flex', padding:3, background:'var(--p-surface)',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-md)', alignSelf:'flex-start',
    marginBottom:32,
  },
  toggleActive: {
    padding:'6px 14px', fontSize:13, fontWeight:500,
    background:'#fff', color:'var(--p-text)', borderRadius:'var(--r-sm)',
    boxShadow:'0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--p-border-2)',
  },
  toggleInactive: {
    padding:'6px 14px', fontSize:13, fontWeight:500, color:'var(--p-text-3)',
  },

  h1: { fontFamily:'var(--font-display)', fontSize:32, fontWeight:600, letterSpacing:'-0.02em', margin:0, lineHeight:1.1 },
  sub: { fontSize:14, color:'var(--p-text-3)', marginTop:8, marginBottom:24, lineHeight:1.5 },

  google: {
    width:'100%', height:44,
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)', background:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    fontSize:14, fontWeight:500, color:'var(--p-text)',
  },

  divider: {
    display:'flex', alignItems:'center', gap:12, margin:'20px 0',
  },
  dividerLine: { flex:1, height:1, background:'var(--p-border)' },
  dividerText: { fontSize:12, color:'var(--p-text-4)' },

  fld: { marginBottom:14 },
  lbl: { display:'block', fontSize:13, fontWeight:500, marginBottom:6, color:'var(--p-text)' },
  lblRow: { display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 },
  forgot: { fontSize:12, color:'var(--p-accent)', fontWeight:500, cursor:'pointer' },
  inp: {
    width:'100%', height:40, padding:'0 14px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontFamily:'inherit', fontSize:14, outline:'none', background:'#fff',
  },
  pwWrap: { position:'relative' },
  pwInp: {
    width:'100%', height:40, padding:'0 40px 0 14px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontFamily:'inherit', fontSize:14, outline:'none', background:'#fff',
    color:'var(--p-text)',
  },
  pwToggle: {
    position:'absolute', right:8, top:8, width:24, height:24, borderRadius:4,
    color:'var(--p-text-4)', display:'flex', alignItems:'center', justifyContent:'center',
  },

  submit: {
    width:'100%', height:44, marginTop:18,
    background:'var(--p-accent)', color:'#fff',
    borderRadius:'var(--r-sm)', fontWeight:600, fontSize:14, cursor:'pointer',
  },

  swap: { textAlign:'center', fontSize:13, color:'var(--p-text-3)', marginTop:20, marginBottom:0 },
  swapLink: { color:'var(--p-accent)', fontWeight:500, cursor:'pointer' },

  guest: {
    marginTop:28, padding:'16px 18px', background:'var(--p-surface)',
    border:'1px solid var(--p-border-2)', borderRadius:'var(--r-md)',
    display:'flex', alignItems:'center', justifyContent:'space-between',
  },
  guestText: { fontSize:13, color:'var(--p-text-2)', margin:0 },
  guestLink: { fontSize:13, color:'var(--p-accent)', fontWeight:500, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4 },

  legalRow: {
    display:'flex', alignItems:'center', gap:10, marginTop:24,
    fontSize:12, color:'var(--p-text-4)', justifyContent:'center',
  },
  legalSep: { color:'var(--p-text-4)' },
  legalLink: { color:'var(--p-text-3)', cursor:'pointer' },
  poweredBy: { marginLeft:'auto', color:'var(--p-text-4)' },
};

window.Screen02_Auth = Screen02_Auth;
