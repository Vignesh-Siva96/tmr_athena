// ============================================================
// 04 — Single Ticket View (Customer)
// Surface: WHITE PORTAL. 1280×1180.
// Conversation thread (65%) + Metadata sidebar (35%).
// ============================================================

const Screen04_Ticket = () => {
  return (
    <div className="surface-portal" style={s04.root}>
      {/* ===== Nav ===== */}
      <header style={s04.nav}>
        <div style={s04.navLeft}>
          <span style={{color:'#09090B', display:'inline-flex'}}><Logo size={26}/></span>
          <span style={{fontSize:15, fontWeight:600}}>Acme Corp <span style={{color:'var(--p-text-3)', fontWeight:500}}>Support</span></span>
        </div>
        <div style={s04.navRight}>
          <a style={s04.navLink}>My Tickets</a>
          <a style={s04.navLink}>Submit a Ticket</a>
          <div style={s04.avatar}>JC</div>
        </div>
      </header>

      {/* ===== Body ===== */}
      <div style={s04.body}>
        {/* Breadcrumb + title */}
        <div style={s04.crumbRow}>
          <a style={s04.crumb}>My Tickets</a>
          <ChevronRight size={12} style={{color:'var(--p-text-4)'}}/>
          <span className="mono" style={s04.crumbId}>TMR-1042</span>
        </div>
        <div style={s04.titleRow}>
          <div style={{flex:1}}>
            <h1 style={s04.h1}>GA4 connector failing to sync after May 12 update</h1>
            <div style={s04.titleMeta}>
              <span className="pill wait"><span className="dot"/>Waiting on you</span>
              <span style={s04.dot}>·</span>
              <span style={s04.metaTxt}>Opened May 12, 2025</span>
              <span style={s04.dot}>·</span>
              <span style={s04.metaTxt}>Last activity 2 hours ago</span>
            </div>
          </div>
          <div style={s04.titleActions}>
            <button style={s04.outlineBtn}><Copy size={14}/> Copy link</button>
          </div>
        </div>

        {/* Two-column */}
        <div style={s04.grid}>
          {/* ===== Left: Thread ===== */}
          <section style={s04.thread}>
            {/* Customer original */}
            <Bubble04
              side="right" name="You" initials="JC" time="May 12 at 10:14 AM"
              accent="var(--p-accent)"
              body={
                <>
                  <p style={{margin:0}}>After the May 12 deploy our scheduled GA4 → Sheets pull stops mid-way. The sheet is partially populated then the run errors out with <code style={s04.code}>rate limit exceeded</code> — even on small accounts.</p>
                  <p style={{margin:'10px 0 0'}}>Happy to give you read access to the test workspace if helpful.</p>
                </>
              }
              attachments={[
                { name:'error-log-2025-05-13.txt', size:'14 KB' },
                { name:'ga4-sheets-screenshot.png', size:'284 KB' },
              ]}
            />

            <SystemEvent text="Ticket marked as Open" />

            {/* Agent reply */}
            <Bubble04
              side="left" name="Sarah from TMR Support" initials="SK" time="May 12 at 11:08 AM"
              accent="#A78BFA"
              viaEmail
              body={
                <>
                  <p style={{margin:0}}>Hey Jordan — thanks for the detailed write-up and the log. I can reproduce this on a fresh workspace.</p>
                  <p style={{margin:'10px 0 0'}}>The root cause is the new auth retry policy hitting GA4's hard quota harder than it should. Our team has a fix already in code review.</p>
                  <p style={{margin:'10px 0 0'}}><strong>Workaround for now:</strong> if you set the schedule interval to <strong>2 hours</strong> instead of hourly, the pulls complete reliably. I've also bumped your account's burst quota for the next 7 days.</p>
                </>
              }
            />

            <SystemEvent text="Linked to GitHub issue #234 · tmr/connectors" icon={<Github size={12}/>} link />
            <SystemEvent text="Status changed to In Progress" />

            {/* Agent follow-up */}
            <Bubble04
              side="left" name="Sarah from TMR Support" initials="SK" time="Today at 2:34 PM"
              accent="#A78BFA"
              body={
                <>
                  <p style={{margin:0}}>Good news — the fix shipped this morning. Could you try running a manual sync on the affected workspace and confirm whether it completes cleanly? Once you confirm, I'll mark this as resolved.</p>
                </>
              }
              cta={<button style={s04.replyCta}>I'll test now <Arrow size={12} stroke={2.2}/></button>}
            />

            {/* Composer */}
            <div style={s04.composer}>
              <div style={s04.composerHead}>
                <span style={s04.composerLabel}>Reply</span>
                <span style={s04.composerHint}>Markdown supported</span>
              </div>
              <textarea
                style={s04.composerInput}
                defaultValue=""
                placeholder="Write a reply..."
              />
              <div style={s04.composerToolbar}>
                <div style={s04.composerTools}>
                  <button style={s04.toolBtn}><Bold size={14}/></button>
                  <button style={s04.toolBtn}><Italic size={14}/></button>
                  <button style={s04.toolBtn}><Code size={14}/></button>
                  <button style={s04.toolBtn}><Link size={14}/></button>
                  <span style={s04.toolSep}/>
                  <button style={s04.toolBtn}><Paperclip size={14}/></button>
                </div>
                <button style={s04.sendBtn}>
                  <Send size={14}/>
                  <span>Send reply</span>
                </button>
              </div>
              <div style={s04.composerFoot}>
                Your reply will also be sent to <strong style={{color:'var(--p-text-2)'}}>jordan@acmecorp.com</strong> — you can reply from there too.
              </div>
            </div>
          </section>

          {/* ===== Right: Sidebar ===== */}
          <aside style={s04.side}>
            <div style={s04.sideCard}>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Status</span>
                <span className="pill wait"><span className="dot"/>Waiting on you</span>
              </div>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Ticket ID</span>
                <span style={s04.sideValueRow}>
                  <span className="mono" style={s04.sideValue}>TMR-1042</span>
                  <button style={s04.copyBtn}><Copy size={12}/></button>
                </span>
              </div>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Opened</span>
                <span style={s04.sideValue}>May 12, 2025</span>
              </div>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Category</span>
                <span style={s04.sideValueRow}>
                  <span style={{color:'var(--p-warning)', display:'inline-flex'}}><Bug size={14}/></span>
                  <span style={s04.sideValue}>Bug Report</span>
                </span>
              </div>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Product</span>
                <span style={s04.sideValue}>Google Sheets</span>
              </div>
              <div style={s04.sideRow}>
                <span style={s04.sideLabel}>Connector</span>
                <span style={s04.sideValue}>GA4 — Google Analytics</span>
              </div>
            </div>

            <div style={s04.sideCard}>
              <div style={s04.sideTitle}>Linked issue</div>
              <a style={s04.ghCard}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <Github size={14}/>
                  <span style={s04.ghTitle}>GA4 connector retry burst</span>
                </div>
                <div style={s04.ghMeta}>
                  <span className="mono" style={s04.ghNum}>tmr/connectors#234</span>
                  <span className="pill prog" style={{padding:'2px 6px'}}>Open</span>
                </div>
              </a>
            </div>

            <div style={s04.sideCard}>
              <div style={s04.sideTitle}>Assigned to</div>
              <div style={s04.assignee}>
                <div style={{...s04.assigneeAvatar, background:'#A78BFA'}}>SK</div>
                <div>
                  <div style={s04.assigneeName}>Sarah Kim</div>
                  <div style={s04.assigneeRole}>Connector engineering · TMR Support</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

// --- Bubble ---
const Bubble04 = ({ side, name, initials, time, accent, body, attachments, viaEmail, cta }) => {
  const isRight = side === 'right';
  return (
    <div style={{
      display:'flex', gap:12, marginBottom:24,
      flexDirection: isRight ? 'row-reverse' : 'row',
    }}>
      <div style={{
        width:32, height:32, borderRadius:999, background:accent, color:'#fff', flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600,
      }}>{initials}</div>
      <div style={{ flex:1, maxWidth:'85%' }}>
        <div style={{
          display:'flex', alignItems:'baseline', gap:8, marginBottom:6,
          flexDirection: isRight ? 'row-reverse' : 'row',
        }}>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--p-text)' }}>{name}</span>
          <span style={{ fontSize:11, color:'var(--p-text-4)' }}>{time}</span>
          {viaEmail && <span style={{
            fontSize:10, color:'var(--p-text-3)', padding:'1px 6px',
            background:'var(--p-surface)', borderRadius:4, fontWeight:500,
          }}>via email</span>}
        </div>
        <div style={{
          padding:'14px 16px', borderRadius:'var(--r-md)',
          background: isRight ? 'var(--p-accent-bg)' : '#FFFFFF',
          border: isRight ? '1px solid #D9E5FD' : '1px solid var(--p-border)',
          fontSize:14, lineHeight:1.6, color:'var(--p-text)',
        }}>
          {body}
          {attachments && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
              {attachments.map(a => (
                <div key={a.name} style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  padding:'6px 10px',
                  background:'#fff', border:'1px solid var(--p-border)', borderRadius:6,
                }}>
                  <Paperclip size={12} style={{color:'var(--p-text-4)'}}/>
                  <span style={{fontSize:12, fontWeight:500}}>{a.name}</span>
                  <span style={{fontSize:11, color:'var(--p-text-4)', fontVariantNumeric:'tabular-nums'}}>{a.size}</span>
                </div>
              ))}
            </div>
          )}
          {cta && <div style={{marginTop:12}}>{cta}</div>}
        </div>
      </div>
    </div>
  );
};

const SystemEvent = ({ text, icon, link }) => (
  <div style={{
    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    margin:'8px 0 20px',
  }}>
    <span style={{flex:1, height:1, background:'var(--p-border-2)'}}/>
    <div style={{
      display:'inline-flex', alignItems:'center', gap:6,
      fontSize:11, color: link ? 'var(--p-accent)' : 'var(--p-text-3)',
      fontWeight:500,
      padding:'4px 10px', background:'#fff', borderRadius:999,
      border:'1px solid var(--p-border-2)',
    }}>
      {icon}
      <span>{text}</span>
    </div>
    <span style={{flex:1, height:1, background:'var(--p-border-2)'}}/>
  </div>
);

const s04 = {
  root: { width:'100%', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--p-bg)' },

  nav: { height:64, padding:'0 40px', borderBottom:'1px solid var(--p-border)', display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(255,255,255,0.85)' },
  navLeft: { display:'flex', alignItems:'center', gap:10 },
  navRight: { display:'flex', alignItems:'center', gap:24 },
  navLink: { fontSize:14, color:'var(--p-text-3)', fontWeight:500, cursor:'pointer' },
  avatar: { width:32, height:32, borderRadius:999, background:'var(--p-accent)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600 },

  body: { flex:1, padding:'32px 40px 40px', overflowY:'auto', maxWidth:1200, width:'100%', margin:'0 auto' },

  crumbRow: { display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--p-text-3)', marginBottom:12 },
  crumb: { fontSize:12, color:'var(--p-text-3)', cursor:'pointer' },
  crumbId: { fontSize:12, color:'var(--p-text-2)', fontWeight:500 },

  titleRow: { display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:24, marginBottom:32, paddingBottom:24, borderBottom:'1px solid var(--p-border)' },
  h1: { fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, letterSpacing:'-0.02em', margin:0, lineHeight:1.2 },
  titleMeta: { display:'flex', alignItems:'center', gap:10, marginTop:10 },
  metaTxt: { fontSize:12, color:'var(--p-text-3)' },
  dot: { color:'var(--p-text-4)' },

  titleActions: { display:'flex', alignItems:'center', gap:8 },
  outlineBtn: {
    display:'inline-flex', alignItems:'center', gap:6,
    height:34, padding:'0 12px',
    border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight:500, color:'var(--p-text-2)', background:'#fff',
  },

  grid: { display:'grid', gridTemplateColumns:'1fr 320px', gap:32, alignItems:'flex-start' },

  thread: { minWidth:0 },
  composer: {
    marginTop:20,
    border:'1px solid var(--p-border)', borderRadius:'var(--r-md)',
    background:'#fff', overflow:'hidden',
  },
  composerHead: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 14px', borderBottom:'1px solid var(--p-border-2)', background:'var(--p-surface-2)',
  },
  composerLabel: { fontSize:12, fontWeight:600, color:'var(--p-text)' },
  composerHint: { fontSize:11, color:'var(--p-text-4)' },
  composerInput: {
    width:'100%', minHeight:90, padding:'14px',
    border:'none', outline:'none', resize:'vertical',
    fontFamily:'inherit', fontSize:14, lineHeight:1.5, color:'var(--p-text)',
  },
  composerToolbar: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 14px', borderTop:'1px solid var(--p-border-2)', background:'var(--p-surface-2)',
  },
  composerTools: { display:'flex', alignItems:'center', gap:4 },
  toolBtn: {
    width:28, height:28, borderRadius:'var(--r-xs)', color:'var(--p-text-3)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  toolSep: { width:1, height:16, background:'var(--p-border)', margin:'0 4px' },
  sendBtn: {
    display:'inline-flex', alignItems:'center', gap:6, height:32, padding:'0 12px',
    background:'var(--p-accent)', color:'#fff', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight:600,
  },
  composerFoot: { padding:'8px 14px', fontSize:11, color:'var(--p-text-4)', borderTop:'1px solid var(--p-border-2)' },

  code: {
    fontFamily:'var(--font-mono)', fontSize:13, padding:'2px 5px',
    background:'var(--p-surface)', borderRadius:4, border:'1px solid var(--p-border-2)',
  },

  replyCta: {
    display:'inline-flex', alignItems:'center', gap:6, height:32, padding:'0 12px',
    background:'#fff', border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    fontSize:13, fontWeight:500, color:'var(--p-text-2)',
  },

  side: { display:'flex', flexDirection:'column', gap:16, position:'sticky', top:0 },
  sideCard: {
    border:'1px solid var(--p-border)', borderRadius:'var(--r-md)', background:'#fff',
    padding:'16px',
  },
  sideTitle: { fontSize:11, fontWeight:600, color:'var(--p-text-4)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 },
  sideRow: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'8px 0', borderBottom:'1px solid var(--p-border-2)',
  },
  sideLabel: { fontSize:12, color:'var(--p-text-3)' },
  sideValue: { fontSize:13, color:'var(--p-text)', fontWeight:500 },
  sideValueRow: { display:'inline-flex', alignItems:'center', gap:6 },
  copyBtn: { width:22, height:22, borderRadius:4, color:'var(--p-text-4)', display:'flex', alignItems:'center', justifyContent:'center' },

  ghCard: {
    display:'flex', flexDirection:'column', gap:8,
    padding:'10px 12px', border:'1px solid var(--p-border)', borderRadius:'var(--r-sm)',
    background:'var(--p-surface-2)', cursor:'pointer',
  },
  ghTitle: { fontSize:13, fontWeight:500, color:'var(--p-text)' },
  ghMeta: { display:'flex', alignItems:'center', justifyContent:'space-between' },
  ghNum: { fontSize:11, color:'var(--p-text-3)' },

  assignee: { display:'flex', alignItems:'center', gap:10 },
  assigneeAvatar: {
    width:36, height:36, borderRadius:999, color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:12, fontWeight:600,
  },
  assigneeName: { fontSize:13, fontWeight:600 },
  assigneeRole: { fontSize:11, color:'var(--p-text-4)', marginTop:1 },
};

window.Screen04_Ticket = Screen04_Ticket;
