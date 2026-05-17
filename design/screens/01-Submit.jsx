// ============================================================
// 01 — Submit a Ticket (Portal Landing)
// Surface: WHITE PORTAL. 1280×1080.
// Default state: logged-in user (per brief). Form is the hero.
// ============================================================

const Screen01_Submit = () => {
  const cats = [
    { key: 'bug',   label: 'Bug Report',      icon: <Bug size={18}/>,      active: true },
    { key: 'feat',  label: 'Feature Request', icon: <Sparkles size={18}/> },
    { key: 'q',     label: 'Question',        icon: <Help size={18}/> },
    { key: 'bill',  label: 'Billing',         icon: <Card size={18}/> },
    { key: 'other', label: 'Other',           icon: <Folder size={18}/> },
  ];

  return (
    <div className="surface-portal" style={s01.root}>
      {/* ===== Nav ===== */}
      <header style={s01.nav}>
        <div style={s01.navLeft}>
          <span style={s01.brandMark}><Logo size={26}/></span>
          <span style={s01.brandText}>Acme Corp <span style={s01.brandTextMuted}>Support</span></span>
        </div>
        <nav style={s01.navRight}>
          <a style={s01.navLink}>My Tickets</a>
          <div style={s01.avatar}>JC</div>
        </nav>
      </header>

      {/* ===== Body ===== */}
      <main style={s01.main}>
        <div style={s01.intro}>
          <h1 style={s01.h1}>How can we help?</h1>
          <p style={s01.lede}>
            Describe your issue and we'll get back to you as soon as possible.
            Most tickets get a first response in under 2 hours.
          </p>
        </div>

        {/* Category selector */}
        <div style={s01.fieldGroup}>
          <label style={s01.label}>Issue category</label>
          <div style={s01.catGrid} role="radiogroup">
            {cats.map(c => (
              <button
                key={c.key}
                role="radio"
                aria-checked={!!c.active}
                style={c.active ? s01.catActive : s01.cat}
              >
                <span style={c.active ? s01.catIconActive : s01.catIcon}>{c.icon}</span>
                <span style={c.active ? s01.catLabelActive : s01.catLabel}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div style={s01.fieldGroup}>
          <div style={s01.labelRow}>
            <label style={s01.label}>Title</label>
            <span style={s01.counter}>62 / 120</span>
          </div>
          <input
            style={s01.input}
            defaultValue="GA4 connector failing to sync after May 12 update"
            placeholder="Briefly describe your issue."
          />
        </div>

        {/* Destination + Connector (revealed after category) */}
        <div style={s01.fieldRow}>
          <div style={{...s01.fieldGroup, flex:1, marginBottom:0}}>
            <label style={s01.label}>Which product are you using?</label>
            <button style={s01.select}>
              <span>Google Sheets</span>
              <Chevron size={16}/>
            </button>
          </div>
          <div style={{...s01.fieldGroup, flex:1, marginBottom:0}}>
            <label style={s01.label}>Connector <span style={s01.optional}>(optional)</span></label>
            <div style={s01.inputWrap}>
              <Search size={16} style={s01.inputIcon}/>
              <input style={s01.inputWithIcon} defaultValue="GA4 — Google Analytics" placeholder="Search connectors..."/>
            </div>
          </div>
        </div>

        {/* Description */}
        <div style={s01.fieldGroup}>
          <label style={s01.label}>Description <span style={s01.optional}>(optional)</span></label>
          <div style={s01.taWrap}>
            <textarea
              style={s01.textarea}
              defaultValue={"After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way. The sheet is partially populated then the run errors out with 'rate limit exceeded' even on small accounts.\n\nReproducing it consistently with the attached report."}
            />
            <div style={s01.taFoot}>
              <div style={s01.taTools}>
                <button style={s01.taTool} aria-label="Bold"><Bold size={14}/></button>
                <button style={s01.taTool} aria-label="Italic"><Italic size={14}/></button>
                <button style={s01.taTool} aria-label="Code"><Code size={14}/></button>
                <span style={s01.taSep}/>
                <button style={s01.taTool} aria-label="Link"><Link size={14}/></button>
                <button style={s01.taTool} aria-label="List"><ListIcon size={14}/></button>
              </div>
              <span style={s01.taHint}>Markdown supported</span>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div style={s01.fieldGroup}>
          <label style={s01.label}>Attachments <span style={s01.optional}>(optional)</span></label>
          <div style={s01.dropzone}>
            <div style={s01.dropzoneIcon}><Upload size={22}/></div>
            <div style={s01.dropzoneText}>
              <strong style={s01.dropzoneStrong}>Drag files here</strong>, or <span style={s01.dropzoneLink}>click to browse</span>
            </div>
            <div style={s01.dropzoneSub}>Supports images, PDFs, and links · Max 10MB each</div>
          </div>
          <div style={s01.chips}>
            <div style={s01.chip}>
              <span style={s01.chipDot}/>
              <span style={s01.chipName}>error-log-2025-05-13.txt</span>
              <span style={s01.chipSize}>14 KB</span>
              <button style={s01.chipX}><X size={12}/></button>
            </div>
            <div style={s01.chip}>
              <span style={s01.chipDot}/>
              <span style={s01.chipName}>ga4-sheets-screenshot.png</span>
              <span style={s01.chipSize}>284 KB</span>
              <button style={s01.chipX}><X size={12}/></button>
            </div>
          </div>
          <div style={s01.linkInputWrap}>
            <Link size={14} style={{color:'var(--p-text-4)', flexShrink:0}}/>
            <input style={s01.linkInput} placeholder="Or paste a link (Loom, Sheets, Data Studio...)"/>
          </div>
        </div>

        {/* Submit */}
        <button style={s01.submit}>Submit ticket</button>
        <p style={s01.footnote}>
          By submitting you'll receive replies at <strong style={{color:'var(--p-text)'}}>jordan@acmecorp.com</strong>.
          You can also reply directly from your inbox.
        </p>
      </main>
    </div>
  );
};

const s01 = {
  root: {
    width: '100%', height: '100%', overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    background: 'var(--p-bg)',
  },
  nav: {
    height: 64, padding: '0 40px', borderBottom: '1px solid var(--p-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'rgba(255,255,255,0.85)', backdropFilter: 'saturate(180%) blur(8px)',
  },
  navLeft: { display:'flex', alignItems:'center', gap:10 },
  brandMark: { color:'#09090B', display:'inline-flex' },
  brandText: { fontSize:15, fontWeight:600, letterSpacing:'-0.01em' },
  brandTextMuted: { color:'var(--p-text-3)', fontWeight:500, marginLeft:4 },
  navRight: { display:'flex', alignItems:'center', gap:24 },
  navLink: { fontSize:14, fontWeight:500, color:'var(--p-text-2)', cursor:'pointer' },
  avatar: {
    width:32, height:32, borderRadius:999, background:'var(--p-accent)',
    color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:12, fontWeight:600, letterSpacing:'0.02em',
  },

  main: {
    flex:1, padding:'56px 40px 80px',
    width: 720, margin:'0 auto', maxWidth:720,
    overflowY:'auto',
  },
  intro: { marginBottom: 40 },
  h1: { fontSize:40, fontWeight:700, letterSpacing:'-0.025em', lineHeight:1.1, margin:0, fontFamily:'var(--font-display)' },
  lede: { fontSize:15, lineHeight:1.6, color:'var(--p-text-3)', marginTop:12, marginBottom:0, maxWidth:560 },

  fieldGroup: { marginBottom: 28 },
  fieldRow: { display:'flex', gap:16, marginBottom:28 },
  labelRow: { display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 },
  label: { display:'block', fontSize:13, fontWeight:500, color:'var(--p-text)', marginBottom:8 },
  optional: { color:'var(--p-text-4)', fontWeight:400 },
  counter: { fontSize:12, color:'var(--p-text-4)', fontVariantNumeric:'tabular-nums' },

  catGrid: { display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:8 },
  cat: {
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8,
    padding:'16px 8px', minHeight:84,
    border:'1px solid var(--p-border)', borderRadius:'var(--r-md)',
    background:'#fff', textAlign:'center', transition:'all 120ms',
  },
  catActive: {
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8,
    padding:'16px 8px', minHeight:84,
    border:'1.5px solid var(--p-accent)', borderRadius:'var(--r-md)',
    background:'var(--p-accent-bg)', textAlign:'center',
    boxShadow:'0 0 0 3px rgba(37,99,235,0.08)',
  },
  catIcon: {
    width:32, height:32, borderRadius:'var(--r-sm)',
    background:'var(--p-surface)', color:'var(--p-text-2)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  catIconActive: {
    width:32, height:32, borderRadius:'var(--r-sm)',
    background:'#fff', color:'var(--p-accent)',
    display:'flex', alignItems:'center', justifyContent:'center',
    boxShadow:'0 1px 2px rgba(37,99,235,0.18), 0 0 0 1px rgba(37,99,235,0.20)',
  },
  catLabel: { fontSize:13, fontWeight:500, color:'var(--p-text)', lineHeight:1.25, textWrap:'balance' },
  catLabelActive: { fontSize:13, fontWeight:600, color:'var(--p-accent-hv)', lineHeight:1.25, textWrap:'balance' },

  input: {
    width:'100%', height:40, padding:'0 14px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontFamily:'inherit', fontSize:14, color:'var(--p-text)',
    background:'#fff', outline:'none',
  },
  inputWrap: { position:'relative' },
  inputIcon: { position:'absolute', left:12, top:12, color:'var(--p-text-4)' },
  inputWithIcon: {
    width:'100%', height:40, padding:'0 14px 0 36px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontFamily:'inherit', fontSize:14, color:'var(--p-text)',
    background:'#fff', outline:'none',
  },
  select: {
    width:'100%', height:40, padding:'0 14px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontFamily:'inherit', fontSize:14, color:'var(--p-text)', background:'#fff',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    textAlign:'left',
  },
  textarea: {
    width:'100%', minHeight:140, padding:'12px 14px',
    border:'none', outline:'none', resize:'vertical',
    fontFamily:'inherit', fontSize:14, lineHeight:1.55, color:'var(--p-text)',
    background:'transparent', display:'block',
  },
  taWrap: {
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    background:'#fff', overflow:'hidden',
  },
  taFoot: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'6px 8px 6px 6px', borderTop:'1px solid var(--p-border-2)',
    background:'var(--p-surface-2)',
  },
  taTools: { display:'flex', alignItems:'center', gap:2 },
  taTool: {
    width:26, height:26, borderRadius:'var(--r-xs)',
    color:'var(--p-text-3)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  taSep: { width:1, height:14, background:'var(--p-border)', margin:'0 4px' },
  taHint: { fontSize:11, color:'var(--p-text-4)', paddingRight:6 },

  dropzone: {
    border:'1.5px dashed var(--p-border)', borderRadius:'var(--r-md)',
    padding:'28px 20px', textAlign:'center', background:'var(--p-surface-2)',
    display:'flex', flexDirection:'column', alignItems:'center', gap:8,
  },
  dropzoneIcon: {
    width:40, height:40, borderRadius:999, background:'#fff',
    border:'1px solid var(--p-border)', display:'flex', alignItems:'center', justifyContent:'center',
    color:'var(--p-text-3)',
  },
  dropzoneText: { fontSize:14, color:'var(--p-text-2)' },
  dropzoneStrong: { color:'var(--p-text)', fontWeight:600 },
  dropzoneLink: { color:'var(--p-accent)', fontWeight:500, cursor:'pointer' },
  dropzoneSub: { fontSize:12, color:'var(--p-text-4)' },

  chips: { display:'flex', flexWrap:'wrap', gap:8, marginTop:10 },
  chip: {
    display:'inline-flex', alignItems:'center', gap:8, padding:'6px 8px 6px 10px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)', background:'#fff',
  },
  chipDot: { width:6, height:6, borderRadius:999, background:'var(--p-success)' },
  chipName: { fontSize:12, fontWeight:500, color:'var(--p-text)' },
  chipSize: { fontSize:11, color:'var(--p-text-4)', fontVariantNumeric:'tabular-nums' },
  chipX: {
    width:18, height:18, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center',
    color:'var(--p-text-4)', background:'var(--p-surface)',
  },

  linkInputWrap: {
    marginTop:10, display:'flex', alignItems:'center', gap:8,
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)', padding:'0 12px', height:36, background:'#fff',
  },
  linkInput: {
    flex:1, height:34, border:'none', outline:'none', fontFamily:'inherit',
    fontSize:13, color:'var(--p-text)', background:'transparent',
  },

  submit: {
    width:'100%', height:44, marginTop:8,
    background:'var(--p-accent)', color:'#fff',
    borderRadius:'var(--r-sm)', fontWeight:600, fontSize:14,
    letterSpacing:'-0.005em', cursor:'pointer',
  },
  footnote: { fontSize:12, color:'var(--p-text-4)', textAlign:'center', marginTop:14, lineHeight:1.5 },
};

window.Screen01_Submit = Screen01_Submit;
