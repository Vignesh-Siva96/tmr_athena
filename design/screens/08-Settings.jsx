// ============================================================
// 08 — Org Settings · Brand Customization
// Surface: DARK. 1440×980.
// Three columns: dash sidebar + settings nav + form & live preview.
// ============================================================

const Screen08_Settings = () => {
  return (
    <div className="surface-dashboard" style={s08.root}>
      <DashSidebar view="all"/>

      {/* Settings nav */}
      <aside style={s08.settingsNav}>
        <div style={s08.settingsHead}>
          <a style={s08.settingsBack}><ArrowLeft size={12}/> Back to workspace</a>
          <div style={s08.settingsTitle}>Settings</div>
          <div style={s08.settingsSub}>Acme Corp workspace</div>
        </div>

        <div style={s08.navGroup}>
          <div style={s08.navGroupLabel}>Workspace</div>
          <SettingsItem icon={<Globe size={14}/>}     label="General"      />
          <SettingsItem icon={<Palette size={14}/>}   label="Branding"     active/>
          <SettingsItem icon={<Users size={14}/>}     label="Agents"        meta="6"/>
          <SettingsItem icon={<Bell size={14}/>}      label="Notifications"/>
        </div>

        <div style={s08.navGroup}>
          <div style={s08.navGroupLabel}>Integrations</div>
          <SettingsItem icon={<Github size={14}/>}    label="GitHub"        meta={<span style={s08.connected}>Connected</span>}/>
          <SettingsItem icon={<Mail size={14}/>}      label="Email forwarding"/>
          <SettingsItem icon={<Card size={14}/>}      label="Billing"       disabled meta={<span style={s08.soon}>Soon</span>}/>
        </div>
      </aside>

      {/* Main content */}
      <main style={s08.main}>
        <header style={s08.mainHead}>
          <div>
            <h1 style={s08.h1}>Branding</h1>
            <p style={s08.sub}>How your support portal looks to customers. Changes update the portal in real time.</p>
          </div>
          <div style={s08.savedRow}>
            <span style={s08.savedDot}/>
            <span style={s08.savedText}>Auto-saved <span style={{color:'var(--d-text-4)'}}>2s ago</span></span>
          </div>
        </header>

        <div style={s08.grid}>
          {/* ===== Form column ===== */}
          <section style={s08.form}>
            {/* Identity card */}
            <Card08 title="Identity" desc="Your organisation's name and logo as shown across the customer portal.">
              <Field08 label="Organisation name">
                <input style={s08.input} defaultValue="Acme Corp"/>
              </Field08>

              <Field08 label="Portal tagline" optional helper="Shown below the logo on the portal landing page.">
                <input style={s08.input} defaultValue="Support that actually works."/>
                <div style={s08.counter}>27 / 80</div>
              </Field08>

              <Field08 label="Logo">
                <div style={s08.logoRow}>
                  <div style={s08.logoPreview}>
                    <Logo size={36}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={s08.dropzone}>
                      <Upload size={16} style={{color:'var(--d-text-3)'}}/>
                      <span style={s08.dropzoneText}>Drop a logo or <span style={s08.linkInline}>browse</span></span>
                      <span style={s08.dropzoneSub}>PNG or SVG · Max 2MB · Square recommended</span>
                    </div>
                  </div>
                  <button style={s08.removeBtn}>Remove</button>
                </div>
              </Field08>
            </Card08>

            {/* Colours card */}
            <Card08 title="Colours" desc="Used for buttons, links and the brand panel of the sign-in page.">
              <div style={s08.colorGrid}>
                <ColorField08 label="Primary"  hex="#2563EB" name="Royal Blue"/>
                <ColorField08 label="Accent"   hex="#0EA5E9" name="Sky"/>
                <ColorField08 label="Surface"  hex="#FFFFFF" name="White"/>
              </div>
              <div style={s08.contrastRow}>
                <Check size={13} style={{color:'#22C55E'}}/>
                <span style={s08.contrastText}>Contrast ratio <strong style={{color:'#FAFAFA'}}>7.4 : 1</strong> · meets WCAG AAA on white surface</span>
              </div>
            </Card08>

            {/* Email card */}
            <Card08 title="Email" desc="How outbound replies appear in your customer's inbox.">
              <Field08 label="Display name">
                <input style={s08.input} defaultValue="Acme Corp Support"/>
              </Field08>
              <Field08 label="Reply-from address">
                <div style={s08.inputAddon}>
                  <input style={s08.inputInner} defaultValue="support"/>
                  <span style={s08.inputSuffix}>@acmecorp.com</span>
                </div>
              </Field08>
            </Card08>

            {/* Domain card */}
            <Card08 title="Custom domain" desc="Host your portal on your own subdomain." badge="Coming in Phase 2">
              <Field08 label="Portal URL">
                <div style={s08.inputAddon}>
                  <span style={s08.inputPrefix}>https://</span>
                  <input style={s08.inputInner} defaultValue="support.acmecorp.com" disabled/>
                </div>
              </Field08>
              <div style={s08.dnsBox}>
                <div style={s08.dnsTitle}>DNS instructions</div>
                <div style={s08.dnsRow}>
                  <span className="mono" style={s08.dnsType}>CNAME</span>
                  <span className="mono" style={s08.dnsHost}>support</span>
                  <span className="mono" style={s08.dnsTarget}>portal.tworeport.com</span>
                </div>
              </div>
            </Card08>
          </section>

          {/* ===== Preview column ===== */}
          <aside style={s08.previewWrap}>
            <div style={s08.previewHead}>
              <div style={s08.sectionLabel}>Portal preview</div>
              <div style={s08.previewTabs}>
                <button style={s08.previewTabActive}>Desktop</button>
                <button style={s08.previewTab}>Mobile</button>
              </div>
            </div>

            <div style={s08.browserFrame}>
              {/* fake browser chrome */}
              <div style={s08.browserBar}>
                <div style={s08.browserDots}>
                  <span style={{...s08.bDot, background:'#3F3F46'}}/>
                  <span style={{...s08.bDot, background:'#3F3F46'}}/>
                  <span style={{...s08.bDot, background:'#3F3F46'}}/>
                </div>
                <div style={s08.urlBar}>
                  <Lock size={10} style={{color:'#71717A'}}/>
                  <span style={s08.url}>support.acmecorp.com</span>
                </div>
                <div style={{width:60}}/>
              </div>

              {/* Embedded portal — light surface, downscaled */}
              <div style={s08.previewScale}>
                <div style={s08.preview}>
                  <header style={s08.pNav}>
                    <span style={{display:'inline-flex', color:'#09090B'}}><Logo size={20}/></span>
                    <span style={s08.pBrandText}>Acme Corp <span style={{color:'#71717A'}}>Support</span></span>
                    <div style={{marginLeft:'auto', display:'flex', gap:14, alignItems:'center'}}>
                      <span style={{fontSize:11, color:'#71717A'}}>My Tickets</span>
                      <span style={s08.pAvatar}>JC</span>
                    </div>
                  </header>
                  <div style={s08.pBody}>
                    <h2 style={s08.pH}>How can we help?</h2>
                    <p style={s08.pP}>Support that actually works.</p>
                    <div style={s08.pCats}>
                      <div style={s08.pCatActive}>
                        <Bug size={14} style={{color:'#2563EB'}}/>
                        <span>Bug Report</span>
                      </div>
                      <div style={s08.pCat}>
                        <Sparkles size={14} style={{color:'#71717A'}}/>
                        <span>Feature</span>
                      </div>
                      <div style={s08.pCat}>
                        <Help size={14} style={{color:'#71717A'}}/>
                        <span>Question</span>
                      </div>
                      <div style={s08.pCat}>
                        <Card size={14} style={{color:'#71717A'}}/>
                        <span>Billing</span>
                      </div>
                    </div>
                    <div style={s08.pInput}/>
                    <div style={s08.pTextarea}/>
                    <div style={s08.pBtn}>Submit ticket</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={s08.previewFoot}>
              <a style={s08.previewLink}>Open live portal <Arrow size={11}/></a>
              <a style={s08.previewLink}>Send preview to email</a>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

const SettingsItem = ({ icon, label, active, meta, disabled }) => (
  <a style={{
    display:'flex', alignItems:'center', gap:10,
    padding:'7px 10px', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight: active ? 600 : 500,
    color: disabled ? 'var(--d-text-4)' : (active ? '#FAFAFA' : 'var(--d-text-2)'),
    background: active ? 'rgba(59,130,246,0.10)' : 'transparent',
    position:'relative', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }}>
    {active && <span style={{position:'absolute', left:-12, top:6, bottom:6, width:2, borderRadius:2, background:'var(--d-accent)'}}/>}
    <span style={{color: active ? 'var(--d-accent)' : 'var(--d-text-3)', display:'inline-flex'}}>{icon}</span>
    <span>{label}</span>
    {meta && <span style={{marginLeft:'auto'}}>{meta}</span>}
  </a>
);

const Card08 = ({ title, desc, badge, children }) => (
  <section style={{
    background:'var(--d-surface)', border:'1px solid var(--d-border)',
    borderRadius:'var(--r-lg)', overflow:'hidden',
  }}>
    <div style={{ padding:'18px 22px 14px', borderBottom:'1px solid var(--d-border-2)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'#FAFAFA', margin:0, letterSpacing:'-0.01em' }}>{title}</h3>
        {badge && <span style={{ fontSize:10, fontWeight:600, color:'#FCD34D', background:'rgba(245,158,11,0.15)', padding:'2px 8px', borderRadius:999, letterSpacing:'0.02em' }}>{badge}</span>}
      </div>
      {desc && <p style={{ margin:'6px 0 0', fontSize:12, color:'var(--d-text-3)', lineHeight:1.5 }}>{desc}</p>}
    </div>
    <div style={{ padding:'18px 22px' }}>
      {children}
    </div>
  </section>
);

const Field08 = ({ label, optional, helper, children }) => (
  <div style={{ marginBottom:18 }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
      <label style={{ fontSize:12, fontWeight:500, color:'var(--d-text-2)' }}>
        {label}
        {optional && <span style={{ color:'var(--d-text-4)', fontWeight:400, marginLeft:6 }}>· optional</span>}
      </label>
      {helper && <span style={{ fontSize:11, color:'var(--d-text-4)' }}>{helper}</span>}
    </div>
    {children}
  </div>
);

const ColorField08 = ({ label, hex, name }) => (
  <div>
    <div style={{ fontSize:11, fontWeight:500, color:'var(--d-text-3)', marginBottom:6 }}>{label}</div>
    <div style={{
      display:'flex', alignItems:'center', gap:10,
      padding:'8px 10px 8px 8px',
      background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
    }}>
      <span style={{
        width:36, height:36, borderRadius:6, background:hex,
        border:'1px solid rgba(255,255,255,0.10)', flexShrink:0,
      }}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{ fontSize:12, fontWeight:600, color:'#FAFAFA' }}>{name}</div>
        <div className="mono" style={{ fontSize:11, color:'var(--d-text-3)', marginTop:2 }}>{hex}</div>
      </div>
      <button style={{ width:22, height:22, borderRadius:4, color:'var(--d-text-4)', display:'flex', alignItems:'center', justifyContent:'center' }}><Copy size={11}/></button>
    </div>
  </div>
);

const s08 = {
  root: { width:'100%', height:'100%', display:'flex', overflow:'hidden', background:'var(--d-bg)' },

  /* Settings nav */
  settingsNav: { width:240, flexShrink:0, background:'#0D0D0F', borderRight:'1px solid var(--d-border)', padding:'16px 12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:18 },
  settingsHead: { padding:'2px 4px' },
  settingsBack: { fontSize:11, color:'var(--d-text-3)', fontWeight:500, display:'inline-flex', alignItems:'center', gap:4, marginBottom:14 },
  settingsTitle: { fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, color:'#FAFAFA', letterSpacing:'-0.01em' },
  settingsSub: { fontSize:11, color:'var(--d-text-4)', marginTop:2 },

  navGroup: { display:'flex', flexDirection:'column', gap:2 },
  navGroupLabel: { fontSize:10, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em', padding:'6px 10px 4px' },
  connected: { fontSize:10, fontWeight:600, color:'#86EFAC', background:'rgba(34,197,94,0.14)', padding:'2px 6px', borderRadius:3, display:'inline-flex', alignItems:'center', gap:3 },
  soon: { fontSize:10, fontWeight:500, color:'var(--d-text-4)', padding:'2px 6px', borderRadius:3, background:'var(--d-raised)' },

  /* Main */
  main: { flex:1, padding:'32px 36px 40px', overflowY:'auto', display:'flex', flexDirection:'column' },
  mainHead: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 },
  h1: { fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'#FAFAFA', margin:0, letterSpacing:'-0.02em' },
  sub: { fontSize:13, color:'var(--d-text-3)', margin:'6px 0 0', maxWidth:520 },
  savedRow: { display:'flex', alignItems:'center', gap:8 },
  savedDot: { width:7, height:7, borderRadius:999, background:'#22C55E', boxShadow:'0 0 0 3px rgba(34,197,94,0.20)' },
  savedText: { fontSize:12, color:'var(--d-text-2)', fontWeight:500 },

  grid: { display:'grid', gridTemplateColumns:'minmax(0, 1fr) 420px', gap:24, alignItems:'flex-start' },

  /* Form */
  form: { display:'flex', flexDirection:'column', gap:16 },

  input: {
    width:'100%', height:36, padding:'0 12px',
    background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
    color:'var(--d-text)', fontFamily:'inherit', fontSize:13, outline:'none',
  },
  inputAddon: {
    display:'flex', alignItems:'center',
    height:36, background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
    overflow:'hidden',
  },
  inputPrefix: { fontFamily:'var(--font-mono)', fontSize:12, color:'var(--d-text-4)', padding:'0 10px', borderRight:'1px solid var(--d-border-2)', height:'100%', display:'flex', alignItems:'center' },
  inputSuffix: { fontFamily:'var(--font-mono)', fontSize:12, color:'var(--d-text-3)', padding:'0 10px', borderLeft:'1px solid var(--d-border-2)', height:'100%', display:'flex', alignItems:'center' },
  inputInner: { flex:1, height:'100%', background:'transparent', border:'none', outline:'none', padding:'0 12px', color:'var(--d-text)', fontFamily:'inherit', fontSize:13 },

  counter: { fontSize:11, color:'var(--d-text-4)', marginTop:6, textAlign:'right' },

  logoRow: { display:'flex', alignItems:'center', gap:14 },
  logoPreview: { width:80, height:80, borderRadius:'var(--r-md)', background:'#fff', border:'1px solid var(--d-border)', display:'flex', alignItems:'center', justifyContent:'center', color:'#09090B' },
  dropzone: { display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4, padding:'10px 14px', border:'1px dashed var(--d-border)', borderRadius:'var(--r-sm)', background:'var(--d-raised)' },
  dropzoneText: { fontSize:12, color:'var(--d-text-2)', marginTop:4 },
  linkInline: { color:'var(--d-accent)', fontWeight:500 },
  dropzoneSub: { fontSize:11, color:'var(--d-text-4)' },
  removeBtn: { height:30, padding:'0 12px', fontSize:12, color:'var(--d-text-3)', fontWeight:500, background:'transparent', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)' },

  colorGrid: { display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, marginBottom:16 },
  contrastRow: { display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.20)', borderRadius:'var(--r-sm)' },
  contrastText: { fontSize:12, color:'var(--d-text-2)' },

  dnsBox: { padding:'10px 12px', background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)', marginTop:4 },
  dnsTitle: { fontSize:10, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 },
  dnsRow: { display:'grid', gridTemplateColumns:'70px 90px 1fr', gap:10, alignItems:'center' },
  dnsType: { fontSize:11, color:'#FCD34D', fontWeight:500 },
  dnsHost: { fontSize:11, color:'var(--d-text-2)' },
  dnsTarget: { fontSize:11, color:'var(--d-text-2)' },

  /* Preview */
  previewWrap: { position:'sticky', top:0, display:'flex', flexDirection:'column' },
  previewHead: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  sectionLabel: { fontSize:11, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em' },
  previewTabs: { display:'inline-flex', padding:2, background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)' },
  previewTabActive: { padding:'4px 10px', fontSize:11, fontWeight:500, color:'#FAFAFA', background:'var(--d-raised)', borderRadius:4 },
  previewTab: { padding:'4px 10px', fontSize:11, fontWeight:500, color:'var(--d-text-3)' },

  browserFrame: { background:'#161618', border:'1px solid var(--d-border)', borderRadius:'var(--r-lg)', overflow:'hidden' },
  browserBar: { display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid var(--d-border-2)' },
  browserDots: { display:'flex', gap:5 },
  bDot: { width:9, height:9, borderRadius:999 },
  urlBar: { flex:1, height:24, padding:'0 10px', borderRadius:6, background:'#0A0A0A', border:'1px solid var(--d-border-2)', display:'flex', alignItems:'center', gap:6 },
  url: { fontFamily:'var(--font-mono)', fontSize:11, color:'var(--d-text-2)' },

  /* Embedded portal preview (white surface, scaled feel) */
  previewScale: { background:'#FFFFFF', minHeight:480 },
  preview: { padding:0, color:'#09090B', fontFamily:'var(--font-body)' },
  pNav: { display:'flex', alignItems:'center', gap:8, padding:'12px 16px', borderBottom:'1px solid #E4E4E7' },
  pBrandText: { fontSize:12, fontWeight:600 },
  pAvatar: { width:24, height:24, borderRadius:999, background:'#2563EB', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:600 },

  pBody: { padding:'32px 24px' },
  pH: { fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, letterSpacing:'-0.02em', margin:0, color:'#09090B' },
  pP: { fontSize:12, color:'#71717A', margin:'4px 0 18px' },
  pCats: { display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6, marginBottom:14 },
  pCat: { display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4, padding:'10px 8px', border:'1px solid #E4E4E7', borderRadius:6, fontSize:11, color:'#09090B' },
  pCatActive: { display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4, padding:'10px 8px', border:'1.5px solid #2563EB', borderRadius:6, fontSize:11, fontWeight:600, color:'#1D4ED8', background:'#EFF4FE' },
  pInput: { height:34, background:'#F7F7F8', border:'1px solid #E4E4E7', borderRadius:6, marginBottom:8 },
  pTextarea: { height:80, background:'#F7F7F8', border:'1px solid #E4E4E7', borderRadius:6, marginBottom:14 },
  pBtn: { height:36, background:'#2563EB', color:'#fff', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600 },

  previewFoot: { display:'flex', justifyContent:'space-between', marginTop:12 },
  previewLink: { fontSize:11, color:'var(--d-accent)', fontWeight:500, display:'inline-flex', alignItems:'center', gap:4 },
};

window.Screen08_Settings = Screen08_Settings;
