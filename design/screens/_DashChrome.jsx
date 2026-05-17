// ============================================================
// DashChrome — shared left sidebar for dashboard screens.
// Dark surface. Pass `view` to highlight active row.
// ============================================================

const DashSidebar = ({ view = 'inbox' }) => {
  const navItems = [
    { key:'inbox',     label:'Inbox',         icon:<Inbox size={15}/>,   count:'24', active: view === 'inbox' },
    { key:'mine',      label:'Mine',          icon:<User size={15}/>,    count:'7',  active: view === 'mine' },
    { key:'unass',     label:'Unassigned',    icon:<Help size={15}/>,    count:'11', active: view === 'unass' },
    { key:'all',       label:'All tickets',   icon:<Globe size={15}/>,   count:'248',active: view === 'all' },
  ];
  const status = [
    { color:'#3B82F6', label:'Open', count:'18' },
    { color:'#F59E0B', label:'In Progress', count:'9' },
    { color:'#A78BFA', label:'Waiting', count:'4' },
    { color:'#22C55E', label:'Resolved', count:'186' },
  ];
  const labels = [
    { color:'#EF4444', label:'Bug Report', count:'42' },
    { color:'#3B82F6', label:'Feature Request', count:'28' },
    { color:'#22C55E', label:'Question', count:'15' },
    { color:'#F59E0B', label:'Billing', count:'8' },
  ];

  return (
    <aside style={ds.side}>
      {/* brand */}
      <div style={ds.brand}>
        <span style={{display:'inline-flex', color:'#fff'}}><Logo size={22}/></span>
        <div>
          <div style={ds.brandTitle}>TMR Support</div>
          <div style={ds.brandOrg}>Acme Corp · workspace</div>
        </div>
      </div>

      {/* search */}
      <div style={ds.searchWrap}>
        <Search size={13}/>
        <input style={ds.searchInp} placeholder="Search tickets, customers..."/>
        <span style={ds.kbd}>⌘ K</span>
      </div>

      <nav style={ds.navWrap}>
        <div style={ds.sectionLabel}>Views</div>
        {navItems.map(n => (
          <a key={n.key} style={n.active ? ds.navActive : ds.nav}>
            {n.active && <span style={ds.navIndicator}/>}
            <span style={{color: n.active ? 'var(--d-accent)' : 'var(--d-text-3)', display:'inline-flex'}}>{n.icon}</span>
            <span>{n.label}</span>
            <span style={n.active ? ds.navCountActive : ds.navCount}>{n.count}</span>
          </a>
        ))}

        <div style={{...ds.sectionLabel, marginTop:20}}>Status</div>
        {status.map(s => (
          <a key={s.label} style={ds.nav}>
            <span style={{width:8, height:8, borderRadius:999, background:s.color, marginLeft:5, marginRight:5}}/>
            <span>{s.label}</span>
            <span style={ds.navCount}>{s.count}</span>
          </a>
        ))}

        <div style={{...ds.sectionLabel, marginTop:20}}>Labels</div>
        {labels.map(l => (
          <a key={l.label} style={ds.nav}>
            <span style={{width:8, height:8, borderRadius:2, background:l.color, marginLeft:5, marginRight:5}}/>
            <span>{l.label}</span>
            <span style={ds.navCount}>{l.count}</span>
          </a>
        ))}
      </nav>

      {/* User pinned bottom */}
      <div style={ds.user}>
        <div style={ds.userAvatar}>SK</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={ds.userName}>Sarah Kim</div>
          <div style={ds.userMeta}>Connector engineering</div>
        </div>
        <button style={ds.userBtn}><Settings size={14}/></button>
      </div>
    </aside>
  );
};

const ds = {
  side: {
    width:240, flexShrink:0, height:'100%',
    background:'#0A0A0A', borderRight:'1px solid var(--d-border)',
    display:'flex', flexDirection:'column',
    color:'var(--d-text-2)',
  },
  brand: {
    display:'flex', alignItems:'center', gap:10, padding:'18px 16px 14px',
    borderBottom:'1px solid var(--d-border-2)',
  },
  brandTitle: { fontSize:13, fontWeight:600, color:'#FAFAFA' },
  brandOrg: { fontSize:11, color:'var(--d-text-3)', marginTop:2 },

  searchWrap: {
    margin:'12px 12px 4px',
    display:'flex', alignItems:'center', gap:6,
    padding:'0 8px', height:30,
    background:'#0F0F10', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
    color:'var(--d-text-4)',
  },
  searchInp: { flex:1, fontSize:12, color:'var(--d-text-2)', background:'transparent', border:'none', outline:'none', fontFamily:'inherit' },
  kbd: { fontFamily:'var(--font-mono)', fontSize:10, padding:'1px 5px', background:'var(--d-raised)', borderRadius:3, color:'var(--d-text-4)' },

  navWrap: { flex:1, overflowY:'auto', padding:'8px 8px 16px' },
  sectionLabel: {
    padding:'10px 8px 6px', fontSize:10, color:'var(--d-text-4)',
    textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600,
  },
  nav: {
    position:'relative', display:'flex', alignItems:'center', gap:10,
    padding:'6px 10px', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight:500, color:'var(--d-text-2)', cursor:'pointer',
  },
  navActive: {
    position:'relative', display:'flex', alignItems:'center', gap:10,
    padding:'6px 10px', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight:600, color:'#FAFAFA',
    background:'rgba(59,130,246,0.10)',
  },
  navIndicator: { position:'absolute', left:-8, top:6, bottom:6, width:2, borderRadius:2, background:'var(--d-accent)' },
  navCount: { marginLeft:'auto', fontSize:11, fontWeight:500, color:'var(--d-text-4)', fontVariantNumeric:'tabular-nums' },
  navCountActive: { marginLeft:'auto', fontSize:11, fontWeight:600, color:'var(--d-text-2)', fontVariantNumeric:'tabular-nums' },

  user: {
    margin:'8px 12px 12px', padding:'8px 10px',
    background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)',
    display:'flex', alignItems:'center', gap:10,
  },
  userAvatar: { width:28, height:28, borderRadius:999, background:'#A78BFA', color:'#1B0B2A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600 },
  userName: { fontSize:12, fontWeight:600, color:'#FAFAFA', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  userMeta: { fontSize:10, color:'var(--d-text-4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  userBtn: { width:24, height:24, borderRadius:4, color:'var(--d-text-3)', display:'flex', alignItems:'center', justifyContent:'center' },
};

window.DashSidebar = DashSidebar;
