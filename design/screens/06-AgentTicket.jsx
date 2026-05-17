// ============================================================
// 06 — Agent Ticket Detail (Dashboard)
// Surface: DARK. 1440×980.
// 3 columns: sidebar + thread + metadata/actions.
// ============================================================

const Screen06_AgentTicket = () => {
  return (
    <div className="surface-dashboard" style={s06.root}>
      <DashSidebar view="inbox"/>

      {/* ===== Center thread ===== */}
      <main style={s06.center}>
        {/* Header */}
        <header style={s06.header}>
          <div style={s06.headerTop}>
            <a style={s06.back}><ArrowLeft size={13}/> Inbox</a>
            <span style={s06.crumbDot}>/</span>
            <span className="mono" style={s06.headerId}>TMR-1042</span>
            <button style={s06.copyBtn}><Copy size={11}/></button>
            <span style={{flex:1}}/>
            <button style={s06.iconBtn}><Star size={13}/></button>
            <button style={s06.iconBtn}><Dots size={14}/></button>
          </div>
          <div style={s06.headerTitleRow}>
            <h1 style={s06.h1}>GA4 connector failing to sync after May 12 update</h1>
          </div>
          <div style={s06.headerControls}>
            <Selector06 label="Status" value="In Progress" pill="d-prog"/>
            <Selector06 label="Priority" value="Urgent" pillIcon={<Flag size={11}/>} valueColor="#FCA5A5"/>
            <Selector06 label="Assignee" value="Sarah Kim" avatar="SK" avatarColor="#A78BFA"/>
            <Selector06 label="Category" value="Bug Report" pillIcon={<Bug size={11}/>} valueColor="#FCA5A5"/>
            <button style={s06.tagAdd}><Plus size={12}/> Add tag</button>
          </div>
        </header>

        {/* Thread */}
        <div style={s06.thread}>
          {/* Customer original */}
          <AgentBubble
            side="left" name="Jordan Chen" sub="jordan@acmecorp.com" initials="JC"
            avatarColor="#3B82F6" time="May 12 · 10:14 AM"
            body={
              <>
                <p style={{margin:0}}>After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way. The sheet is partially populated then the run errors out with <code style={s06.code}>rate limit exceeded</code> — even on small accounts.</p>
                <p style={{margin:'10px 0 0'}}>Happy to give you read access to the test workspace if helpful.</p>
              </>
            }
            attachments={['error-log-2025-05-13.txt','ga4-sheets-screenshot.png']}
          />

          <SystemRow icon={<Github size={11}/>} text="Linked to GitHub issue #234 · tmr/connectors"/>
          <SystemRow text="Status changed Open → In Progress by Sarah Kim"/>

          {/* Internal note */}
          <div style={s06.noteWrap}>
            <div style={s06.noteBar}/>
            <div style={s06.noteBody}>
              <div style={s06.noteHead}>
                <div style={{width:24, height:24, borderRadius:999, background:'#A78BFA', color:'#1B0B2A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700}}>SK</div>
                <span style={s06.noteName}>Sarah Kim</span>
                <span style={s06.noteLabel}><Lock size={10}/> Internal note</span>
                <span style={s06.noteTime}>May 12 · 11:02 AM</span>
              </div>
              <p style={{margin:'8px 0 0', fontSize:13, color:'var(--d-text-2)', lineHeight:1.5}}>
                Confirmed reproducible on a fresh workspace. Root cause is the new auth retry policy hitting GA4's hard quota. Pinging <span style={s06.mention}>@diego</span> on the connector squad — fix is a one-line change in the backoff curve.
              </p>
            </div>
          </div>

          {/* Agent reply */}
          <AgentBubble
            side="right" name="Sarah Kim" sub="Connector engineering · TMR" initials="SK"
            avatarColor="#A78BFA" time="May 12 · 11:08 AM" sent
            body={
              <>
                <p style={{margin:0}}>Hey Jordan — thanks for the detailed write-up and the log. I can reproduce this on a fresh workspace.</p>
                <p style={{margin:'10px 0 0'}}>The root cause is the new auth retry policy hitting GA4's hard quota harder than it should. Our team has a fix in code review.</p>
                <p style={{margin:'10px 0 0'}}><strong>Workaround for now:</strong> set the schedule interval to 2 hours instead of hourly. I've also bumped your account's burst quota for the next 7 days.</p>
              </>
            }
          />

          <SystemRow text="Customer replied via email"/>

          {/* Customer reply */}
          <AgentBubble
            side="left" name="Jordan Chen" sub="jordan@acmecorp.com" initials="JC"
            avatarColor="#3B82F6" time="Today · 9:41 AM" viaEmail
            body={<p style={{margin:0}}>Thanks Sarah — switched to 2h and it's holding fine now. When you say "fix in code review", any ETA we can plan around? Need to know whether to leave it on 2h or wait it out for hourly.</p>}
          />
        </div>

        {/* Composer */}
        <div style={s06.composerWrap}>
          <div style={s06.composerTabs}>
            <button style={s06.tabActive}><Mail size={12}/> Reply to customer</button>
            <button style={s06.tabInactive}><Lock size={12}/> Internal note</button>
            <span style={{marginLeft:'auto', display:'flex', gap:6, alignItems:'center'}}>
              <button style={s06.linkBtn}><Code size={12}/> /  templates</button>
            </span>
          </div>
          <div style={s06.composerInputWrap}>
            <div style={s06.composerToolbar}>
              <button style={s06.compTool}><Heading size={14}/></button>
              <button style={s06.compTool}><Bold size={14}/></button>
              <button style={s06.compTool}><Italic size={14}/></button>
              <button style={s06.compTool}><Code size={14}/></button>
              <button style={s06.compTool}><ListIcon size={14}/></button>
              <button style={s06.compTool}><Link size={14}/></button>
              <span style={s06.compSep}/>
              <button style={s06.compTool}><Paperclip size={14}/></button>
              <span style={{flex:1}}/>
              <span style={s06.composerMeta}>Sent via portal + email</span>
            </div>
            <textarea
              style={s06.composerInput}
              defaultValue={"Hi Jordan — fix is scheduled for tomorrow's release (May 17, ~10am PT). Safe to leave on 2h until then; we'll DM you once it's out so you can switch back to hourly.\n\n— Sarah"}
            />
          </div>
          <div style={s06.composerFoot}>
            <span style={s06.composerSendNote}>
              Customer will receive this at <strong style={{color:'var(--d-text)'}}>jordan@acmecorp.com</strong>
            </span>
            <div style={s06.sendGroup}>
              <button style={s06.sendSecondary}>Send & Resolve</button>
              <button style={s06.sendPrimary}>
                <Send size={13}/>
                <span>Send & Keep Open</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ===== Right sidebar ===== */}
      <aside style={s06.side}>
        {/* Customer */}
        <div style={s06.sideCard}>
          <div style={s06.sideHead}>
            <div style={s06.sideTitle}>Customer</div>
            <a style={s06.sideHeadLink}>View profile <Arrow size={11}/></a>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{width:40, height:40, borderRadius:999, background:'#3B82F6', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600}}>JC</div>
            <div style={{flex:1, minWidth:0}}>
              <div style={s06.cName}>Jordan Chen</div>
              <div style={s06.cSub}>jordan@acmecorp.com</div>
            </div>
          </div>
          <div style={s06.cBadges}>
            <span style={{...s06.tag, background:'rgba(59,130,246,0.16)', color:'#93C5FD'}}>Pro Plan</span>
            <span style={s06.tag}>Acme Corp</span>
          </div>
          <div style={s06.cMeta}>
            <Row06 label="Member since" value="Jan 2024"/>
            <Row06 label="Tickets" value="12 total · 3 open"/>
            <Row06 label="Last active" value="2h ago"/>
          </div>
        </div>

        {/* Ticket */}
        <div style={s06.sideCard}>
          <div style={s06.sideTitle}>Ticket</div>
          <Row06 label="Created" value="May 12 · 10:14 AM"/>
          <Row06 label="Last activity" value="9:41 AM today"/>
          <Row06 label="Product" value="Google Sheets"/>
          <Row06 label="Connector" value="GA4 — Google Analytics"/>
          <Row06 label="Source" value="Portal + Email"/>
        </div>

        {/* GitHub */}
        <div style={s06.sideCard}>
          <div style={s06.sideTitle}>GitHub</div>
          <a style={s06.ghCard}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Github size={14}/>
              <span style={s06.ghTitle}>GA4 connector retry burst</span>
            </div>
            <div style={s06.ghMeta}>
              <span className="mono" style={s06.ghNum}>tmr/connectors#234</span>
              <span className="pill d-prog" style={{padding:'2px 6px'}}>Open</span>
            </div>
            <div style={s06.ghStats}>
              <span><Users size={11}/> 3 reviewers</span>
              <span><Clock size={11}/> 2 days</span>
            </div>
          </a>
          <button style={s06.ghCreate}><Plus size={12}/> Create new issue</button>
        </div>

        {/* Actions */}
        <div style={s06.sideCard}>
          <div style={s06.sideTitle}>Actions</div>
          <button style={s06.resolveBtn}><Check size={14}/> Resolve ticket</button>
          <button style={s06.ghostBtn}><Mail size={13}/> Send to customer</button>
          <button style={s06.ghostBtn}><Trash size={13}/> Archive ticket</button>
        </div>
      </aside>
    </div>
  );
};

const Selector06 = ({ label, value, pill, pillIcon, valueColor, avatar, avatarColor }) => (
  <button style={{
    display:'inline-flex', alignItems:'center', gap:8, height:30, padding:'0 10px',
    background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)',
  }}>
    <span style={{ fontSize:11, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 }}>{label}</span>
    {pill ? (
      <span className={`pill ${pill}`} style={{padding:'2px 6px'}}><span className="dot"/>{value}</span>
    ) : (
      <span style={{display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, color: valueColor || 'var(--d-text)' }}>
        {pillIcon}
        {avatar && <span style={{width:16, height:16, borderRadius:999, background:avatarColor, color:'#0A0A0A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700}}>{avatar}</span>}
        {value}
      </span>
    )}
    <Chevron size={11} style={{color:'var(--d-text-4)'}}/>
  </button>
);

const AgentBubble = ({ side, name, sub, initials, avatarColor, time, body, attachments, viaEmail, sent }) => {
  const isRight = side === 'right';
  return (
    <div style={{ display:'flex', gap:12, marginBottom:24, flexDirection: isRight ? 'row-reverse' : 'row' }}>
      <div style={{ width:32, height:32, borderRadius:999, background:avatarColor, color: avatarColor === '#A78BFA' ? '#1B0B2A' : '#fff', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600 }}>{initials}</div>
      <div style={{ flex:1, maxWidth:'85%' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:6, flexDirection: isRight ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#FAFAFA' }}>{name}</span>
          {sub && <span style={{ fontSize:11, color:'var(--d-text-4)' }}>{sub}</span>}
          <span style={{ fontSize:11, color:'var(--d-text-4)' }}>{time}</span>
          {viaEmail && <span style={{ fontSize:10, color:'var(--d-text-3)', padding:'1px 6px', background:'var(--d-raised)', borderRadius:4, fontWeight:500 }}>via email</span>}
          {sent && <span style={{ fontSize:10, color:'#86EFAC', padding:'1px 6px', background:'rgba(34,197,94,0.10)', borderRadius:4, fontWeight:500, display:'inline-flex', alignItems:'center', gap:3 }}><Check size={9} stroke={2.5}/>Sent via portal + email</span>}
        </div>
        <div style={{
          padding:'14px 16px', borderRadius:'var(--r-md)',
          background: isRight ? 'rgba(59,130,246,0.08)' : 'var(--d-surface)',
          border: isRight ? '1px solid rgba(59,130,246,0.30)' : '1px solid var(--d-border)',
          fontSize:13, lineHeight:1.6, color:'var(--d-text)',
        }}>
          {body}
          {attachments && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
              {attachments.map(name => (
                <div key={name} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 10px', background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:6 }}>
                  <Paperclip size={11} style={{color:'var(--d-text-4)'}}/>
                  <span style={{fontSize:12, color:'var(--d-text-2)'}}>{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SystemRow = ({ icon, text }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, margin:'4px 0 16px' }}>
    <span style={{flex:1, height:1, background:'var(--d-border-2)'}}/>
    <div style={{
      display:'inline-flex', alignItems:'center', gap:6,
      fontSize:11, color:'var(--d-text-3)', fontWeight:500,
      padding:'4px 10px', background:'var(--d-bg)', borderRadius:999,
      border:'1px solid var(--d-border-2)',
    }}>
      {icon}
      <span>{text}</span>
    </div>
    <span style={{flex:1, height:1, background:'var(--d-border-2)'}}/>
  </div>
);

const Row06 = ({ label, value }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--d-border-2)' }}>
    <span style={{fontSize:11, color:'var(--d-text-4)'}}>{label}</span>
    <span style={{fontSize:12, color:'var(--d-text-2)', fontWeight:500}}>{value}</span>
  </div>
);

const s06 = {
  root: { width:'100%', height:'100%', display:'flex', overflow:'hidden', background:'var(--d-bg)' },

  center: { flex:1, display:'flex', flexDirection:'column', minWidth:0 },
  header: { padding:'14px 24px 12px', borderBottom:'1px solid var(--d-border)' },
  headerTop: { display:'flex', alignItems:'center', gap:8 },
  back: { fontSize:12, color:'var(--d-text-3)', fontWeight:500, display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer' },
  crumbDot: { color:'var(--d-text-4)', fontSize:12 },
  headerId: { fontSize:12, color:'var(--d-text-2)', fontWeight:500 },
  copyBtn: { width:20, height:20, borderRadius:4, color:'var(--d-text-4)', display:'flex', alignItems:'center', justifyContent:'center' },
  iconBtn: { width:28, height:28, borderRadius:'var(--r-xs)', color:'var(--d-text-3)', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--d-surface)', border:'1px solid var(--d-border)' },

  headerTitleRow: { display:'flex', alignItems:'center', gap:12, marginTop:10 },
  h1: { fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'#FAFAFA', letterSpacing:'-0.015em', margin:0, lineHeight:1.2 },

  headerControls: { display:'flex', alignItems:'center', gap:8, marginTop:14, flexWrap:'wrap' },
  tagAdd: { display:'inline-flex', alignItems:'center', gap:4, height:30, padding:'0 10px', background:'transparent', border:'1px dashed var(--d-border)', borderRadius:'var(--r-sm)', fontSize:11, color:'var(--d-text-3)', fontWeight:500 },

  thread: { flex:1, overflowY:'auto', padding:'24px 24px 16px' },
  code: { fontFamily:'var(--font-mono)', fontSize:12, padding:'2px 5px', background:'var(--d-raised)', borderRadius:4, color:'#FCD34D' },

  noteWrap: { display:'flex', gap:0, marginBottom:24, background:'var(--d-note-bg)', border:'1px solid var(--d-note-line)', borderRadius:'var(--r-md)', padding:'12px 14px 14px' },
  noteBar: { width:3, marginRight:12, background:'var(--d-warning)', borderRadius:3, alignSelf:'stretch' },
  noteBody: { flex:1 },
  noteHead: { display:'flex', alignItems:'center', gap:8 },
  noteName: { fontSize:13, fontWeight:600, color:'#FAFAFA' },
  noteLabel: { fontSize:10, color:'#FCD34D', padding:'2px 6px', background:'rgba(245,158,11,0.15)', borderRadius:4, fontWeight:600, display:'inline-flex', alignItems:'center', gap:4, textTransform:'uppercase', letterSpacing:'0.05em' },
  noteTime: { fontSize:11, color:'var(--d-text-4)', marginLeft:'auto' },
  mention: { color:'#93C5FD', fontWeight:500 },

  /* composer */
  composerWrap: { padding:'0 24px 16px', flexShrink:0 },
  composerTabs: { display:'flex', gap:4, marginBottom:0 },
  tabActive: { display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', fontSize:12, fontWeight:600, color:'#FAFAFA', background:'var(--d-surface)', borderRadius:'var(--r-sm) var(--r-sm) 0 0', border:'1px solid var(--d-border)', borderBottom:'1px solid var(--d-surface)', position:'relative', top:1 },
  tabInactive: { display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', fontSize:12, fontWeight:500, color:'var(--d-text-3)', borderRadius:'var(--r-sm) var(--r-sm) 0 0' },
  linkBtn: { fontFamily:'var(--font-mono)', fontSize:11, color:'var(--d-text-4)', display:'inline-flex', alignItems:'center', gap:4 },

  composerInputWrap: { background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'0 var(--r-sm) var(--r-sm) var(--r-sm)' },
  composerToolbar: { display:'flex', alignItems:'center', gap:2, padding:'6px 8px', borderBottom:'1px solid var(--d-border-2)' },
  compTool: { width:28, height:26, borderRadius:4, color:'var(--d-text-3)', display:'flex', alignItems:'center', justifyContent:'center' },
  compSep: { width:1, height:14, background:'var(--d-border)', margin:'0 6px' },
  composerMeta: { fontSize:10, color:'var(--d-text-4)' },
  composerInput: { width:'100%', minHeight:90, padding:'12px 14px', background:'transparent', border:'none', outline:'none', color:'var(--d-text)', fontFamily:'inherit', fontSize:13, lineHeight:1.55, resize:'vertical' },

  composerFoot: { display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8 },
  composerSendNote: { fontSize:11, color:'var(--d-text-4)' },
  sendGroup: { display:'flex', gap:6 },
  sendSecondary: { height:32, padding:'0 12px', fontSize:12, fontWeight:600, color:'var(--d-text-2)', background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)' },
  sendPrimary: { display:'inline-flex', alignItems:'center', gap:6, height:32, padding:'0 14px', fontSize:12, fontWeight:600, color:'#fff', background:'var(--d-accent)', borderRadius:'var(--r-sm)' },

  /* right side */
  side: { width:320, flexShrink:0, height:'100%', background:'#0D0D0F', borderLeft:'1px solid var(--d-border)', padding:16, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 },
  sideCard: { padding:14, background:'var(--d-surface)', border:'1px solid var(--d-border)', borderRadius:'var(--r-md)' },
  sideHead: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  sideTitle: { fontSize:10, fontWeight:600, color:'var(--d-text-4)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 },
  sideHeadLink: { fontSize:11, color:'var(--d-accent)', fontWeight:500, display:'inline-flex', alignItems:'center', gap:4 },
  cName: { fontSize:13, fontWeight:600, color:'#FAFAFA' },
  cSub: { fontSize:11, color:'var(--d-text-3)', marginTop:1 },
  cBadges: { display:'flex', gap:6, marginTop:10, paddingBottom:10, borderBottom:'1px solid var(--d-border-2)' },
  cMeta: { marginTop:6 },
  tag: { display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:500, padding:'2px 6px', borderRadius:4, color:'var(--d-text-3)', background:'var(--d-raised)' },

  ghCard: { display:'flex', flexDirection:'column', gap:10, padding:'10px 12px', border:'1px solid var(--d-border)', background:'var(--d-raised)', borderRadius:'var(--r-sm)' },
  ghTitle: { fontSize:13, fontWeight:500, color:'var(--d-text)' },
  ghMeta: { display:'flex', alignItems:'center', justifyContent:'space-between' },
  ghNum: { fontSize:11, color:'var(--d-text-3)' },
  ghStats: { display:'flex', gap:10, fontSize:11, color:'var(--d-text-4)' },
  ghCreate: { display:'inline-flex', alignItems:'center', gap:6, marginTop:10, width:'100%', justifyContent:'center', height:30, fontSize:12, fontWeight:500, color:'var(--d-text-2)', background:'var(--d-raised)', border:'1px solid var(--d-border)', borderRadius:'var(--r-sm)' },

  resolveBtn: { display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', height:36, fontSize:13, fontWeight:600, color:'#fff', background:'var(--d-success)', borderRadius:'var(--r-sm)', marginBottom:8 },
  ghostBtn: { display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', height:32, fontSize:12, fontWeight:500, color:'var(--d-text-3)', background:'transparent', borderRadius:'var(--r-sm)', marginBottom:4 },
};

window.Screen06_AgentTicket = Screen06_AgentTicket;
