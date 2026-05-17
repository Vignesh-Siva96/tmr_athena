// ============================================================
// 05 — Agent Inbox (Dashboard home)
// Surface: DARK. 1440×900.
// 3-column: sidebar + dense ticket list + right context panel.
// ============================================================

const INBOX_05 = [
  { id:'TMR-1042', prio:'urgent', unread:true,  title:'GA4 connector failing to sync after May 12 update',          cust:'Jordan Chen', org:'Acme Corp', email:'jordan@acmecorp.com', cat:'Bug',     connector:'GA4', status:'wait',  statusLabel:'Waiting',     assignee:'SK', assigneeColor:'#A78BFA', activity:'3m',  github:true, selected:true },
  { id:'TMR-1041', prio:'normal', unread:true,  title:'Pinterest Ads connector authentication keeps expiring',      cust:'Mia Chen',    org:'Northwind', email:'mia@northwind.io',     cat:'Bug',     connector:'Pinterest Ads', status:'open', statusLabel:'Open',        assignee:null, assigneeColor:null, activity:'12m', github:false },
  { id:'TMR-1040', prio:'high',   unread:false, title:'Add scheduled CSV exports to Google Drive',                   cust:'Priya Rao',   org:'Lumen Media',email:'priya@lumen.co',       cat:'Feat',    connector:null, status:'prog',  statusLabel:'In Progress', assignee:'DT', assigneeColor:'#3B82F6', activity:'1h',  github:true },
  { id:'TMR-1039', prio:'normal', unread:true,  title:'Looker Studio data freshness lagging by ~2 hours',            cust:'Tom Becker',  org:'BrightLabs',email:'tom@brightlabs.com',   cat:'Bug',     connector:'Looker', status:'open',  statusLabel:'Open',        assignee:null, assigneeColor:null, activity:'1h', github:false },
  { id:'TMR-1038', prio:'normal', unread:false, title:'Best practice for blending GA4 and Search Console',            cust:'Asha Patel',  org:'Forge',     email:'asha@forge.dev',       cat:'Q',       connector:null, status:'wait',  statusLabel:'Waiting',     assignee:'SK', assigneeColor:'#A78BFA', activity:'2h',  github:false },
  { id:'TMR-1037', prio:'normal', unread:false, title:'TikTok Ads spend column showing in cents not dollars',         cust:'Linda Foss',  org:'Crisp & Co',email:'linda@crispco.com',    cat:'Bug',     connector:'TikTok Ads', status:'prog', statusLabel:'In Progress', assignee:'JM', assigneeColor:'#22C55E', activity:'2h',  github:true },
  { id:'TMR-1036', prio:'high',   unread:false, title:'API rate limit hit on hourly Facebook Ads schedule',           cust:'Devon Hill',  org:'GoodKite',  email:'devon@goodkite.io',    cat:'Bug',     connector:'Facebook Ads', status:'prog', statusLabel:'In Progress', assignee:'SK', assigneeColor:'#A78BFA', activity:'3h',  github:true },
  { id:'TMR-1035', prio:'normal', unread:false, title:'Invoice for April mentions wrong workspace name',              cust:'Hanna Loft',  org:'Verdant',   email:'hanna@verdant.studio', cat:'Bill',    connector:null, status:'open',  statusLabel:'Open',        assignee:null, assigneeColor:null, activity:'4h', github:false },
  { id:'TMR-1034', prio:'normal', unread:false, title:'Can I duplicate a report into another workspace?',             cust:'Robin Yi',    org:'Sundial',   email:'robin@sundial.fm',     cat:'Q',       connector:null, status:'wait',  statusLabel:'Waiting',     assignee:'DT', assigneeColor:'#3B82F6', activity:'5h',  github:false },
  { id:'TMR-1033', prio:'normal', unread:false, title:'Scheduled report email arriving 30 minutes late',              cust:'Eli Ward',    org:'Northstar', email:'eli@northstar.dev',    cat:'Bug',     connector:'Facebook Ads', status:'open', statusLabel:'Open',        assignee:'JM', assigneeColor:'#22C55E', activity:'Yest', github:false },
  { id:'TMR-1032', prio:'normal', unread:false, title:'Add Pinterest Ads as a data source (followup)',                cust:'Mira Lee',    org:'Halo',      email:'mira@halocreative.co', cat:'Feat',    connector:null, status:'open',  statusLabel:'Open',        assignee:null, assigneeColor:null, activity:'Yest',github:false },
];

const PRIO_COLOR = { urgent:'#EF4444', high:'#F59E0B', normal:'#71717A' };
const CAT_LABEL = { Bug:'Bug', Feat:'Feature', Q:'Question', Bill:'Billing' };
const CAT_COLOR = { Bug:'#EF4444', Feat:'#3B82F6', Q:'#22C55E', Bill:'#F59E0B' };

const Screen05_Inbox = () => {
  const sel = INBOX_05.find(t => t.selected) || INBOX_05[0];
  return (
    <div className="surface-dashboard" style={s05.root}>
      <DashSidebar view="inbox"/>

      {/* ===== Main ===== */}
      <main style={s05.main}>
        {/* Topbar */}
        <header style={s05.topbar}>
          <div style={s05.topbarLeft}>
            <h1 style={s05.h1}>Inbox</h1>
            <span style={s05.count}>24 open · 7 mine</span>
          </div>
          <div style={s05.topbarRight}>
            <button style={s05.iconBtn}><Filter size={14}/> Filter</button>
            <button style={s05.iconBtn}><Sort size={14}/> Newest <Chevron size={12}/></button>
            <span style={s05.sep}/>
            <button style={s05.iconBtn}><Plus size={14}/> New ticket</button>
          </div>
        </header>

        {/* Active filter chips */}
        <div style={s05.filterChips}>
          <span style={s05.filterLabel}>Filters:</span>
          <FilterChip label="Status: Open, In Progress" onClose/>
          <FilterChip label="Assignee: Anyone" onClose/>
          <button style={s05.addFilter}><Plus size={11}/> Add filter</button>
          <span style={{marginLeft:'auto', fontSize:11, color:'var(--d-text-4)'}}>11 of 24 shown</span>
        </div>

        {/* List */}
        <div style={s05.list}>
          {/* List header */}
          <div style={s05.listHead}>
            <span style={{width:16}}><input type="checkbox" style={s05.cb}/></span>
            <span style={{width:14}}/>
            <span style={{...s05.colHead, width:78}}>ID</span>
            <span style={{...s05.colHead, flex:1}}>Subject</span>
            <span style={{...s05.colHead, width:100, textAlign:'right'}}>Status</span>
            <span style={{...s05.colHead, width:80, textAlign:'right'}}>Assignee</span>
            <span style={{...s05.colHead, width:60, textAlign:'right'}}>Updated</span>
          </div>

          {INBOX_05.map(t => (
            <a key={t.id} style={t.selected ? s05.rowSelected : s05.row}>
              {t.selected && <span style={s05.rowIndicator}/>}
              <span style={{width:16, display:'flex', alignItems:'center'}}><input type="checkbox" style={s05.cb} defaultChecked={t.selected}/></span>
              <span style={{width:14, display:'flex', alignItems:'center'}}>
                <span style={{width:7, height:7, borderRadius:999, background:PRIO_COLOR[t.prio]}}/>
              </span>
              <span className="mono" style={{...s05.tid, width:78}}>{t.id}</span>

              <div style={s05.subjectCell}>
                {t.unread && <span style={s05.unread}/>}
                <span style={t.unread ? s05.subjectUnread : s05.subject}>{t.title}</span>
                <span style={{...s05.tag, color:CAT_COLOR[t.cat], background:`${CAT_COLOR[t.cat]}1F`}}>{CAT_LABEL[t.cat]}</span>
                {t.connector && <span style={s05.tag}>{t.connector}</span>}
                {t.github && <span style={s05.ghMark} title="Linked to GitHub"><Github size={11}/></span>}
                <span style={s05.custMeta}>· {t.org}</span>
              </div>

              <span style={{width:100, textAlign:'right'}}>
                <span className={`pill d-${t.status}`}><span className="dot"/>{t.statusLabel}</span>
              </span>
              <span style={{width:80, display:'flex', justifyContent:'flex-end'}}>
                {t.assignee ? (
                  <span style={{width:22, height:22, borderRadius:999, background:t.assigneeColor, color:'#0A0A0A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700}}>{t.assignee}</span>
                ) : (
                  <span style={s05.unassigned}>?</span>
                )}
              </span>
              <span style={{...s05.activity, width:60}}>{t.activity}</span>
            </a>
          ))}
        </div>
      </main>

      {/* ===== Right context panel ===== */}
      <aside style={s05.right}>
        <div style={s05.rightHead}>
          <div>
            <div style={s05.rightId}><span className="mono">{sel.id}</span><span style={{...s05.tag, color:CAT_COLOR[sel.cat], background:`${CAT_COLOR[sel.cat]}1F`, marginLeft:8}}>{CAT_LABEL[sel.cat]}</span></div>
            <div style={s05.rightTitle}>{sel.title}</div>
          </div>
          <button style={s05.rightOpenFull}>Open full <Arrow size={12} stroke={2.2}/></button>
        </div>
        <div style={s05.rightBadges}>
          <span className={`pill d-${sel.status}`}><span className="dot"/>{sel.statusLabel}</span>
          <span style={{...s05.tag, background:'rgba(239,68,68,0.14)', color:'#FCA5A5'}}><Flag size={10}/> Urgent</span>
        </div>

        {/* Customer card */}
        <div style={s05.rightCard}>
          <div style={s05.rightSection}>Customer</div>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{width:40, height:40, borderRadius:999, background:'#3B82F6', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600}}>JC</div>
            <div style={{flex:1, minWidth:0}}>
              <div style={s05.cName}>{sel.cust}</div>
              <div style={s05.cMeta}>{sel.email}</div>
            </div>
            <span style={{...s05.tag, background:'rgba(59,130,246,0.16)', color:'#93C5FD'}}>Pro</span>
          </div>
          <div style={s05.cStats}>
            <div style={s05.cStat}>
              <div style={s05.cStatNum}>12</div>
              <div style={s05.cStatLabel}>Tickets</div>
            </div>
            <div style={s05.cStat}>
              <div style={s05.cStatNum}>3</div>
              <div style={s05.cStatLabel}>Open</div>
            </div>
            <div style={s05.cStat}>
              <div style={s05.cStatNum}>1.4h</div>
              <div style={s05.cStatLabel}>Avg reply</div>
            </div>
          </div>
        </div>

        {/* Last message preview */}
        <div style={s05.rightCard}>
          <div style={s05.rightSection}>Last message · 2h ago</div>
          <div style={s05.lastMsg}>
            "After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way. The sheet is partially populated then the run errors out with rate limit exceeded — even on small accounts..."
          </div>
        </div>

        {/* Quick reply */}
        <div style={{...s05.rightCard, marginTop:'auto'}}>
          <div style={s05.rightSection}>Quick reply</div>
          <textarea style={s05.qrInput} placeholder="Type a reply or / for templates..."/>
          <div style={s05.qrActions}>
            <div style={s05.qrTools}>
              <button style={s05.qrTool}><Paperclip size={13}/></button>
              <button style={s05.qrTool}><Code size={13}/></button>
              <button style={s05.qrTool}><Github size={13}/></button>
            </div>
            <div style={s05.qrSendGroup}>
              <button style={s05.qrSend}>Send & keep open</button>
              <button style={s05.qrSendChev}><Chevron size={12}/></button>
            </div>
          </div>
          <div style={s05.quickActions}>
            <button style={s05.qaBtn}><User size={12}/> Assign me</button>
            <button style={s05.qaBtn}><Check size={12}/> Resolve</button>
            <button style={s05.qaBtn}><Github size={12}/> Link issue</button>
          </div>
        </div>
      </aside>
    </div>
  );
};

const FilterChip = ({ label, onClose }) => (
  <span style={s05.chip}>
    <span>{label}</span>
    {onClose && <button style={s05.chipX}><X size={10}/></button>}
  </span>
);

const s05 = {
  root: { width:'100%', height:'100%', display:'flex', overflow:'hidden', background:'var(--d-bg)' },

  main: { flex:1, display:'flex', flexDirection:'column', minWidth:0, background:'var(--d-bg)' },
  topbar: {
    height:56, padding:'0 24px',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    borderBottom:'1px solid var(--d-border)',
  },
  topbarLeft: { display:'flex', alignItems:'baseline', gap:12 },
  h1: { fontFamily:'var(--font-display)', fontSize:20, fontWeight:600, color:'#FAFAFA', margin:0, letterSpacing:'-0.01em' },
  count: { fontSize:12, color:'var(--d-text-3)' },
  topbarRight: { display:'flex', alignItems:'center', gap:8 },
  iconBtn: {
    display:'inline-flex', alignItems:'center', gap:6,
    height:30, padding:'0 10px',
    fontSize:12, fontWeight:500, color:'var(--d-text-2)',
    background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
  },
  sep: { width:1, height:18, background:'var(--d-border)' },

  filterChips: {
    display:'flex', alignItems:'center', gap:6, padding:'10px 24px',
    borderBottom:'1px solid var(--d-border-2)', background:'var(--d-bg)',
  },
  filterLabel: { fontSize:11, color:'var(--d-text-4)', marginRight:4 },
  chip: {
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'4px 8px', borderRadius:4,
    background:'var(--d-surface)', border:'1px solid var(--d-border)',
    fontSize:11, color:'var(--d-text-2)', fontWeight:500,
  },
  chipX: { width:16, height:16, borderRadius:3, color:'var(--d-text-4)', display:'flex', alignItems:'center', justifyContent:'center' },
  addFilter: {
    display:'inline-flex', alignItems:'center', gap:4,
    padding:'4px 8px', borderRadius:4,
    border:'1px dashed var(--d-border)', fontSize:11, color:'var(--d-text-3)',
  },

  list: { flex:1, overflowY:'auto' },
  listHead: {
    display:'flex', alignItems:'center', gap:12, padding:'10px 24px',
    background:'var(--d-bg)', borderBottom:'1px solid var(--d-border)',
    position:'sticky', top:0, zIndex:1,
  },
  cb: { width:14, height:14, accentColor:'#3B82F6' },
  colHead: { fontSize:10, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em' },

  row: {
    position:'relative', display:'flex', alignItems:'center', gap:12,
    padding:'10px 24px', borderBottom:'1px solid var(--d-border-2)', cursor:'pointer',
    height:48,
  },
  rowSelected: {
    position:'relative', display:'flex', alignItems:'center', gap:12,
    padding:'10px 24px', borderBottom:'1px solid var(--d-border-2)', cursor:'pointer',
    height:48, background:'rgba(59,130,246,0.06)',
  },
  rowIndicator: { position:'absolute', left:0, top:0, bottom:0, width:2, background:'var(--d-accent)' },
  tid: { fontSize:11, fontWeight:500, color:'var(--d-text-3)' },

  subjectCell: { flex:1, display:'flex', alignItems:'center', gap:8, minWidth:0 },
  unread: { width:7, height:7, borderRadius:999, background:'var(--d-accent)', flexShrink:0 },
  subject: { fontSize:13, fontWeight:500, color:'var(--d-text-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  subjectUnread: { fontSize:13, fontWeight:600, color:'#FAFAFA', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },

  tag: {
    display:'inline-flex', alignItems:'center', gap:4,
    fontSize:10, fontWeight:500, padding:'2px 6px', borderRadius:4,
    color:'var(--d-text-3)', background:'var(--d-raised)',
    flexShrink:0, letterSpacing:'0.01em', whiteSpace:'nowrap',
  },
  ghMark: { color:'var(--d-text-3)', display:'inline-flex', alignItems:'center', padding:'2px', flexShrink:0 },
  custMeta: { fontSize:11, color:'var(--d-text-4)', whiteSpace:'nowrap', flexShrink:0 },

  unassigned: {
    width:22, height:22, borderRadius:999, border:'1px dashed var(--d-border)',
    color:'var(--d-text-4)', display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:11, fontWeight:600,
  },
  activity: { fontSize:11, color:'var(--d-text-4)', textAlign:'right', fontVariantNumeric:'tabular-nums' },

  /* ---- Right panel ---- */
  right: {
    width:340, flexShrink:0, height:'100%',
    background:'#0D0D0F', borderLeft:'1px solid var(--d-border)',
    display:'flex', flexDirection:'column', padding:16, gap:12, overflowY:'auto',
  },
  rightHead: { display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' },
  rightId: { fontSize:11, color:'var(--d-text-3)' },
  rightTitle: { fontSize:14, fontWeight:600, color:'#FAFAFA', marginTop:4, lineHeight:1.4 },
  rightOpenFull: {
    display:'inline-flex', alignItems:'center', gap:4, height:26, padding:'0 8px',
    background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-xs)',
    fontSize:11, color:'var(--d-text-2)', fontWeight:500, flexShrink:0, whiteSpace:'nowrap',
  },
  rightBadges: { display:'flex', flexWrap:'wrap', gap:6 },
  rightCard: {
    padding:14, background:'var(--d-surface)', border:'1px solid var(--d-border)',
    borderRadius:'var(--r-md)',
  },
  rightSection: { fontSize:10, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 },

  cName: { fontSize:13, fontWeight:600, color:'#FAFAFA' },
  cMeta: { fontSize:11, color:'var(--d-text-3)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis' },

  cStats: { display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginTop:12, paddingTop:12, borderTop:'1px solid var(--d-border-2)' },
  cStat: { textAlign:'left' },
  cStatNum: { fontSize:18, fontWeight:600, color:'#FAFAFA', letterSpacing:'-0.01em', fontVariantNumeric:'tabular-nums' },
  cStatLabel: { fontSize:10, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:2 },

  lastMsg: {
    fontSize:12, color:'var(--d-text-2)', lineHeight:1.5,
    padding:10, background:'var(--d-raised)', borderRadius:'var(--r-xs)',
    border:'1px solid var(--d-border-2)',
  },

  qrInput: {
    width:'100%', minHeight:64, padding:10,
    background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
    color:'var(--d-text)', fontFamily:'inherit', fontSize:12, lineHeight:1.5,
    resize:'vertical', outline:'none',
  },
  qrActions: { display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8 },
  qrTools: { display:'flex', gap:2 },
  qrTool: { width:26, height:26, borderRadius:4, color:'var(--d-text-3)', display:'flex', alignItems:'center', justifyContent:'center' },
  qrSendGroup: { display:'inline-flex', borderRadius:'var(--r-xs)', overflow:'hidden' },
  qrSend: { height:28, padding:'0 12px', background:'var(--d-accent)', color:'#fff', fontSize:12, fontWeight:600, borderRight:'1px solid rgba(0,0,0,0.25)' },
  qrSendChev: { height:28, width:24, background:'var(--d-accent)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' },

  quickActions: { display:'flex', gap:6, marginTop:10, paddingTop:10, borderTop:'1px solid var(--d-border-2)' },
  qaBtn: {
    display:'inline-flex', alignItems:'center', gap:4, height:26, padding:'0 8px',
    background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-xs)',
    fontSize:11, color:'var(--d-text-2)', fontWeight:500,
  },
};

window.Screen05_Inbox = Screen05_Inbox;
