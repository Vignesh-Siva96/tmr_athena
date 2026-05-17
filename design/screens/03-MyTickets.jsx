// ============================================================
// 03 — My Tickets (Portal list)
// Surface: WHITE PORTAL. 1280×1000.
// Logged-in user inbox view.
// ============================================================

const TICKETS_03 = [
  { id:'TMR-1042', unread:true,  status:'wait',  statusLabel:'Waiting on you',  title:'GA4 connector failing to sync after May 12 update', cat:'Bug Report', meta:'Google Sheets · GA4', activity:'2h ago' },
  { id:'TMR-1038', unread:false, status:'prog',  statusLabel:'In progress',     title:'Add Pinterest Ads as a data source',                  cat:'Feature Request', meta:'Looker Studio', activity:'Yesterday' },
  { id:'TMR-1034', unread:false, status:'open',  statusLabel:'Open',            title:'Scheduled report email arriving 30 minutes late',     cat:'Bug Report', meta:'Hub · Facebook Ads', activity:'3 days ago' },
  { id:'TMR-1029', unread:true,  status:'open',  statusLabel:'Open',            title:'Best practice for blending GA4 and Search Console',   cat:'Question',   meta:'Looker Studio', activity:'4 days ago' },
  { id:'TMR-1018', unread:false, status:'res',   statusLabel:'Resolved',        title:'Invoice for April mentions wrong workspace name',     cat:'Billing',    meta:'', activity:'May 9' },
  { id:'TMR-0994', unread:false, status:'res',   statusLabel:'Resolved',        title:'TikTok Ads spend column showing in cents not dollars',cat:'Bug Report', meta:'Google Sheets · TikTok Ads', activity:'May 2' },
  { id:'TMR-0982', unread:false, status:'res',   statusLabel:'Resolved',        title:'Can I duplicate a report into another workspace?',    cat:'Question',   meta:'Hub', activity:'Apr 28' },
];

const Screen03_MyTickets = () => {
  return (
    <div className="surface-portal" style={s03.root}>
      {/* ===== Nav ===== */}
      <header style={s03.nav}>
        <div style={s03.navLeft}>
          <span style={{color:'#09090B', display:'inline-flex'}}><Logo size={26}/></span>
          <span style={s03.brandText}>Acme Corp <span style={s03.brandMuted}>Support</span></span>
          <nav style={s03.navTabs}>
            <a style={s03.navTabActive}>My Tickets</a>
            <a style={s03.navTab}>Submit a Ticket</a>
            <a style={s03.navTab}>Help Center</a>
          </nav>
        </div>
        <div style={s03.navRight}>
          <button style={s03.iconBtn}><Bell size={16}/></button>
          <div style={s03.userMenu}>
            <div style={s03.avatar}>JC</div>
            <div>
              <div style={s03.userName}>Jordan Chen</div>
              <div style={s03.userOrg}>Acme Corp</div>
            </div>
            <Chevron size={14} style={{color:'var(--p-text-4)'}}/>
          </div>
        </div>
      </header>

      {/* ===== Body ===== */}
      <main style={s03.main}>
        <div style={s03.headerRow}>
          <div>
            <h1 style={s03.h1}>My tickets</h1>
            <p style={s03.subtitle}><strong style={{color:'var(--p-text)'}}>3 open</strong> · 4 resolved · last activity 2 hours ago</p>
          </div>
          <button style={s03.cta}>
            <Plus size={16} stroke={2.2}/>
            <span>New ticket</span>
          </button>
        </div>

        {/* Filter bar */}
        <div style={s03.filterBar}>
          <div style={s03.tabs}>
            <button style={s03.tabActive}>All <span style={s03.tabCountActive}>7</span></button>
            <button style={s03.tab}>Open <span style={s03.tabCount}>2</span></button>
            <button style={s03.tab}>In Progress <span style={s03.tabCount}>1</span></button>
            <button style={s03.tab}>Waiting <span style={s03.tabCount}>1</span></button>
            <button style={s03.tab}>Resolved <span style={s03.tabCount}>3</span></button>
          </div>
          <div style={s03.searchWrap}>
            <Search size={14} style={{color:'var(--p-text-4)'}}/>
            <input style={s03.search} placeholder="Search tickets..."/>
            <span style={s03.kbd}>⌘ K</span>
          </div>
        </div>

        {/* List */}
        <div style={s03.list}>
          {TICKETS_03.map((t, i) => (
            <a key={t.id} style={{...s03.row, ...(i === TICKETS_03.length-1 ? {borderBottom:'none'} : {})}}>
              <span className={`pill ${t.status}`}>
                <span className="dot"/>
                {t.statusLabel}
              </span>

              <span className="mono" style={s03.tid}>{t.id}</span>

              <div style={s03.rowMid}>
                <div style={s03.titleRow}>
                  {t.unread && <span style={s03.unread} aria-label="Unread reply"/>}
                  <span style={t.unread ? s03.titleUnread : s03.title}>{t.title}</span>
                  <span style={s03.catTag}>{t.cat}</span>
                </div>
                {t.meta && <div style={s03.meta}>{t.meta}</div>}
              </div>

              <span style={s03.activity}>{t.activity}</span>
              <ChevronRight size={14} style={{color:'var(--p-text-4)', flexShrink:0}}/>
            </a>
          ))}
        </div>

        <div style={s03.footRow}>
          <span style={s03.footText}>Showing 7 of 7 tickets</span>
          <span style={s03.footMuted}>·</span>
          <a style={s03.footLink}>Export as CSV</a>
        </div>
      </main>
    </div>
  );
};

const s03 = {
  root: { width:'100%', height:'100%', overflow:'hidden', display:'flex', flexDirection:'column', background:'var(--p-bg)' },

  nav: {
    height:64, padding:'0 40px', borderBottom:'1px solid var(--p-border)',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    background:'rgba(255,255,255,0.85)', backdropFilter:'blur(8px)',
  },
  navLeft: { display:'flex', alignItems:'center', gap:32 },
  brandText: { fontSize:15, fontWeight:600, letterSpacing:'-0.01em' },
  brandMuted: { color:'var(--p-text-3)', fontWeight:500, marginLeft:4 },
  navTabs: { display:'flex', alignItems:'center', gap:24 },
  navTab: { fontSize:14, color:'var(--p-text-3)', fontWeight:500, cursor:'pointer' },
  navTabActive: { fontSize:14, color:'var(--p-text)', fontWeight:600, cursor:'pointer', position:'relative', paddingBottom:21, borderBottom:'2px solid var(--p-accent)', marginBottom:-21 },

  navRight: { display:'flex', alignItems:'center', gap:12 },
  iconBtn: {
    width:36, height:36, borderRadius:'var(--r-sm)', border:'1px solid var(--p-border)',
    color:'var(--p-text-2)', display:'flex', alignItems:'center', justifyContent:'center', background:'#fff',
  },
  userMenu: {
    display:'flex', alignItems:'center', gap:10, padding:'4px 8px 4px 4px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-md)', background:'#fff',
  },
  avatar: {
    width:32, height:32, borderRadius:999, background:'var(--p-accent)', color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600,
  },
  userName: { fontSize:13, fontWeight:600, lineHeight:1.1 },
  userOrg: { fontSize:11, color:'var(--p-text-4)', marginTop:1 },

  main: {
    flex:1, maxWidth:1000, width:'100%', margin:'0 auto',
    padding:'40px 40px 64px', overflowY:'auto',
  },

  headerRow: { display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:32 },
  h1: { fontFamily:'var(--font-display)', fontSize:36, fontWeight:600, letterSpacing:'-0.025em', margin:0, lineHeight:1.05 },
  subtitle: { fontSize:14, color:'var(--p-text-3)', marginTop:8, marginBottom:0 },

  cta: {
    display:'inline-flex', alignItems:'center', gap:6,
    height:40, padding:'0 14px',
    background:'var(--p-accent)', color:'#fff',
    borderRadius:'var(--r-sm)', fontSize:14, fontWeight:600,
  },

  filterBar: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 0', marginBottom:8, borderBottom:'1px solid var(--p-border)',
  },
  tabs: { display:'flex', alignItems:'center', gap:4 },
  tab: {
    display:'inline-flex', alignItems:'center', gap:6, padding:'8px 12px',
    fontSize:13, fontWeight:500, color:'var(--p-text-3)', borderRadius:'var(--r-sm)',
  },
  tabActive: {
    display:'inline-flex', alignItems:'center', gap:6, padding:'8px 12px',
    fontSize:13, fontWeight:600, color:'var(--p-text)', borderRadius:'var(--r-sm)',
    background:'var(--p-surface)',
  },
  tabCount: { fontSize:11, color:'var(--p-text-4)', fontWeight:500, padding:'1px 6px', background:'var(--p-surface)', borderRadius:999, fontVariantNumeric:'tabular-nums' },
  tabCountActive: { fontSize:11, color:'var(--p-accent)', fontWeight:600, padding:'1px 6px', background:'var(--p-accent-bg)', borderRadius:999, fontVariantNumeric:'tabular-nums' },

  searchWrap: {
    display:'inline-flex', alignItems:'center', gap:8,
    height:36, padding:'0 10px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)', background:'#fff', width:280,
  },
  search: { flex:1, border:'none', outline:'none', fontFamily:'inherit', fontSize:13, color:'var(--p-text)', background:'transparent' },
  kbd: {
    fontFamily:'var(--font-mono)', fontSize:10, color:'var(--p-text-4)',
    padding:'2px 5px', background:'var(--p-surface)', borderRadius:4,
  },

  list: {
    marginTop:8, border:'1px solid var(--p-border)', borderRadius:'var(--r-md)',
    background:'#fff', overflow:'hidden',
  },
  row: {
    display:'flex', alignItems:'center', gap:16,
    padding:'14px 16px', borderBottom:'1px solid var(--p-border-2)',
    cursor:'pointer',
  },
  tid: { fontSize:11, color:'var(--p-text-4)', width:80, fontWeight:500, flexShrink:0 },
  rowMid: { flex:1, minWidth:0 },
  titleRow: { display:'flex', alignItems:'center', gap:8, minWidth:0 },
  unread: { width:8, height:8, borderRadius:999, background:'var(--p-accent)', flexShrink:0 },
  title: { fontSize:14, fontWeight:500, color:'var(--p-text-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  titleUnread: { fontSize:14, fontWeight:600, color:'var(--p-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  catTag: {
    fontSize:11, fontWeight:500, color:'var(--p-text-3)',
    padding:'2px 8px', background:'var(--p-surface)', borderRadius:4, flexShrink:0,
  },
  meta: { fontSize:12, color:'var(--p-text-4)', marginTop:4 },

  activity: { fontSize:12, color:'var(--p-text-3)', width:90, textAlign:'right', flexShrink:0 },

  footRow: { display:'flex', alignItems:'center', gap:10, marginTop:20, fontSize:12, color:'var(--p-text-4)' },
  footText: { color:'var(--p-text-3)' },
  footMuted: { color:'var(--p-text-4)' },
  footLink: { color:'var(--p-accent)', fontWeight:500, cursor:'pointer' },
};

window.Screen03_MyTickets = Screen03_MyTickets;
