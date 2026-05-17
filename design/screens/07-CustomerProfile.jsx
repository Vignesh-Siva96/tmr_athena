// ============================================================
// 07 — Customer Profile slide-over (Dashboard)
// Surface: DARK. 1440×900. Composite: shows Agent Ticket view
// dimmed behind a 480px slide-over panel on the right.
// ============================================================

const PAST_TICKETS_07 = [
  { id:'TMR-1042', title:'GA4 connector failing to sync after May 12 update',  status:'prog',  statusLabel:'In Progress', date:'May 13', current:true },
  { id:'TMR-0987', title:'Set up scheduled weekly digest by client',           status:'res',   statusLabel:'Resolved', date:'Apr 22' },
  { id:'TMR-0921', title:'Looker Studio data freshness lagging by ~2 hours',   status:'res',   statusLabel:'Resolved', date:'Apr 04' },
  { id:'TMR-0884', title:'Cannot connect Facebook Ads test account',           status:'res',   statusLabel:'Resolved', date:'Mar 18' },
  { id:'TMR-0823', title:'TikTok Ads spend column showing in cents',           status:'res',   statusLabel:'Resolved', date:'Feb 27' },
];

const Screen07_CustomerProfile = () => {
  return (
    <div className="surface-dashboard" style={s07.root}>
      {/* ===== Backdrop: full ticket detail dimmed ===== */}
      <div style={s07.backdrop}>
        <DashSidebar view="inbox"/>

        <main style={s07.center}>
          <header style={s07.header}>
            <div style={s07.headerTop}>
              <a style={s07.back}><ArrowLeft size={13}/> Inbox</a>
              <span style={s07.crumbDot}>/</span>
              <span className="mono" style={s07.headerId}>TMR-1042</span>
            </div>
            <h1 style={s07.h1}>GA4 connector failing to sync after May 12 update</h1>
            <div style={s07.headerControls}>
              <span className="pill d-prog" style={{padding:'4px 8px'}}><span className="dot"/>In Progress</span>
              <span style={{...s07.tag, background:'rgba(239,68,68,0.14)', color:'#FCA5A5'}}><Flag size={11}/> Urgent</span>
              <span style={s07.tag}>Bug Report</span>
              <span style={s07.tag}>GA4</span>
            </div>
          </header>
          <div style={s07.bodyArea}>
            <div style={s07.bubbleGhost}/>
            <div style={s07.bubbleGhostRight}/>
            <div style={s07.bubbleGhost}/>
          </div>
        </main>

        <aside style={s07.rightStrip}>
          <div style={s07.rightCardGhost}/>
          <div style={{...s07.rightCardGhost, height:120}}/>
        </aside>

        {/* dim overlay */}
        <div style={s07.dim}/>
      </div>

      {/* ===== Slide-over panel ===== */}
      <aside style={s07.panel}>
        {/* Header */}
        <header style={s07.panelHead}>
          <div style={s07.panelHeadTop}>
            <span style={s07.panelEyebrow}>Customer profile</span>
            <div style={{display:'flex', gap:4}}>
              <button style={s07.iconBtn}><Edit size={13}/></button>
              <button style={s07.iconBtn}><X size={14}/></button>
            </div>
          </div>
          <div style={s07.panelIdentity}>
            <div style={s07.bigAvatar}>JC</div>
            <div>
              <div style={s07.bigName}>Jordan Chen</div>
              <div style={s07.bigEmailRow}>
                <span style={s07.bigEmail}>jordan@acmecorp.com</span>
                <button style={s07.iconBtnXs}><Copy size={11}/></button>
              </div>
              <div style={s07.badgeRow}>
                <span style={s07.proBadge}>Pro Plan</span>
                <span style={s07.orgBadge}>Acme Corp</span>
                <span style={s07.dotSep}/>
                <span style={s07.memberSince}>Customer since Jan 2024</span>
              </div>
            </div>
          </div>
        </header>

        {/* Stats */}
        <section style={s07.section}>
          <div style={s07.sectionLabel}>Account overview</div>
          <div style={s07.statGrid}>
            <Stat07 num="12" label="Total tickets"/>
            <Stat07 num="3" label="Open" highlight/>
            <Stat07 num="1.4h" label="Avg reply" subtle/>
            <Stat07 num="9.6/10" label="Satisfaction" success/>
          </div>
          <div style={s07.lastSeen}>
            <span style={s07.lastSeenDot}/>
            <span style={s07.lastSeenText}>Last active 2 hours ago · Hub workspace</span>
          </div>
        </section>

        {/* Ticket history */}
        <section style={s07.section}>
          <div style={s07.sectionHead}>
            <div style={s07.sectionLabel}>Ticket history</div>
            <a style={s07.sectionLink}>Show all 12 →</a>
          </div>
          <div style={s07.historyList}>
            {PAST_TICKETS_07.map(t => (
              <a key={t.id} style={t.current ? s07.historyRowCurrent : s07.historyRow}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={s07.historyTitleRow}>
                    <span className="mono" style={s07.historyId}>{t.id}</span>
                    {t.current && <span style={s07.currentTag}>Current</span>}
                  </div>
                  <div style={s07.historyTitle}>{t.title}</div>
                </div>
                <div style={s07.historyMeta}>
                  <span className={`pill d-${t.status}`} style={{padding:'2px 6px'}}><span className="dot"/>{t.statusLabel}</span>
                  <span style={s07.historyDate}>{t.date}</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Notes */}
        <section style={s07.section}>
          <div style={s07.sectionLabel}>Internal notes</div>

          <div style={s07.note}>
            <div style={s07.noteHead}>
              <div style={{width:24, height:24, borderRadius:999, background:'#A78BFA', color:'#1B0B2A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700}}>SK</div>
              <span style={s07.noteName}>Sarah Kim</span>
              <span style={s07.noteTime}>2 weeks ago</span>
            </div>
            <p style={s07.noteText}>Power user on the GA4 + Sheets path. Prefers technical replies — ok to skip the explainer fluff. Has been on Pro since launch.</p>
          </div>

          <div style={s07.note}>
            <div style={s07.noteHead}>
              <div style={{width:24, height:24, borderRadius:999, background:'#3B82F6', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700}}>DT</div>
              <span style={s07.noteName}>Diego Torres</span>
              <span style={s07.noteTime}>Jan 12, 2025</span>
            </div>
            <p style={s07.noteText}>Account is being evaluated by Acme legal for an enterprise plan upgrade — flag to CS before any pricing conversation.</p>
          </div>

          {/* Add note */}
          <div style={s07.addNote}>
            <textarea style={s07.addNoteInput} placeholder="Add a note about this customer..."/>
            <div style={s07.addNoteFoot}>
              <span style={s07.addNoteHint}>Not visible to customer · Persists across tickets</span>
              <button style={s07.saveNote}>Save note</button>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
};

const Stat07 = ({ num, label, highlight, subtle, success }) => (
  <div style={{
    padding:'12px 14px', borderRadius:'var(--r-md)',
    background: highlight ? 'rgba(245,158,11,0.10)' : 'var(--d-surface)',
    border: highlight ? '1px solid rgba(245,158,11,0.30)' : '1px solid var(--d-border)',
  }}>
    <div style={{
      fontSize:22, fontWeight:600, lineHeight:1.1, letterSpacing:'-0.01em',
      color: highlight ? '#FCD34D' : (success ? '#86EFAC' : (subtle ? 'var(--d-text-2)' : '#FAFAFA')),
      fontVariantNumeric:'tabular-nums', fontFamily:'var(--font-display)',
    }}>{num}</div>
    <div style={{ fontSize:11, color:'var(--d-text-4)', marginTop:4, letterSpacing:'0.02em' }}>{label}</div>
  </div>
);

const s07 = {
  root: { width:'100%', height:'100%', display:'flex', overflow:'hidden', background:'var(--d-bg)', position:'relative' },

  /* Backdrop ticket view */
  backdrop: { position:'absolute', inset:0, display:'flex', filter:'saturate(0.85)' },
  dim: { position:'absolute', inset:0, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(2px)' },

  center: { flex:1, display:'flex', flexDirection:'column', minWidth:0 },
  header: { padding:'14px 24px', borderBottom:'1px solid var(--d-border)' },
  headerTop: { display:'flex', alignItems:'center', gap:8 },
  back: { fontSize:12, color:'var(--d-text-3)', fontWeight:500, display:'inline-flex', alignItems:'center', gap:4 },
  crumbDot: { color:'var(--d-text-4)', fontSize:12 },
  headerId: { fontSize:12, color:'var(--d-text-2)', fontWeight:500 },
  h1: { fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'#FAFAFA', letterSpacing:'-0.015em', margin:'10px 0 0', lineHeight:1.2 },
  headerControls: { display:'flex', alignItems:'center', gap:8, marginTop:14 },
  tag: { display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'4px 8px', borderRadius:4, color:'var(--d-text-3)', background:'var(--d-raised)' },

  bodyArea: { flex:1, padding:24, display:'flex', flexDirection:'column', gap:16 },
  bubbleGhost: { height:90, width:'70%', background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)' },
  bubbleGhostRight: { height:110, width:'65%', background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.20)', borderRadius:'var(--r-md)', alignSelf:'flex-end' },

  rightStrip: { width:320, padding:16, borderLeft:'1px solid var(--d-border)', background:'#0D0D0F', display:'flex', flexDirection:'column', gap:12 },
  rightCardGhost: { height:170, background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)' },

  /* Slide over */
  panel: {
    width:480, marginLeft:'auto', height:'100%', flexShrink:0,
    background:'#0F0F11', borderLeft:'1px solid var(--d-border)',
    boxShadow:'-20px 0 40px rgba(0,0,0,0.5)',
    overflowY:'auto', position:'relative', zIndex:2,
  },
  panelHead: { padding:'18px 22px 20px', borderBottom:'1px solid var(--d-border-2)' },
  panelHeadTop: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 },
  panelEyebrow: { fontSize:11, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600 },
  iconBtn: { width:28, height:28, borderRadius:'var(--r-xs)', color:'var(--d-text-3)', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--d-surface)', border:'1px solid var(--d-border)' },
  iconBtnXs: { width:20, height:20, borderRadius:3, color:'var(--d-text-4)', display:'flex', alignItems:'center', justifyContent:'center' },

  panelIdentity: { display:'flex', gap:14, alignItems:'flex-start' },
  bigAvatar: { width:56, height:56, borderRadius:999, background:'#3B82F6', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:600, flexShrink:0 },
  bigName: { fontSize:20, fontWeight:600, color:'#FAFAFA', letterSpacing:'-0.01em' },
  bigEmailRow: { display:'flex', alignItems:'center', gap:6, marginTop:4 },
  bigEmail: { fontSize:13, color:'var(--d-text-3)' },
  badgeRow: { display:'flex', alignItems:'center', gap:8, marginTop:10, flexWrap:'wrap' },
  proBadge: { fontSize:11, fontWeight:600, color:'#93C5FD', padding:'3px 8px', borderRadius:4, background:'rgba(59,130,246,0.16)' },
  orgBadge: { fontSize:11, fontWeight:500, color:'var(--d-text-2)', padding:'3px 8px', borderRadius:4, background:'var(--d-raised)' },
  dotSep: { width:3, height:3, borderRadius:999, background:'var(--d-text-4)' },
  memberSince: { fontSize:11, color:'var(--d-text-4)' },

  section: { padding:'20px 22px', borderBottom:'1px solid var(--d-border-2)' },
  sectionHead: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  sectionLabel: { fontSize:11, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 },
  sectionLink: { fontSize:11, color:'var(--d-accent)', fontWeight:500, cursor:'pointer' },

  statGrid: { display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8 },

  lastSeen: { display:'flex', alignItems:'center', gap:8, marginTop:14, paddingTop:12, borderTop:'1px solid var(--d-border-2)' },
  lastSeenDot: { width:6, height:6, borderRadius:999, background:'#22C55E', boxShadow:'0 0 0 3px rgba(34,197,94,0.20)' },
  lastSeenText: { fontSize:12, color:'var(--d-text-2)' },

  historyList: { display:'flex', flexDirection:'column', gap:6 },
  historyRow: { display:'flex', gap:12, padding:'10px 12px', background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)', cursor:'pointer' },
  historyRowCurrent: { display:'flex', gap:12, padding:'10px 12px', background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.30)', borderRadius:'var(--r-sm)', cursor:'pointer' },
  historyTitleRow: { display:'flex', alignItems:'center', gap:6 },
  historyId: { fontSize:11, color:'var(--d-text-3)', fontWeight:500 },
  currentTag: { fontSize:9, fontWeight:600, color:'#93C5FD', padding:'1px 5px', background:'rgba(59,130,246,0.20)', borderRadius:3, textTransform:'uppercase', letterSpacing:'0.05em' },
  historyTitle: { fontSize:13, color:'var(--d-text-2)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  historyMeta: { display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 },
  historyDate: { fontSize:11, color:'var(--d-text-4)' },

  note: { padding:'12px 14px', background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)', marginBottom:8 },
  noteHead: { display:'flex', alignItems:'center', gap:8, marginBottom:6 },
  noteName: { fontSize:12, fontWeight:600, color:'var(--d-text)' },
  noteTime: { fontSize:11, color:'var(--d-text-4)', marginLeft:'auto' },
  noteText: { margin:0, fontSize:13, color:'var(--d-text-2)', lineHeight:1.5 },

  addNote: { marginTop:12, background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)' },
  addNoteInput: { width:'100%', minHeight:64, padding:'12px 14px', background:'transparent', border:'none', outline:'none', color:'var(--d-text)', fontFamily:'inherit', fontSize:13, lineHeight:1.5, resize:'vertical' },
  addNoteFoot: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', borderTop:'1px solid var(--d-border-2)' },
  addNoteHint: { fontSize:11, color:'var(--d-text-4)' },
  saveNote: { height:26, padding:'0 10px', background:'var(--d-accent)', color:'#fff', fontSize:11, fontWeight:600, borderRadius:'var(--r-xs)' },
};

window.Screen07_CustomerProfile = Screen07_CustomerProfile;
