import { useState, useEffect, useCallback } from "react";

// ─── CONFIG SUPABASE ──────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";
function H() {
  return { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const ls = { get:(k)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;} }, set:(k,v)=>{ try{localStorage.setItem(k,JSON.stringify(v));}catch{} }, del:(k)=>{ try{localStorage.removeItem(k);}catch{} } };
const KEY = { patron:"ks_patron", agent:"ks_agent", txs:(d,u)=>`ks_txs_${u}_${d}`, pending:(u)=>`ks_pend_${u}`, floats:(d,u)=>`ks_float_${u}_${d}`, cash:(d,u)=>`ks_cash_${u}_${d}` };

// ─── DATE ─────────────────────────────────────────────────────────────────────
function today() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function nowISO() { const d=new Date(),p=n=>String(n).padStart(2,"0"),off=-d.getTimezoneOffset(),sign=off>=0?"+":"-",hh=p(Math.floor(Math.abs(off)/60)),mm=p(Math.abs(off)%60); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${hh}:${mm}`; }
async function sha256(s) { try { const b=new TextEncoder().encode(s),h=await crypto.subtle.digest("SHA-256",b); return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,"0")).join(""); } catch { return s; } }

// ─── OPERATEURS ───────────────────────────────────────────────────────────────
const PREFIXES = { MTN:["42","46","50","51","52","53","54","56","57","59","61","62","66","67","69","90","91","96","97"], MOOV:["45","55","58","60","63","64","65","68","94","95","98","99"], Celtiis:["20","21","22","23","24","28","29","40","41","43","44","47","48","49","92","93"] };
function detectOp(tel) { if(!tel||tel.length<2) return null; const p=tel.slice(0,2); for(const op of ["MTN","MOOV","Celtiis"]) { if(PREFIXES[op].includes(p)) return op; } return null; }
const OPS = ["MTN","MOOV","Celtiis"];
const OPC = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#91d845" };

// ─── GRILLE FRAIS ─────────────────────────────────────────────────────────────
const GRILLE = [
  {min:100,max:500,MTN:50,MOOV:50,Celtiis:25},{min:501,max:5000,MTN:125,MOOV:125,Celtiis:75},
  {min:5001,max:10000,MTN:225,MOOV:225,Celtiis:150},{min:10001,max:20000,MTN:375,MOOV:375,Celtiis:250},
  {min:20001,max:50000,MTN:700,MOOV:700,Celtiis:500},{min:50001,max:75000,MTN:1000,MOOV:1000,Celtiis:750},
  {min:75001,max:100000,MTN:1000,MOOV:1000,Celtiis:1000},{min:100001,max:200000,MTN:2000,MOOV:2000,Celtiis:2000},
  {min:200001,max:300000,MTN:3000,MOOV:3000,Celtiis:3000},{min:300001,max:500000,MTN:3500,MOOV:3500,Celtiis:4000},
  {min:500001,max:750000,MTN:5000,MOOV:5000,Celtiis:5000},{min:750001,max:1000000,MTN:6000,MOOV:6000,Celtiis:5000},
  {min:1000001,max:1500000,MTN:8000,MOOV:8000,Celtiis:5000},{min:1500001,max:2000000,MTN:9900,MOOV:9900,Celtiis:5000},
];
function frais(op, mt) { const t=GRILLE.find(r=>mt>=r.min&&mt<=r.max); return t?(t[op]||0):0; }
function tranche(mt) { return GRILLE.find(r=>mt>=r.min&&mt<=r.max)||null; }

// ─── FORFAITS ─────────────────────────────────────────────────────────────────
const FORFAIT_TYPES = [ {key:"internet",label:"Internet"}, {key:"appel",label:"Appel"}, {key:"appel_internet",label:"Appel + Internet"} ];
const FORFAIT_MONTANTS = [100,200,500,1000,2000,3000,5000,10000];

// ─── THEME ────────────────────────────────────────────────────────────────────
const PAYS = ["Benin","Togo","Burkina Faso","Cote d'Ivoire","Senegal"];
const MOIS = ["Janvier","Fevrier","Mars","Avril","Mai","Juin","Juillet","Aout","Septembre","Octobre","Novembre","Decembre"];
const JOURS = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const fF = n => Number(n||0).toLocaleString("fr-FR")+" F";
const mask = v => "• • • • •";

const DARK = {
  bg:"#060810", card:"#0C0E1A", border:"#161928", border2:"#1C2032",
  text:"#E2E4EE", sub:"#4A5070", faint:"#20253A", hero:"#0E1020",
  input:"#080A16", accent:"#00C896", nav:"#0C0E1A"
};
const LIGHT = {
  bg:"#F2F4FA", card:"#FFFFFF", border:"#E0E4F0", border2:"#D0D6EA",
  text:"#141828", sub:"#606880", faint:"#C8CDD8", hero:"#E8ECF8",
  input:"#F8F9FD", accent:"#00C896", nav:"#FFFFFF"
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function db(path, method="GET", body=null) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { method, headers:H(), ...(body?{body:JSON.stringify(body)}:{}) });
    if (!r.ok) { const e=await r.json().catch(()=>({})); return {ok:false,error:e.message||e.details||`${r.status}`}; }
    const d = await r.json(); return {ok:true,data:d};
  } catch(e) { return {ok:false,error:e.message||"Connexion impossible"}; }
}
const api = {
  getPatron: t => db(`patrons?telephone=eq.${t}&select=*`),
  savePatron: p => db("patrons","POST",p),
  getAgent: t => db(`cashpoint_agents?telephone=eq.${t}&select=*`),
  saveAgent: a => db("cashpoint_agents","POST",a),
  deleteAgent: id => Promise.all([
    db(`cashpoint_transactions?agent_id=eq.${id}`,"DELETE"),
    db(`cashpoint_floats?agent_id=eq.${id}`,"DELETE"),
    db(`cashpoint_agents?id=eq.${id}`,"DELETE")
  ]),
  getAgents: pid => db(`cashpoint_agents?patron_id=eq.${pid}&select=*&order=created_at.asc`),
  getInvite: code => db(`invitations?code=eq.${code.toUpperCase()}&used=eq.false&select=*`),
  createInvite: (code,pid) => db("invitations","POST",{code,patron_id:pid}),
  useInvite: (code,aid) => db(`invitations?code=eq.${code.toUpperCase()}`,"PATCH",{used:true,used_by:aid}),
  getTxs: (aid,date) => db(`cashpoint_transactions?agent_id=eq.${aid}&created_at=gte.${date}T00:00:00+01:00&created_at=lte.${date}T23:59:59+01:00&order=created_at.desc`),
  saveTx: tx => { const {localId,id,...clean}=tx; return db("cashpoint_transactions","POST",clean); },
  delTx: id => db(`cashpoint_transactions?id=eq.${id}`,"DELETE"),
  saveFloat: f => fetch(`${SUPA_URL}/rest/v1/cashpoint_floats`,{method:"POST",headers:{...H(),"Prefer":"return=representation,resolution=merge-duplicates"},body:JSON.stringify(f)}).then(r=>r.ok).catch(()=>false),
  getAllTxs: (pid,date,aids) => {
    const next = new Date(date); next.setDate(next.getDate()+1); const nd=next.toISOString().split("T")[0];
    if(aids&&aids.length) return db(`cashpoint_transactions?agent_id=in.(${aids.join(",")})&created_at=gte.${date}&created_at=lt.${nd}&order=created_at.desc`);
    return db(`cashpoint_transactions?patron_id=eq.${pid}&created_at=gte.${date}&created_at=lt.${nd}&order=created_at.desc`);
  },
  getAllFloats: (pid,date,aids) => {
    if(aids&&aids.length) return db(`cashpoint_floats?agent_id=in.(${aids.join(",")})&date=eq.${date}&select=*`);
    return db(`cashpoint_floats?patron_id=eq.${pid}&date=eq.${date}&select=*`);
  }
};

// ─── LOGO SVG ─────────────────────────────────────────────────────────────────
function LogoK({ size=36 }) {
  const r = Math.round(size*0.22);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{display:"block",flexShrink:0}}>
      <defs>
        <linearGradient id="lgbg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#06090F"/><stop offset="100%" stopColor="#0D1828"/></linearGradient>
        <linearGradient id="lgk" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00C896"/><stop offset="100%" stopColor="#00A5FF"/></linearGradient>
      </defs>
      <rect width="100" height="100" rx={r} fill="url(#lgbg)"/>
      <rect x="28" y="22" width="10" height="56" rx="5" fill="url(#lgk)"/>
      <path d="M38 50 Q58 36 74 22" fill="none" stroke="url(#lgk)" strokeWidth="10" strokeLinecap="round"/>
      <path d="M38 50 Q58 64 74 78" fill="none" stroke="url(#lgk)" strokeWidth="10" strokeLinecap="round"/>
    </svg>
  );
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin, setPin] = useState("");
  function tap(d) {
    if (pin.length >= 4) return;
    const p = pin + d;
    setPin(p);
    if (p.length === 4) setTimeout(() => { onSubmit(p); setPin(""); }, 120);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"32px 24px",background:T.bg,width:"100%",boxSizing:"border-box"}}>
      <LogoK size={52}/>
      <div style={{marginTop:20,fontWeight:800,fontSize:22,color:T.text,letterSpacing:"-0.3px"}}>{title}</div>
      <div style={{fontSize:13,color:T.sub,marginTop:4,marginBottom:32,textAlign:"center"}}>{subtitle}</div>
      <div style={{display:"flex",gap:16,marginBottom:32}}>
        {[0,1,2,3].map(i => <div key={i} style={{width:12,height:12,borderRadius:"50%",background:pin.length>i?"#00C896":T.border2,transition:"all 0.15s"}}/>)}
      </div>
      {error && <div style={{background:"#E6394614",border:"1px solid #E6394630",color:"#E63946",borderRadius:10,padding:"8px 18px",fontSize:12,fontWeight:700,marginBottom:20,textAlign:"center"}}>{error}</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,width:"100%",maxWidth:270}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"<"].map((d,i) => (
          <button key={i} onClick={() => d==="<" ? setPin(p=>p.slice(0,-1)) : d!=="" ? tap(String(d)) : null}
            style={{height:60,borderRadius:14,border:`1px solid ${T.border}`,background:d===""?"transparent":T.card,color:T.text,fontSize:d==="<"?18:22,fontWeight:700,cursor:d===""?"default":"pointer",fontFamily:"inherit"}}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ T, dark, setDark, onPatronLogin, onAgentLogin }) {
  const [mode, setMode] = useState("choose");
  const [step, setStep] = useState("form");
  const [form, setForm] = useState({nom:"",telephone:"",entreprise:"",rc:"",pays:PAYS[0],code:""});
  const [pin1, setPin1] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const F = { width:"100%", background:T.input, border:`1.5px solid ${T.border}`, borderRadius:11, padding:"13px 14px", color:T.text, fontSize:14, outline:"none", boxSizing:"border-box", display:"block", fontFamily:"inherit" };
  const Lbl = ({ children }) => <div style={{fontSize:11,color:T.sub,marginBottom:6,fontWeight:700,letterSpacing:"0.5px"}}>{children}</div>;

  async function patronRegister() {
    if (!form.nom.trim()) { setErr("Nom requis"); return; }
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    if (!form.entreprise.trim()) { setErr("Nom entreprise requis"); return; }
    if (!form.rc.trim()) { setErr("Numero RC requis"); return; }
    const tel = "01"+form.telephone; setBusy(true); setErr("");
    const ex = await api.getPatron(tel); setBusy(false);
    if (ex.ok && ex.data?.length) { setErr("Numero deja utilise"); return; }
    setStep("pin-create");
  }
  async function patronPinCreate(p) { setPin1(p); setStep("pin-confirm"); }
  async function patronPinConfirm(p) {
    if (p !== pin1) { setErr("PIN different"); setStep("pin-create"); return; }
    setBusy(true);
    const hash = await sha256(p); const tel = "01"+form.telephone;
    const res = await api.savePatron({telephone:tel,nom:form.nom.trim(),nom_entreprise:form.entreprise.trim(),registre_commerce:form.rc.trim(),pays:form.pays,pin:hash,phone_verified:true});
    setBusy(false);
    if (!res.ok) { setErr(res.error); setStep("pin-create"); return; }
    ls.set(KEY.patron,{...res.data[0],pin:hash}); onPatronLogin({...res.data[0],pin:hash});
  }
  async function patronLogin() {
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    setBusy(true); const res = await api.getPatron("01"+form.telephone); setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Numero introuvable"); return; }
    ls.set(KEY.patron, res.data[0]); setForm(f=>({...f,_patron:res.data[0]})); setStep("login-pin");
  }
  async function patronLoginPin(p) {
    const patron = form._patron||ls.get(KEY.patron); const hash = await sha256(p);
    if (hash===patron.pin) onPatronLogin({...patron,pin:hash});
    else setErr("PIN incorrect");
  }
  async function agentCode() {
    if (form.code.length!==6) { setErr("Code 6 caracteres"); return; }
    setBusy(true); const res = await api.getInvite(form.code); setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Code invalide ou expire"); return; }
    setForm(f=>({...f,_invite:res.data[0]})); setStep("agent-form");
  }
  async function agentRegister() {
    if (!form.nom.trim()) { setErr("Nom requis"); return; }
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    const tel = "01"+form.telephone; setBusy(true);
    const ex = await api.getAgent(tel); setBusy(false);
    if (ex.ok&&ex.data?.length) { setErr("Numero deja utilise"); return; }
    setStep("agent-pin-create");
  }
  async function agentPinCreate(p) { setPin1(p); setStep("agent-pin-confirm"); }
  async function agentPinConfirm(p) {
    if (p!==pin1) { setErr("PIN different"); setStep("agent-pin-create"); return; }
    setBusy(true); const hash = await sha256(p); const tel = "01"+form.telephone;
    const res = await api.saveAgent({telephone:tel,nom:form.nom.trim(),patron_id:form._invite.patron_id,pin:hash,phone_verified:true});
    if (res.ok&&res.data?.length) await api.useInvite(form.code, res.data[0].id);
    setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Erreur. Reessaie."); return; }
    ls.set(KEY.agent,{...res.data[0],pin:hash}); onAgentLogin({...res.data[0],pin:hash});
  }
  async function agentLogin() {
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    setBusy(true); const res = await api.getAgent("01"+form.telephone); setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Numero introuvable"); return; }
    ls.set(KEY.agent,res.data[0]); setForm(f=>({...f,_agent:res.data[0]})); setStep("agent-login-pin");
  }
  async function agentLoginPin(p) {
    const ag = form._agent||ls.get(KEY.agent); const hash = await sha256(p);
    if (hash===ag.pin) onAgentLogin({...ag,pin:hash});
    else setErr("PIN incorrect");
  }
  async function soloRegister() {
    if (!form.nom.trim()) { setErr("Nom requis"); return; }
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    const tel = "01"+form.telephone; setBusy(true);
    const ex = await api.getAgent(tel); setBusy(false);
    if (ex.ok&&ex.data?.length) { setErr("Numero deja utilise. Connecte-toi."); return; }
    setStep("solo-pin-create");
  }
  async function soloPinCreate(p) { setPin1(p); setStep("solo-pin-confirm"); }
  async function soloPinConfirm(p) {
    if (p!==pin1) { setErr("PIN different"); setStep("solo-pin-create"); return; }
    setBusy(true); const hash = await sha256(p); const tel = "01"+form.telephone;
    const res = await api.saveAgent({telephone:tel,nom:form.nom.trim(),patron_id:null,pin:hash,phone_verified:true});
    setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Erreur. Reessaie."); return; }
    ls.set(KEY.agent,{...res.data[0],pin:hash}); onAgentLogin({...res.data[0],pin:hash});
  }
  async function soloLogin() {
    if (form.telephone.length!==8) { setErr("8 chiffres requis"); return; }
    setBusy(true); const res = await api.getAgent("01"+form.telephone); setBusy(false);
    if (!res.ok||!res.data?.length) { setErr("Numero introuvable"); return; }
    ls.set(KEY.agent,res.data[0]); setForm(f=>({...f,_agent:res.data[0]})); setStep("solo-login-pin");
  }
  async function soloLoginPin(p) {
    const ag = form._agent||ls.get(KEY.agent); const hash = await sha256(p);
    if (hash===ag.pin) onAgentLogin({...ag,pin:hash});
    else setErr("PIN incorrect");
  }

  // PIN screens
  if (mode==="patron"&&step==="pin-create") return <PinPad title="Cree ton PIN" subtitle="4 chiffres secrets" onSubmit={patronPinCreate} T={T}/>;
  if (mode==="patron"&&step==="pin-confirm") return <PinPad title="Confirme ton PIN" subtitle="Retape les 4 chiffres" onSubmit={patronPinConfirm} T={T} error={err}/>;
  if (mode==="patron"&&step==="login-pin") return <PinPad title="Bon retour" subtitle={(form._patron||{}).nom||""} onSubmit={patronLoginPin} T={T} error={err}/>;
  if (mode==="agent"&&step==="agent-pin-create") return <PinPad title="Cree ton PIN" subtitle="4 chiffres secrets" onSubmit={agentPinCreate} T={T}/>;
  if (mode==="agent"&&step==="agent-pin-confirm") return <PinPad title="Confirme ton PIN" subtitle="Retape les 4 chiffres" onSubmit={agentPinConfirm} T={T} error={err}/>;
  if (mode==="agent"&&step==="agent-login-pin") return <PinPad title="Bon retour" subtitle={(form._agent||{}).nom||""} onSubmit={agentLoginPin} T={T} error={err}/>;
  if (mode==="solo"&&step==="solo-pin-create") return <PinPad title="Cree ton PIN" subtitle="4 chiffres secrets" onSubmit={soloPinCreate} T={T}/>;
  if (mode==="solo"&&step==="solo-pin-confirm") return <PinPad title="Confirme ton PIN" subtitle="Retape les 4 chiffres" onSubmit={soloPinConfirm} T={T} error={err}/>;
  if (mode==="solo"&&step==="solo-login-pin") return <PinPad title="Bon retour" subtitle={(form._agent||{}).nom||""} onSubmit={soloLoginPin} T={T} error={err}/>;

  const inp = F;
  const Btn = ({onClick,disabled,children,style={}}) => (
    <button onClick={onClick} disabled={disabled||busy}
      style={{width:"100%",padding:15,borderRadius:12,border:"none",fontWeight:800,fontSize:15,cursor:busy||disabled?"not-allowed":"pointer",opacity:busy||disabled?0.6:1,fontFamily:"inherit",...style}}>
      {busy?"...":children}
    </button>
  );
  const Tab = ({active,onClick,label}) => (
    <button onClick={onClick} style={{flex:1,padding:"9px 0",borderRadius:9,border:"none",background:active?"linear-gradient(135deg,#00C896,#00A5FF)":"transparent",color:active?"#fff":T.sub,fontWeight:active?800:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
      {label}
    </button>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"32px 20px",background:T.bg,width:"100%",boxSizing:"border-box"}}>
      <div style={{width:"100%"}}>

        {/* Logo + titre */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><LogoK size={60}/></div>
          <div style={{fontWeight:900,fontSize:26,color:T.text,letterSpacing:"-0.5px"}}>KASHIO</div>
          <div style={{fontSize:13,color:T.sub,marginTop:4}}>Gestion POS Mobile Money</div>
        </div>

        {/* Choisir profil */}
        {mode==="choose" && (
          <div>
            <div style={{fontSize:11,color:T.sub,fontWeight:700,letterSpacing:"1px",textAlign:"center",marginBottom:16}}>PROFIL</div>
            {[
              {m:"patron",title:"Patron / Boss POS",sub:"Je gere une equipe d'agents",accent:"#00C896"},
              {m:"agent",title:"Agent / Staff",sub:"J'ai un code invitation de mon patron",accent:"#4F8EF7"},
              {m:"solo",title:"Agent independant",sub:"Je travaille seul, sans patron",accent:"#FFB800"},
            ].map(({m,title,sub,accent}) => (
              <button key={m} onClick={()=>{setMode(m);setStep(m==="agent"?"code":"form");setErr("");}}
                style={{width:"100%",padding:16,borderRadius:13,background:T.card,border:`1px solid ${accent}40`,color:T.text,cursor:"pointer",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"inherit"}}>
                <div style={{textAlign:"left"}}>
                  <div style={{fontWeight:800,fontSize:15}}>{title}</div>
                  <div style={{fontSize:12,color:T.sub,marginTop:2}}>{sub}</div>
                </div>
                <div style={{width:8,height:8,borderRadius:"50%",background:accent,flexShrink:0}}/>
              </button>
            ))}
            <button onClick={()=>setDark(d=>!d)} style={{width:"100%",marginTop:8,padding:10,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              {dark?"Mode clair":"Mode sombre"}
            </button>
          </div>
        )}

        {/* Patron inscription / connexion */}
        {mode==="patron" && step==="form" && (
          <div>
            <div style={{display:"flex",gap:6,background:T.hero,borderRadius:11,padding:4,marginBottom:22,border:`1px solid ${T.border}`}}>
              <Tab active={true} onClick={()=>{}} label="Nouveau compte"/>
              <Tab active={false} onClick={()=>{setStep("login");setErr("");}} label="Se connecter"/>
            </div>
            {[["NOM COMPLET","text","Koffi Mensah","nom"],["NOM ENTREPRISE","text","Point Cash Fidjrosse","entreprise"],["NUMERO RC","text","RB/COT/24/B/1234","rc"]].map(([lbl,tp,ph,k])=>(
              <div key={k} style={{marginBottom:12}}>
                <Lbl>{lbl}</Lbl>
                <input type={tp} placeholder={ph} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inp}/>
              </div>
            ))}
            <div style={{marginBottom:12}}>
              <Lbl>NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}}/>
              </div>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>PAYS</Lbl>
              <select value={form.pays} onChange={e=>setForm(f=>({...f,pays:e.target.value}))} style={{...inp,cursor:"pointer"}}>{PAYS.map(p=><option key={p}>{p}</option>)}</select>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={patronRegister} style={{background:"linear-gradient(135deg,#00C896,#00A5FF)",color:"#fff"}}>Creer mon compte</Btn>
            <button onClick={()=>setMode("choose")} style={{width:"100%",marginTop:10,padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

        {mode==="patron" && step==="login" && (
          <div>
            <div style={{display:"flex",gap:6,background:T.hero,borderRadius:11,padding:4,marginBottom:22,border:`1px solid ${T.border}`}}>
              <Tab active={false} onClick={()=>{setStep("form");setErr("");}} label="Nouveau compte"/>
              <Tab active={true} onClick={()=>{}} label="Se connecter"/>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus/>
              </div>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={patronLogin} style={{background:"linear-gradient(135deg,#00C896,#00A5FF)",color:"#fff"}}>Continuer</Btn>
            <button onClick={()=>setMode("choose")} style={{width:"100%",marginTop:10,padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

        {/* Agent code */}
        {mode==="agent" && step==="code" && (
          <div>
            <div style={{textAlign:"center",marginBottom:22}}>
              <div style={{fontWeight:900,fontSize:18,color:T.text}}>Code d'invitation</div>
              <div style={{fontSize:13,color:T.sub,marginTop:4}}>Demande le code a ton patron</div>
            </div>
            <Lbl>CODE (6 CARACTERES)</Lbl>
            <input type="text" placeholder="AB12CD" maxLength={6} value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} autoFocus
              style={{...inp,fontSize:24,fontWeight:800,textAlign:"center",letterSpacing:"8px",marginBottom:8}}/>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={agentCode} disabled={form.code.length!==6} style={{background:form.code.length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero,color:form.code.length===6?"#fff":T.sub,marginBottom:10}}>Valider le code</Btn>
            <div style={{textAlign:"center",marginBottom:10}}>
              <span style={{fontSize:12,color:T.sub}}>Deja un compte ? </span>
              <button onClick={()=>{setStep("agent-login");setErr("");}} style={{background:"none",border:"none",color:"#00C896",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Se connecter</button>
            </div>
            <button onClick={()=>setMode("choose")} style={{width:"100%",padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

        {mode==="agent" && step==="agent-form" && (
          <div>
            <div style={{background:"#00C89614",border:"1px solid #00C89630",borderRadius:11,padding:"11px 14px",marginBottom:18,fontSize:12,color:"#00C896",fontWeight:700,textAlign:"center"}}>Code valide - tu rejoins l'equipe</div>
            <div style={{marginBottom:12}}>
              <Lbl>TON NOM</Lbl>
              <input type="text" placeholder="Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus/>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>TON NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}}/>
              </div>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={agentRegister} style={{background:"linear-gradient(135deg,#00C896,#00A5FF)",color:"#fff"}}>Continuer</Btn>
          </div>
        )}

        {mode==="agent" && step==="agent-login" && (
          <div>
            <div style={{textAlign:"center",marginBottom:22}}>
              <div style={{fontWeight:900,fontSize:18,color:T.text}}>Connexion Agent</div>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>TON NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus/>
              </div>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={agentLogin} style={{background:"linear-gradient(135deg,#00C896,#00A5FF)",color:"#fff"}}>Continuer</Btn>
            <button onClick={()=>setMode("choose")} style={{width:"100%",marginTop:10,padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

        {/* Solo */}
        {mode==="solo" && step==="form" && (
          <div>
            <div style={{display:"flex",gap:6,background:T.hero,borderRadius:11,padding:4,marginBottom:22,border:`1px solid ${T.border}`}}>
              <Tab active={true} onClick={()=>{}} label="Nouveau compte"/>
              <Tab active={false} onClick={()=>{setStep("solo-login");setErr("");}} label="Se connecter"/>
            </div>
            <div style={{marginBottom:12}}>
              <Lbl>TON NOM</Lbl>
              <input type="text" placeholder="Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus/>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>TON NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}}/>
              </div>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={soloRegister} style={{background:"linear-gradient(135deg,#FFB800,#E09000)",color:"#fff"}}>Creer mon compte</Btn>
            <button onClick={()=>setMode("choose")} style={{width:"100%",marginTop:10,padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

        {mode==="solo" && step==="solo-login" && (
          <div>
            <div style={{display:"flex",gap:6,background:T.hero,borderRadius:11,padding:4,marginBottom:22,border:`1px solid ${T.border}`}}>
              <Tab active={false} onClick={()=>{setStep("form");setErr("");}} label="Nouveau compte"/>
              <Tab active={true} onClick={()=>{}} label="Se connecter"/>
            </div>
            <div style={{marginBottom:20}}>
              <Lbl>TON NUMERO</Lbl>
              <div style={{display:"flex",gap:8}}>
                <div style={{...inp,width:"auto",flexShrink:0,padding:"13px 11px",fontWeight:800,fontSize:13}}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus/>
              </div>
            </div>
            {err&&<div style={{background:"#E6394614",color:"#E63946",borderRadius:9,padding:"9px 13px",fontSize:12,fontWeight:700,marginBottom:12}}>{err}</div>}
            <Btn onClick={soloLogin} style={{background:"linear-gradient(135deg,#FFB800,#E09000)",color:"#fff"}}>Continuer</Btn>
            <button onClick={()=>setMode("choose")} style={{width:"100%",marginTop:10,padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Retour</button>
          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Kashio() {
  const [dark, setDark] = useState(true);
  const T = dark ? DARK : LIGHT;
  const OPB = dark
    ? {MTN:"#FFB80018",MOOV:"#0066CC18",Celtiis:"#91d84518"}
    : {MTN:"#FFB80022",MOOV:"#0066CC18",Celtiis:"#91d84520"};

  const [patron, setPatron] = useState(ls.get(KEY.patron));
  const [agent, setAgent]   = useState(ls.get(KEY.agent));
  const [locked, setLocked] = useState(!!(ls.get(KEY.patron)||ls.get(KEY.agent)));
  const [pinErr, setPinErr] = useState("");
  const [pinTries, setPinTries] = useState(0);
  const [pinBlocked, setPinBlocked] = useState(false);

  const [tab, setTab]       = useState("home");
  const [busy, setBusy]     = useState(false);
  const [selDate, setSelDate] = useState(today());
  const [calMonth, setCalMonth] = useState(new Date().getMonth()+1);
  const [calYear, setCalYear]   = useState(new Date().getFullYear());
  const [showCal, setShowCal]   = useState(false);
  const [hide, setHide]         = useState(false);  // masquer les chiffres

  // patron data
  const [agents, setAgents]     = useState([]);
  const [allTxs, setAllTxs]     = useState([]);
  const [allFloats, setAllFloats] = useState([]);
  const [selAgent, setSelAgent]  = useState(null);
  const [invCode, setInvCode]    = useState(null);
  const [delAgent, setDelAgent]  = useState(null);
  const [delBusy, setDelBusy]    = useState(false);

  // agent data
  const [txs, setTxs]             = useState([]);
  const [pending, setPending]     = useState(0);
  const [floats, setFloats]       = useState({MTN:null,MOOV:null,Celtiis:null});
  const [cash, setCash]           = useState(null);
  const [showMorning, setShowMorning] = useState(false);
  const [morning, setMorning]     = useState({cash:"",MTN:"",MOOV:"",Celtiis:""});
  const [showClose, setShowClose] = useState(false);
  const [closeIn, setCloseIn]     = useState({cash:"",MTN:"",MOOV:"",Celtiis:""});
  const [closeResult, setCloseResult] = useState(null);

  // transaction modal
  const [modal, setModal]   = useState(null); // "depot"|"retrait"|"forfait"
  const [mForm, setMForm]   = useState({});
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(null);
  const [flashErr, setFlashErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmOut, setConfirmOut] = useState(false);

  const isPatron = !!patron;
  const isAgent  = !!agent;
  const isToday  = selDate === today();

  // ── EFFECTS ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const bg = dark?"#060810":"#F2F4FA";
    document.documentElement.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;`;
    document.body.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;`;
  }, [dark]);

  useEffect(() => {
    document.title = "KASHIO";
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="22" fill="#060810"/><rect x="28" y="22" width="10" height="56" rx="5" fill="#00C896"/><path d="M38 50 Q58 36 74 22" fill="none" stroke="#00C896" stroke-width="10" stroke-linecap="round"/><path d="M38 50 Q58 64 74 78" fill="none" stroke="#00A5FF" stroke-width="10" stroke-linecap="round"/></svg>`;
    const url = "data:image/svg+xml,"+encodeURIComponent(svg);
    document.querySelectorAll('link[rel*="icon"]').forEach(e=>e.remove());
    const l=document.createElement("link"); l.rel="icon"; l.href=url; document.head.appendChild(l);
  }, []);

  useEffect(() => { if (patron&&!locked) loadPatron(); }, [patron,locked,selDate]);
  useEffect(() => {
    if (!patron||locked) return;
    const iv=setInterval(()=>loadPatron(),30000); return ()=>clearInterval(iv);
  }, [patron,locked,selDate]);
  useEffect(() => {
    if (agent&&!locked) { loadTxs(selDate); loadFloats(selDate); }
  }, [agent,locked,selDate]);
  useEffect(() => {
    if (!agent||locked||selDate!==today()) return;
    const sf=ls.get(KEY.floats(selDate,agent.id||agent.telephone));
    const sc=ls.get(KEY.cash(selDate,agent.id||agent.telephone));
    if ((!sf||Object.values(sf).every(v=>v===null))&&(sc===null||sc===undefined)) setShowMorning(true);
  }, [agent,locked,selDate]);
  useEffect(() => {
    if (!agent) return;
    const sync = async () => {
      const pend=ls.get(KEY.pending(agent.id||agent.telephone));
      if (!pend?.length) return;
      const synced=[];
      for(const tx of pend){ const r=await api.saveTx(tx); if(r.ok) synced.push(tx.localId); }
      if(synced.length) { ls.set(KEY.pending(agent.id||agent.telephone),pend.filter(t=>!synced.includes(t.localId))); loadTxs(selDate); }
    };
    window.addEventListener("online",sync); sync();
    return ()=>window.removeEventListener("online",sync);
  }, [agent]);

  // ── DATA FUNCTIONS ──────────────────────────────────────────────────────────
  async function loadPatron() {
    setBusy(true);
    const ra = await api.getAgents(patron.id);
    if (ra.ok&&ra.data?.length) setAgents(ra.data);
    const aids = (ra.ok?ra.data:[]).map(a=>a.id).filter(Boolean);
    const [rt,rf] = await Promise.all([api.getAllTxs(patron.id,selDate,aids),api.getAllFloats(patron.id,selDate,aids)]);
    if (rt.ok) setAllTxs(rt.data||[]);
    if (rf.ok) setAllFloats(rf.data||[]);
    setBusy(false);
  }
  async function loadTxs(date) {
    setBusy(true);
    const uid=agent.id||agent.telephone; const k=KEY.txs(date,uid);
    const cached=ls.get(k)||[];
    if(cached.length) setTxs(cached);
    const r=await api.getTxs(uid,date);
    if(r.ok&&r.data?.length){ setTxs(r.data); ls.set(k,r.data); }
    else if(!cached.length) setTxs([]);
    setBusy(false);
  }
  function loadFloats(date) {
    const uid=agent.id||agent.telephone;
    const sf=ls.get(KEY.floats(date,uid)); setFloats(sf||{MTN:null,MOOV:null,Celtiis:null});
    const sc=ls.get(KEY.cash(date,uid)); setCash(sc!==null&&sc!==undefined?Number(sc):null);
  }
  function saveFloatLocal(op,val) {
    const uid=agent.id||agent.telephone;
    const updated={...floats,[op]:Number(val)};
    setFloats(updated); ls.set(KEY.floats(selDate,uid),updated);
    api.saveFloat({agent_id:agent.id,patron_id:agent.patron_id||null,date:selDate,cash:cash||0,float_mtn:updated.MTN,float_moov:updated.MOOV,float_celtiis:updated.Celtiis});
  }

  // ── CALCULS ─────────────────────────────────────────────────────────────────
  function calcCash() {
    if (cash===null) return null;
    const d=txs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const r=txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const f=txs.filter(t=>t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0);
    return cash+d-r+f;
  }
  function calcFloat(op) {
    if (floats[op]===null||floats[op]===undefined) return null;
    const d=txs.filter(t=>t.operateur===op&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const r=txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const f=txs.filter(t=>t.operateur===op&&t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0);
    return floats[op]-d+r-f;
  }
  function ptMatin() {
    if (cash===null) return null;
    const mt=floats?Number(floats.MTN||0)+Number(floats.MOOV||0)+Number(floats.Celtiis||0):0;
    return cash+mt;
  }
  // Point du soir attendu = Point du matin (capital conserve)
  // La difference = frais de retrait (argent supplementaire gagne)
  function ptSoir() { return ptMatin(); }
  function gainJour() { return txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0); }

  function agentStats(aid) {
    const atx=allTxs.filter(t=>t.agent_id===aid);
    const fl=allFloats.find(f=>f.agent_id===aid)||null;
    const deps=atx.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const rets=atx.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const forf=atx.filter(t=>t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0);
    const com=atx.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
    const cashD=fl?Number(fl.cash||0):null;
    const momoD=fl?Number(fl.float_mtn||0)+Number(fl.float_moov||0)+Number(fl.float_celtiis||0):null;
    const pMatin=cashD!==null&&momoD!==null?cashD+momoD:null;
    const cF=(op,col)=>fl?Number(fl[`float_${col}`]||0)-atx.filter(t=>t.operateur===op&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+atx.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0)-atx.filter(t=>t.operateur===op&&t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0):null;
    return {deps,rets,forf,com,nb:atx.length,pMatin,mtn:cF("MTN","mtn"),moov:cF("MOOV","moov"),celt:cF("Celtiis","celtiis"),cashD,cashActuel:cashD!==null?cashD+deps-rets+forf:null,fl};
  }

  // ── AUTH HANDLERS ────────────────────────────────────────────────────────────
  async function handleUnlock(pin) {
    if (pinBlocked) { setPinErr("Bloque 5 min"); return; }
    const user=patron||agent; const hash=await sha256(pin);
    if (hash===user.pin) {
      setLocked(false); setPinErr(""); setPinTries(0);
      if(isPatron) api.getPatron(patron.telephone).then(r=>{if(r.ok&&r.data?.length){const t={...r.data[0],pin:patron.pin};ls.set(KEY.patron,t);setPatron(t);}});
      if(isAgent)  api.getAgent(agent.telephone).then(r=>{if(r.ok&&r.data?.length){const t={...r.data[0],pin:agent.pin};ls.set(KEY.agent,t);setAgent(t);}});
    } else {
      const n=pinTries+1; setPinTries(n);
      if(n>=3){ setPinBlocked(true); setPinErr("3 tentatives - bloque 5 min"); setTimeout(()=>{setPinBlocked(false);setPinTries(0);setPinErr("");},300000); }
      else setPinErr(`PIN incorrect - ${3-n} essai${3-n>1?"s":""} restant${3-n>1?"s":""}`);
    }
  }
  function logout() { ls.del(KEY.patron);ls.del(KEY.agent);setPatron(null);setAgent(null);setLocked(false);setTab("home");setConfirmOut(false); }

  // ── TRANSACTION ──────────────────────────────────────────────────────────────
  async function addTx() {
    if(!mForm.operateur||!mForm.montant) return;
    if(modal==="forfait"&&!mForm.forfait_type) return;
    setSaving(true);
    const uid=agent.id||agent.telephone;
    const com=modal==="retrait"?frais(mForm.operateur,Number(mForm.montant)):0;
    const localId=Date.now();
    const tx={agent_id:agent.id,patron_id:agent.patron_id||null,type:modal,operateur:mForm.operateur,montant:Number(mForm.montant),commission:com,telephone:mForm.telephone?`01${mForm.telephone}`:null,sous_type:mForm.forfait_type||null,heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),created_at:nowISO(),localId};
    const opt={...tx,id:localId};
    setTxs(p=>[opt,...p]);
    const r=await api.saveTx(tx);
    if(r.ok){ setTxs(p=>p.map(t=>t.id===localId?r.data[0]:t)); }
    else {
      setFlashErr(r.error); setTimeout(()=>setFlashErr(null),5000);
      const pend=ls.get(KEY.pending(uid))||[]; ls.set(KEY.pending(uid),[...pend,tx]); setPending(c=>c+1);
    }
    const cached=ls.get(KEY.txs(selDate,uid))||[];
    ls.set(KEY.txs(selDate,uid),[(r.ok?r.data[0]:opt),...cached]);
    setSaving(false); setModal(null); setMForm({});
    if(r.ok){ setFlash(modal); setTimeout(()=>setFlash(null),2000); }
    setTimeout(()=>loadTxs(selDate),1200);
  }
  async function removeTx(id) {
    await api.delTx(id);
    const updated=txs.filter(t=>t.id!==id); setTxs(updated);
    ls.set(KEY.txs(selDate,agent.id||agent.telephone),updated); setConfirmDel(null);
  }

  // ── GUARDS ───────────────────────────────────────────────────────────────────
  if (!patron&&!agent) return <AuthScreen T={T} dark={dark} setDark={setDark}
    onPatronLogin={p=>{setPatron(p);ls.set(KEY.patron,p);setLocked(false);setTab("home");}}
    onAgentLogin={a=>{setAgent(a);ls.set(KEY.agent,a);setLocked(false);setTab("home");}}/>;
  if (locked) return <PinPad title="Bon retour" subtitle={(patron||agent).nom} onSubmit={handleUnlock} T={T} error={pinErr}/>;

  // ── COMPUTED ─────────────────────────────────────────────────────────────────
  const totalFrais = allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
  const totalDeps  = allTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
  const totalRets  = allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
  const totalForf  = allTxs.filter(t=>t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0);
  const agentsActifs = agents.filter(ag=>allTxs.some(t=>t.agent_id===ag.id));
  const totalPMatin  = agents.map(ag=>agentStats(ag.id)).reduce((s,st)=>s+(st.pMatin||0),0);

  const agentTotalCA  = txs.reduce((s,t)=>s+Number(t.montant),0);
  const agentGain     = gainJour();
  const agentPt       = ptMatin();
  const agentCashNow  = calcCash();

  const NAV_P = [["home","Dashboard"],["agents","Agents"],["profil","Profil"]];
  const NAV_A = [["home","Accueil"],["history","Historique"],["profil","Profil"]];
  const NAV   = isPatron?NAV_P:NAV_A;

  // ── STYLES COMMUNS ───────────────────────────────────────────────────────────
  const card = {background:T.card,borderRadius:16,border:`1px solid ${T.border}`};
  const val = (n,colored=false) => hide ? mask() : fF(n);
  const MWrap = {position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"flex-end",zIndex:200};
  const MBox  = {width:"100%",background:T.card,borderRadius:"20px 20px 0 0",padding:"14px 18px 44px",maxHeight:"88vh",overflowY:"auto"};

  return (
    <>
      <style>{`*,*::before,*::after{box-sizing:border-box!important;}html,body{margin:0!important;padding:0!important;}body{width:100vw!important;max-width:100%!important;overflow-x:hidden!important;}button,input,select{font-family:inherit;}button{-webkit-tap-highlight-color:transparent;}`}</style>
      <div style={{background:T.bg,minHeight:"100vh",width:"100vw",maxWidth:"100%",color:T.text,fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif",overflowX:"hidden"}}>

        {/* FLASH */}
        {flash && <div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:flash==="depot"?"#00C896":flash==="retrait"?"#4F8EF7":"#A855F7",color:"#fff",borderRadius:12,padding:"10px 24px",fontWeight:800,fontSize:13,zIndex:9999,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>{flash==="depot"?"Depot enregistre":flash==="retrait"?"Retrait enregistre":"Forfait enregistre"}</div>}
        {flashErr && <div style={{position:"fixed",top:18,left:"50%",transform:"translateX(-50%)",background:"#E63946",color:"#fff",borderRadius:12,padding:"10px 20px",fontWeight:700,fontSize:12,zIndex:9999,maxWidth:"88vw",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>{flashErr}</div>}

        {/* HEADER */}
        <header style={{background:T.card,padding:"12px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:50}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <LogoK size={32}/>
            <div>
              <div style={{fontWeight:900,fontSize:15,letterSpacing:"-0.3px"}}>KASHIO</div>
              <div style={{fontSize:10,color:T.sub}}>{isPatron?patron.nom_entreprise:agent.nom}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {isAgent&&pending>0&&<div style={{background:"#FFB80018",color:"#FFB800",borderRadius:7,padding:"3px 8px",fontSize:10,fontWeight:700}}>{pending} attente</div>}
            <button onClick={()=>setHide(h=>!h)} style={{background:T.hero,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:12,color:T.sub,fontWeight:700}}>
              {hide?"Voir":"Cacher"}
            </button>
            {isAgent&&<button onClick={()=>setShowCal(true)} style={{background:T.hero,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:13,color:T.text}}>Cal</button>}
            <button onClick={()=>setDark(d=>!d)} style={{background:T.hero,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:12,color:T.sub}}>
              {dark?"Clair":"Sombre"}
            </button>
          </div>
        </header>

        {/* DATE BANNER */}
        {!isToday&&<div style={{background:"#4F8EF718",borderBottom:`1px solid #4F8EF730`,padding:"8px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#4F8EF7"}}>{new Date(selDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
          <button onClick={()=>setSelDate(today())} style={{background:"#4F8EF7",border:"none",borderRadius:7,padding:"4px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Aujourd'hui</button>
        </div>}

        {/* MAIN */}
        <main style={{padding:"16px 16px 110px",width:"100%",boxSizing:"border-box"}}>

          {/* ══ DASHBOARD PATRON ══════════════════════════════════════════════ */}
          {isPatron&&tab==="home"&&!selAgent&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div>
                  <div style={{fontWeight:900,fontSize:20,letterSpacing:"-0.3px"}}>Dashboard</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:2}}>{selDate===today()?"Aujourd'hui":new Date(selDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowCal(true)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 12px",cursor:"pointer",fontSize:12,color:T.text,fontWeight:600}}>Cal</button>
                  <button onClick={loadPatron} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 12px",cursor:"pointer",fontSize:12,color:T.sub}}>Sync</button>
                </div>
              </div>

              {/* 5 CARDS PATRON */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>

                {/* Card 1: Capital total equipe */}
                <div style={{...card,padding:"16px 14px",gridColumn:"1/-1"}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,letterSpacing:"0.8px",marginBottom:8}}>CAPITAL EQUIPE</div>
                  <div style={{fontSize:32,fontWeight:900,color:"#00C896",letterSpacing:"-0.5px"}}>{hide?mask():fF(totalPMatin)}</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:4}}>{agents.length} agent{agents.length>1?"s":""} · {agentsActifs.length} actif{agentsActifs.length>1?"s":""}</div>
                </div>

                {/* Card 2: Frais retrait */}
                <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #FFB800`}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:6}}>FRAIS</div>
                  <div style={{fontSize:20,fontWeight:900,color:"#FFB800"}}>{hide?mask():fF(totalFrais)}</div>
                  <div style={{fontSize:10,color:T.faint,marginTop:2}}>{allTxs.filter(t=>t.type==="retrait").length} retraits</div>
                </div>

                {/* Card 3: Depots */}
                <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #00C896`}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:6}}>DEPOTS</div>
                  <div style={{fontSize:20,fontWeight:900,color:"#00C896"}}>{hide?mask():fF(totalDeps)}</div>
                  <div style={{fontSize:10,color:T.faint,marginTop:2}}>{allTxs.filter(t=>t.type==="depot").length} operations</div>
                </div>

                {/* Card 4: Retraits */}
                <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #4F8EF7`}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:6}}>RETRAITS</div>
                  <div style={{fontSize:20,fontWeight:900,color:"#4F8EF7"}}>{hide?mask():fF(totalRets)}</div>
                  <div style={{fontSize:10,color:T.faint,marginTop:2}}>{allTxs.filter(t=>t.type==="retrait").length} operations</div>
                </div>

                {/* Card 5: Forfaits si presents */}
                {totalForf>0&&(
                  <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #A855F7`,gridColumn:"1/-1"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:6}}>FORFAITS</div>
                    <div style={{fontSize:20,fontWeight:900,color:"#A855F7"}}>{hide?mask():fF(totalForf)}</div>
                    <div style={{fontSize:10,color:T.faint,marginTop:2}}>{allTxs.filter(t=>t.type==="forfait").length} ventes</div>
                  </div>
                )}
              </div>

              {/* Liste agents */}
              <div style={{fontSize:11,color:T.sub,fontWeight:700,letterSpacing:"0.8px",marginBottom:10}}>AGENTS</div>
              {busy&&!agents.length&&<div style={{textAlign:"center",color:T.faint,padding:24,fontSize:13}}>Chargement...</div>}
              {!busy&&agents.length===0&&<div style={{...card,padding:20,textAlign:"center"}}><div style={{fontSize:12,color:T.sub}}>Aucun agent. Ajoute-en dans Agents.</div></div>}
              {agents.map(ag=>{
                const s=agentStats(ag.id);
                return (
                  <div key={ag.id} onClick={()=>setSelAgent(ag)}
                    style={{...card,padding:"13px 15px",marginBottom:8,borderLeft:`3px solid ${s.nb>0?"#00C896":"#1C2032"}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:14}}>{ag.nom}</div>
                      <div style={{fontSize:11,color:T.sub,marginTop:2}}>{s.nb>0?`${s.nb} op · Frais ${fF(s.com)}`:"Aucune operation"}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:17,fontWeight:900,color:s.nb>0?"#00C896":T.faint}}>{hide?mask():(s.pMatin!==null?fF(s.pMatin):"—")}</div>
                      <div style={{fontSize:9,color:T.faint}}>Capital</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ DETAIL AGENT (PATRON) ═══════════════════════════════════════ */}
          {isPatron&&tab==="home"&&selAgent&&(()=>{
            const s=agentStats(selAgent.id);
            return (
              <div>
                <button onClick={()=>setSelAgent(null)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 14px",color:T.text,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:18}}>Retour</button>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div>
                    <div style={{fontWeight:900,fontSize:18}}>{selAgent.nom}</div>
                    <div style={{fontSize:12,color:T.sub}}>+229 {selAgent.telephone}</div>
                  </div>
                  <div style={{background:s.nb>0?"#00C89618":"#1C203240",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:800,color:s.nb>0?"#00C896":T.sub}}>{s.nb>0?"Actif":"Inactif"}</div>
                </div>

                {/* 5 cards agent detail */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div style={{...card,padding:"14px",gridColumn:"1/-1"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:6}}>CAPITAL DU MATIN</div>
                    <div style={{fontSize:28,fontWeight:900,color:T.text}}>{hide?mask():(s.pMatin!==null?fF(s.pMatin):"—")}</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:4}}>Cash {fF(s.cashD||0)} + MoMo {s.fl?fF(Number(s.fl.float_mtn||0)+Number(s.fl.float_moov||0)+Number(s.fl.float_celtiis||0)):"—"}</div>
                  </div>
                  <div style={{...card,padding:"14px",borderLeft:"3px solid #00C896"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:4}}>DEPOTS</div>
                    <div style={{fontSize:18,fontWeight:900,color:"#00C896"}}>{hide?mask():fF(s.deps)}</div>
                  </div>
                  <div style={{...card,padding:"14px",borderLeft:"3px solid #4F8EF7"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:4}}>RETRAITS</div>
                    <div style={{fontSize:18,fontWeight:900,color:"#4F8EF7"}}>{hide?mask():fF(s.rets)}</div>
                  </div>
                  <div style={{...card,padding:"14px",borderLeft:"3px solid #FFB800"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:4}}>FRAIS</div>
                    <div style={{fontSize:18,fontWeight:900,color:"#FFB800"}}>{hide?mask():fF(s.com)}</div>
                  </div>
                  {s.forf>0&&(
                    <div style={{...card,padding:"14px",borderLeft:"3px solid #A855F7"}}>
                      <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:4}}>FORFAITS</div>
                      <div style={{fontSize:18,fontWeight:900,color:"#A855F7"}}>{hide?mask():fF(s.forf)}</div>
                    </div>
                  )}
                </div>

                {/* Floats par operateur */}
                <div style={{fontSize:11,color:T.sub,fontWeight:700,letterSpacing:"0.8px",marginBottom:8}}>COMPTES MOMO</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                  {[{op:"MTN",a:s.mtn,d:s.fl?Number(s.fl.float_mtn||0):null},{op:"MOOV",a:s.moov,d:s.fl?Number(s.fl.float_moov||0):null},{op:"Celtiis",a:s.celt,d:s.fl?Number(s.fl.float_celtiis||0):null}].map(({op,a,d})=>(
                    <div key={op} style={{...card,padding:"12px 10px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:OPC[op],fontWeight:800,marginBottom:5}}>{op}</div>
                      <div style={{fontSize:14,fontWeight:900,color:a!==null&&a<0?"#E63946":a!==null&&d>0&&a/d<0.15?"#FFB800":"#00C896"}}>{a!==null?(hide?mask():fF(a)):"—"}</div>
                      {d!==null&&<div style={{fontSize:9,color:T.faint,marginTop:2}}>{fF(d)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ══ AGENTS TAB (PATRON) ══════════════════════════════════════════ */}
          {isPatron&&tab==="agents"&&(
            <div>
              <div style={{fontWeight:900,fontSize:20,marginBottom:18}}>Agents ({agents.length}/10)</div>
              <div style={{...card,padding:18,marginBottom:18}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:8}}>Ajouter un agent</div>
                <div style={{fontSize:12,color:T.sub,marginBottom:14}}>Genere un code unique a donner a ton agent.</div>
                {invCode?(
                  <div>
                    <div style={{background:"#00C89614",border:"1px solid #00C89630",borderRadius:10,padding:18,textAlign:"center",marginBottom:12}}>
                      <div style={{fontSize:11,color:T.sub,marginBottom:6}}>CODE D'INVITATION</div>
                      <div style={{fontSize:34,fontWeight:900,color:"#00C896",letterSpacing:"8px"}}>{invCode}</div>
                      <div style={{fontSize:11,color:T.sub,marginTop:6}}>Usage unique</div>
                    </div>
                    <button onClick={()=>navigator.clipboard?.writeText(invCode)} style={{width:"100%",padding:11,borderRadius:11,background:T.hero,border:`1px solid ${T.border}`,color:T.text,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:8}}>Copier le code</button>
                    <button onClick={()=>setInvCode(null)} style={{width:"100%",padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:12,cursor:"pointer"}}>Generer un autre</button>
                  </div>
                ):(
                  <button disabled={agents.length>=10} onClick={async()=>{const c=Math.random().toString(36).substring(2,8).toUpperCase();const r=await api.createInvite(c,patron.id);if(r.ok)setInvCode(c);}}
                    style={{width:"100%",padding:14,borderRadius:11,background:agents.length>=10?T.hero:"linear-gradient(135deg,#00C896,#00A5FF)",border:"none",color:agents.length>=10?T.sub:"#fff",fontWeight:800,fontSize:14,cursor:agents.length>=10?"not-allowed":"pointer"}}>
                    {agents.length>=10?"Maximum 10 agents":"Generer un code"}
                  </button>
                )}
              </div>
              {agents.map(ag=>(
                <div key={ag.id} style={{...card,padding:"13px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontWeight:700}}>{ag.nom}</div><div style={{fontSize:12,color:T.sub}}>+229 {ag.telephone}</div></div>
                  <button onClick={()=>setDelAgent(ag)} style={{background:"#E6394614",border:"1px solid #E6394630",borderRadius:8,padding:"6px 10px",color:"#E63946",fontSize:12,cursor:"pointer",fontWeight:700}}>Suppr.</button>
                </div>
              ))}
            </div>
          )}

          {/* ══ DASHBOARD AGENT ══════════════════════════════════════════════ */}
          {isAgent&&tab==="home"&&(
            <div>
              <div style={{marginBottom:18}}>
                <div style={{fontWeight:900,fontSize:20,letterSpacing:"-0.3px"}}>{agent.nom}</div>
                <div style={{fontSize:11,color:T.sub,marginTop:2}}>{isToday?"Aujourd'hui":new Date(selDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
              </div>

              {/* Card 1: Capital total (le plus important) */}
              <div style={{...card,padding:"20px 18px",marginBottom:12,borderTop:`3px solid #00C896`}}>
                <div style={{fontSize:10,color:T.sub,fontWeight:700,letterSpacing:"0.8px",marginBottom:8}}>POINT DU MATIN (= POINT DU SOIR ATTENDU)</div>
                {agentPt!==null?(
                  <div>
                    <div style={{fontSize:36,fontWeight:900,color:T.text,letterSpacing:"-0.5px"}}>{hide?mask():fF(agentPt)}</div>
                    <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                      <div><div style={{fontSize:9,color:T.faint}}>Cash depart</div><div style={{fontSize:12,fontWeight:800,color:T.sub}}>{hide?mask():fF(cash||0)}</div></div>
                      <div><div style={{fontSize:9,color:T.faint}}>MoMo total</div><div style={{fontSize:12,fontWeight:800,color:T.sub}}>{hide?mask():fF(floats?(Number(floats.MTN||0)+Number(floats.MOOV||0)+Number(floats.Celtiis||0)):0)}</div></div>
                    </div>
                  </div>
                ):(
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:T.sub,marginBottom:12}}>Renseigne tes fonds du matin</div>
                    {isToday&&<button onClick={()=>{setMorning({cash:"",MTN:"",MOOV:"",Celtiis:""});setShowMorning(true);}} style={{padding:"10px 20px",borderRadius:11,background:"linear-gradient(135deg,#00C896,#00A5FF)",border:"none",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer"}}>Commencer</button>}
                  </div>
                )}
              </div>

              {/* 4 cards operationnelles */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                {/* Cash actuel */}
                <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #00C896`}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:5}}>CASH ACTUEL</div>
                  <div style={{fontSize:20,fontWeight:900,color:agentCashNow!==null&&agentCashNow<0?"#E63946":"#00C896"}}>{agentCashNow!==null?(hide?mask():fF(agentCashNow)):"—"}</div>
                  {cash!==null&&<div style={{fontSize:9,color:T.faint,marginTop:2}}>Depart {fF(cash)}</div>}
                </div>

                {/* Frais gagnes */}
                <div style={{...card,padding:"14px 13px",borderLeft:`3px solid #FFB800`}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:5}}>FRAIS GAGNES</div>
                  <div style={{fontSize:20,fontWeight:900,color:"#FFB800"}}>{hide?mask():fF(agentGain)}</div>
                  <div style={{fontSize:9,color:T.faint,marginTop:2}}>{txs.filter(t=>t.type==="retrait").length} retrait{txs.filter(t=>t.type==="retrait").length>1?"s":""}</div>
                </div>

                {/* MoMo MTN */}
                {floats.MTN!==null&&(
                  <div style={{...card,padding:"14px 13px",borderLeft:`3px solid ${OPC.MTN}`}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:5}}>MTN</div>
                    <div style={{fontSize:18,fontWeight:900,color:calcFloat("MTN")!==null&&calcFloat("MTN")<0?"#E63946":OPC.MTN}}>{hide?mask():fF(calcFloat("MTN"))}</div>
                    <div style={{fontSize:9,color:T.faint,marginTop:2}}>Depart {fF(floats.MTN)}</div>
                  </div>
                )}
                {/* MoMo MOOV */}
                {floats.MOOV!==null&&(
                  <div style={{...card,padding:"14px 13px",borderLeft:`3px solid ${OPC.MOOV}`}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:5}}>MOOV</div>
                    <div style={{fontSize:18,fontWeight:900,color:calcFloat("MOOV")!==null&&calcFloat("MOOV")<0?"#E63946":OPC.MOOV}}>{hide?mask():fF(calcFloat("MOOV"))}</div>
                    <div style={{fontSize:9,color:T.faint,marginTop:2}}>Depart {fF(floats.MOOV)}</div>
                  </div>
                )}
                {floats.Celtiis!==null&&(
                  <div style={{...card,padding:"14px 13px",borderLeft:`3px solid ${OPC.Celtiis}`,gridColumn:floats.MTN===null&&floats.MOOV===null?"1/-1":"auto"}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:5}}>CELTIIS</div>
                    <div style={{fontSize:18,fontWeight:900,color:calcFloat("Celtiis")!==null&&calcFloat("Celtiis")<0?"#E63946":OPC.Celtiis}}>{hide?mask():fF(calcFloat("Celtiis"))}</div>
                    <div style={{fontSize:9,color:T.faint,marginTop:2}}>Depart {fF(floats.Celtiis)}</div>
                  </div>
                )}
              </div>

              {/* Bouton terminer la journee */}
              {isToday&&agentPt!==null&&(
                <button onClick={()=>{setCloseIn({cash:"",MTN:"",MOOV:"",Celtiis:""});setCloseResult(null);setShowClose(true);}}
                  style={{width:"100%",padding:15,borderRadius:13,background:"linear-gradient(135deg,#1A2A6C,#2541B2)",border:"none",color:"#fff",fontWeight:900,fontSize:15,cursor:"pointer",marginBottom:14,letterSpacing:"-0.2px"}}>
                  Terminer la journee
                </button>
              )}

              {/* Resultat cloture */}
              {closeResult&&(()=>{
                const diff=closeResult.total-closeResult.attendu;
                const ok=Math.abs(diff)<=500;
                const c=ok?"#00C896":diff>0?"#FFB800":"#E63946";
                return (
                  <div style={{background:`${c}12`,borderRadius:12,padding:"10px 14px",marginBottom:14,border:`1px solid ${c}30`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:12,fontWeight:700,color:c}}>{ok?"Equilibre":diff>0?"Excedent":"Manquant"}</div>
                    <div style={{fontSize:16,fontWeight:900,color:c}}>{diff>0?"+":""}{fF(diff)}</div>
                  </div>
                );
              })()}

              {/* Operations */}
              <div style={{...card,padding:"14px 15px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:txs.length?12:0}}>
                  <div style={{fontWeight:700,fontSize:13}}>Operations du jour</div>
                  {txs.length>0&&<div style={{fontSize:11,color:T.sub}}>{txs.length}</div>}
                </div>
                {busy&&!txs.length&&<div style={{textAlign:"center",color:T.faint,padding:18,fontSize:13}}>...</div>}
                {!busy&&txs.length===0&&<div style={{textAlign:"center",color:T.faint,padding:"20px 0",fontSize:13}}>{isToday?"Enregistre une operation":"Aucune operation"}</div>}
                {txs.slice(0,10).map((t,i)=>{
                  const ft=t.type==="forfait"?FORFAIT_TYPES.find(f=>f.key===t.sous_type):null;
                  const tc={depot:"#00C896",retrait:"#4F8EF7",forfait:"#A855F7"}[t.type];
                  return (
                    <div key={t.id||t.localId} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<Math.min(txs.length,10)-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:tc,flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.text}}>
                          {t.type==="forfait"?(ft?ft.label:"Forfait"):{depot:"Depot",retrait:"Retrait"}[t.type]}
                          <span style={{color:OPC[t.operateur],fontSize:12,marginLeft:6}}>{t.operateur}</span>
                        </div>
                        <div style={{fontSize:10,color:T.faint}}>{t.telephone||"—"} · {t.heure}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontWeight:800,color:tc,fontSize:13}}>{hide?mask():fF(t.montant)}</div>
                        {t.commission>0&&<div style={{fontSize:10,color:"#FFB800"}}>+{fF(t.commission)}</div>}
                      </div>
                      {isToday&&<button onClick={()=>setConfirmDel(t.id)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:12,padding:"0 2px",opacity:0.6}}>x</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══ HISTORIQUE AGENT ════════════════════════════════════════════ */}
          {isAgent&&tab==="history"&&(
            <div>
              <div style={{fontWeight:900,fontSize:20,marginBottom:18}}>Historique</div>
              {busy&&<div style={{textAlign:"center",color:T.faint,padding:36}}>...</div>}
              {!busy&&txs.length===0&&<div style={{textAlign:"center",color:T.faint,padding:48,fontSize:14}}>Aucune operation {isToday?"":"ce jour"}</div>}
              {txs.map(t=>{
                const ft=t.type==="forfait"?FORFAIT_TYPES.find(f=>f.key===t.sous_type):null;
                const tc={depot:"#00C896",retrait:"#4F8EF7",forfait:"#A855F7"}[t.type];
                return (
                  <div key={t.id||t.localId} style={{...card,padding:"13px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:11}}>
                      <div style={{width:36,height:36,borderRadius:10,background:`${tc}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:tc}}/>
                      </div>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{t.type==="forfait"?(ft?ft.label:"Forfait"):{depot:"Depot",retrait:"Retrait"}[t.type]} · <span style={{color:OPC[t.operateur]}}>{t.operateur}</span></div>
                        <div style={{fontSize:11,color:T.sub}}>{t.telephone||"—"} · {t.heure}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:900,color:tc,fontSize:14}}>{hide?mask():fF(t.montant)}</div>
                        {t.commission>0&&<div style={{fontSize:10,color:"#FFB800"}}>+{fF(t.commission)}</div>}
                      </div>
                      {isToday&&<button onClick={()=>setConfirmDel(t.id)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:14}}>x</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ PROFIL ══════════════════════════════════════════════════════ */}
          {tab==="profil"&&(
            <div>
              <div style={{fontWeight:900,fontSize:20,marginBottom:18}}>Profil</div>
              <div style={{...card,padding:18,marginBottom:14}}>
                {isPatron&&(
                  <>
                    <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:12}}>COMPTE PATRON</div>
                    {[["Nom",patron.nom],["Telephone",patron.telephone],["Entreprise",patron.nom_entreprise],["RC",patron.registre_commerce],["Pays",patron.pays]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
                        <span style={{fontSize:13,color:T.sub}}>{l}</span><span style={{fontSize:13,fontWeight:700}}>{v}</span>
                      </div>
                    ))}
                    <div style={{marginTop:16,background:"#00C89610",border:"1px solid #00C89625",borderRadius:12,padding:14}}>
                      <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:8}}>ABONNEMENT</div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700}}>{agents.length} agent{agents.length>1?"s":""}</div>
                        <div style={{fontSize:22,fontWeight:900,color:"#00C896"}}>{(1999*agents.length).toLocaleString("fr-FR")} F/mois</div>
                      </div>
                      <button onClick={()=>alert("Paiement disponible bientot")} style={{width:"100%",padding:13,borderRadius:11,background:"linear-gradient(135deg,#00C896,#00A5FF)",border:"none",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer"}}>Payer l'abonnement</button>
                    </div>
                  </>
                )}
                {isAgent&&(
                  <>
                    <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:12}}>COMPTE AGENT</div>
                    {[["Nom",agent.nom],["Telephone",agent.telephone]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
                        <span style={{fontSize:13,color:T.sub}}>{l}</span><span style={{fontSize:13,fontWeight:700}}>{v}</span>
                      </div>
                    ))}
                    <div style={{marginTop:12}}>
                      {pending>0
                        ?<div style={{background:"#FFB80018",border:"1px solid #FFB80030",borderRadius:9,padding:"9px 13px",fontSize:12,color:"#FFB800",fontWeight:700}}>{pending} operation(s) en attente de sync</div>
                        :<div style={{background:"#00C89618",border:"1px solid #00C89625",borderRadius:9,padding:"9px 13px",fontSize:12,color:"#00C896",fontWeight:700}}>Donnees synchronisees</div>}
                    </div>
                    {!agent.patron_id&&(
                      <div style={{marginTop:14,background:"#7B2FBE12",border:"1px solid #7B2FBE30",borderRadius:12,padding:14}}>
                        <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:8}}>ABONNEMENT</div>
                        <div style={{fontSize:13,color:T.sub,marginBottom:12}}>Agent independant · <strong style={{color:"#9B5FDE"}}>1 999 F / mois</strong></div>
                        <button onClick={()=>alert("Paiement disponible bientot")} style={{width:"100%",padding:13,borderRadius:11,background:"linear-gradient(135deg,#7B2FBE,#9B5FDE)",border:"none",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer"}}>Payer l'abonnement</button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",...card,padding:"13px 15px",marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:13}}>{dark?"Mode sombre":"Mode clair"}</div>
                <button onClick={()=>setDark(d=>!d)} style={{padding:"7px 14px",borderRadius:9,background:T.hero,border:`1px solid ${T.border}`,color:T.text,fontSize:12,fontWeight:700,cursor:"pointer"}}>{dark?"Clair":"Sombre"}</button>
              </div>
              <button onClick={()=>setConfirmOut(true)} style={{width:"100%",padding:14,borderRadius:12,background:"#E6394618",border:"1px solid #E6394630",color:"#E63946",fontWeight:900,fontSize:15,cursor:"pointer"}}>Deconnexion</button>
            </div>
          )}

        </main>

        {/* ── FABs AGENT ──────────────────────────────────────────────────── */}
        {isAgent&&tab==="home"&&isToday&&(
          <div style={{position:"fixed",bottom:82,right:16,display:"flex",flexDirection:"column",gap:8,zIndex:60}}>
            <button onClick={()=>{setModal("forfait");setMForm({});}} style={{height:38,padding:"0 14px",borderRadius:19,background:T.card,border:`1px solid #A855F740`,color:"#A855F7",fontSize:12,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,0.2)"}}>Forfait</button>
            <button onClick={()=>{setModal("retrait");setMForm({});}} style={{height:42,padding:"0 16px",borderRadius:21,background:T.card,border:`1px solid #4F8EF740`,color:"#4F8EF7",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,0.2)"}}>Retrait</button>
            <button onClick={()=>{setModal("depot");setMForm({});}} style={{height:48,padding:"0 18px",borderRadius:24,background:"linear-gradient(135deg,#00C896,#00A5FF)",border:"none",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 14px #00C89650"}}>Depot</button>
          </div>
        )}

        {/* ── BOTTOM NAV ──────────────────────────────────────────────────── */}
        <nav style={{position:"fixed",bottom:0,left:0,right:0,background:T.nav,borderTop:`1px solid ${T.border}`,zIndex:50}}>
          <div style={{display:"flex",justifyContent:"space-around",padding:"10px 0 14px",width:"100%"}}>
            {NAV.map(([key,label])=>(
              <button key={key} onClick={()=>setTab(key)}
                style={{background:"none",border:"none",color:tab===key?"#00C896":T.sub,fontSize:11,fontWeight:tab===key?800:500,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"0 18px",opacity:tab===key?1:0.7}}>
                <div style={{width:40,height:28,borderRadius:14,background:tab===key?"#00C89618":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:tab===key?"#00C896":"transparent",border:`1.5px solid ${tab===key?"#00C896":T.sub}`}}/>
                </div>
                {label}
              </button>
            ))}
          </div>
        </nav>

        {/* ── MODAL DEPOT / RETRAIT ────────────────────────────────────────── */}
        {(modal==="depot"||modal==="retrait")&&(
          <div style={MWrap} onClick={()=>setModal(null)}>
            <div onClick={e=>e.stopPropagation()} style={MBox}>
              <div style={{width:32,height:4,background:T.border2,borderRadius:2,margin:"0 auto 14px"}}/>
              <div style={{fontWeight:900,fontSize:17,marginBottom:14,color:modal==="depot"?"#00C896":"#4F8EF7"}}>{modal==="depot"?"Depot":"Retrait"}</div>

              {modal==="retrait"&&mForm.montant&&Number(mForm.montant)>=100&&(()=>{
                const t=tranche(Number(mForm.montant)); const c=mForm.operateur?frais(mForm.operateur,Number(mForm.montant)):0;
                return t?(
                  <div style={{background:T.hero,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",marginBottom:14}}>
                    <div style={{fontSize:10,color:T.sub,fontWeight:700,marginBottom:8}}>{Number(t.min).toLocaleString("fr-FR")} – {Number(t.max).toLocaleString("fr-FR")} F</div>
                    <div style={{display:"flex",gap:7}}>
                      {OPS.map(op=>{const sel=op===mForm.operateur;return(
                        <div key={op} style={{flex:1,textAlign:"center",background:sel?`${OPC[op]}20`:T.card,border:`1px solid ${sel?OPC[op]:T.border}`,borderRadius:9,padding:"9px 4px"}}>
                          <div style={{fontSize:9,color:OPC[op],fontWeight:800,marginBottom:3}}>{op}</div>
                          <div style={{fontSize:13,fontWeight:900,color:sel?OPC[op]:T.text}}>{fF(t[op])}</div>
                        </div>
                      );})}
                    </div>
                    {mForm.operateur&&<div style={{marginTop:10,background:"#00C89612",borderRadius:9,padding:"9px 12px",display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontSize:12,color:T.sub}}>Frais</span>
                      <span style={{fontSize:16,fontWeight:900,color:"#00C896"}}>{fF(c)}</span>
                    </div>}
                  </div>
                ):null;
              })()}

              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:T.sub,marginBottom:6,fontWeight:700}}>MONTANT (FCFA)</div>
                <input type="number" placeholder="0" value={mForm.montant||""} onChange={e=>setMForm(f=>({...f,montant:e.target.value}))} autoFocus
                  style={{width:"100%",background:T.input,border:`1.5px solid ${T.border}`,borderRadius:11,padding:"13px 14px",color:T.text,fontSize:22,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:T.sub,marginBottom:6,fontWeight:700}}>NUMERO CLIENT</div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{background:T.input,border:`1.5px solid ${T.border}`,borderRadius:11,padding:"12px 10px",fontSize:13,fontWeight:800}}>+229 01</div>
                  <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={mForm.telephone||""} onChange={e=>{const v=e.target.value.replace(/\D/g,"").slice(0,8);const op=detectOp(v);setMForm(f=>({...f,telephone:v,operateur:op||f.operateur}));}}
                    style={{flex:1,background:T.input,border:`1.5px solid ${mForm.operateur?OPC[mForm.operateur]:T.border}`,borderRadius:11,padding:"12px 13px",color:T.text,fontSize:15,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>
              <div style={{marginBottom:18}}>
                <div style={{fontSize:11,color:T.sub,marginBottom:6,fontWeight:700}}>RESEAU</div>
                <div style={{display:"flex",gap:8}}>
                  {OPS.map(op=>(
                    <button key={op} onClick={()=>setMForm(f=>({...f,operateur:op}))}
                      style={{flex:1,padding:"11px 0",borderRadius:10,border:`2px solid ${mForm.operateur===op?OPC[op]:T.border}`,background:mForm.operateur===op?OPB[op]:"transparent",color:mForm.operateur===op?OPC[op]:T.sub,fontWeight:800,fontSize:13,cursor:"pointer"}}>
                      {op}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={addTx} disabled={saving||!mForm.operateur||!mForm.montant}
                style={{width:"100%",padding:16,borderRadius:13,background:(!mForm.operateur||!mForm.montant)?"transparent":modal==="depot"?"linear-gradient(135deg,#00C896,#00A5FF)":"linear-gradient(135deg,#4F8EF7,#7B2FBE)",border:(!mForm.operateur||!mForm.montant)?`1px solid ${T.border}`:"none",color:(!mForm.operateur||!mForm.montant)?T.faint:"#fff",fontWeight:900,fontSize:16,cursor:(!mForm.operateur||!mForm.montant)?"not-allowed":"pointer"}}>
                {saving?"...":modal==="depot"?"Confirmer le depot":`Confirmer le retrait${mForm.operateur&&mForm.montant?` · ${fF(frais(mForm.operateur,Number(mForm.montant)))}`:""}` }
              </button>
            </div>
          </div>
        )}

        {/* ── MODAL FORFAIT ────────────────────────────────────────────────── */}
        {modal==="forfait"&&(
          <div style={MWrap} onClick={()=>setModal(null)}>
            <div onClick={e=>e.stopPropagation()} style={MBox}>
              <div style={{width:32,height:4,background:T.border2,borderRadius:2,margin:"0 auto 14px"}}/>
              <div style={{fontWeight:900,fontSize:17,marginBottom:14,color:"#A855F7"}}>Forfait</div>

              {/* Type */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                {FORFAIT_TYPES.map(ft=>(
                  <button key={ft.key} onClick={()=>setMForm(f=>({...f,forfait_type:ft.key}))}
                    style={{padding:"12px 4px",borderRadius:12,border:`2px solid ${mForm.forfait_type===ft.key?"#A855F7":T.border}`,background:mForm.forfait_type===ft.key?"#A855F720":"transparent",color:mForm.forfait_type===ft.key?"#A855F7":T.sub,fontWeight:700,fontSize:11,cursor:"pointer",textAlign:"center"}}>
                    {ft.label}
                  </button>
                ))}
              </div>

              {/* Reseau */}
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                {OPS.map(op=>(
                  <button key={op} onClick={()=>setMForm(f=>({...f,operateur:op}))}
                    style={{flex:1,padding:"10px 0",borderRadius:10,border:`2px solid ${mForm.operateur===op?OPC[op]:T.border}`,background:mForm.operateur===op?OPB[op]:"transparent",color:mForm.operateur===op?OPC[op]:T.sub,fontWeight:800,fontSize:13,cursor:"pointer"}}>
                    {op}
                  </button>
                ))}
              </div>

              {/* Montants rapides */}
              <div style={{fontSize:11,color:T.sub,marginBottom:7,fontWeight:700}}>MONTANT</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:10}}>
                {FORFAIT_MONTANTS.map(v=>(
                  <button key={v} onClick={()=>setMForm(f=>({...f,montant:String(v)}))}
                    style={{padding:"10px 4px",borderRadius:9,border:`2px solid ${String(mForm.montant)===String(v)?"#A855F7":T.border}`,background:String(mForm.montant)===String(v)?"#A855F720":"transparent",color:String(mForm.montant)===String(v)?"#A855F7":T.sub,fontWeight:700,fontSize:11,cursor:"pointer"}}>
                    {v>=1000?`${v/1000}k`:v}F
                  </button>
                ))}
              </div>
              <input type="number" placeholder="Autre montant..." value={FORFAIT_MONTANTS.includes(Number(mForm.montant))?"":mForm.montant||""}
                onChange={e=>setMForm(f=>({...f,montant:e.target.value}))}
                style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 13px",color:T.text,fontSize:14,fontWeight:700,outline:"none",boxSizing:"border-box",marginBottom:14}}/>

              {mForm.operateur&&mForm.montant&&mForm.forfait_type?(
                <button onClick={addTx} disabled={saving}
                  style={{width:"100%",padding:16,borderRadius:13,background:"linear-gradient(135deg,#A855F7,#7C3AED)",border:"none",color:"#fff",fontWeight:900,fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",paddingLeft:20,paddingRight:20,boxShadow:"0 4px 14px #A855F740"}}>
                  <span>{FORFAIT_TYPES.find(f=>f.key===mForm.forfait_type)?.label} · {mForm.operateur}</span>
                  <span style={{fontSize:17}}>{saving?"...":fF(Number(mForm.montant))+" ✓"}</span>
                </button>
              ):(
                <div style={{padding:16,borderRadius:12,background:T.hero,border:`1px solid ${T.border}`,color:T.faint,fontSize:13,textAlign:"center"}}>Selectionne type · reseau · montant</div>
              )}
            </div>
          </div>
        )}

        {/* ── MODAL MATIN ──────────────────────────────────────────────────── */}
        {showMorning&&isAgent&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:T.card,borderRadius:20,padding:22,maxWidth:400,width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${T.border}`}}>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontWeight:900,fontSize:20}}>Debut de journee</div>
                <div style={{fontSize:13,color:T.sub,marginTop:4}}>Renseigne tes fonds du matin</div>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:6}}>ESPECES (total liquide)</div>
                <input type="number" placeholder="Ex: 300000" value={morning.cash} onChange={e=>setMorning(p=>({...p,cash:e.target.value}))}
                  style={{width:"100%",background:T.input,border:"1.5px solid #00C89650",borderRadius:11,padding:"13px 14px",color:T.text,fontSize:16,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {[["MTN",OPC.MTN],["MOOV",OPC.MOOV],["Celtiis",OPC.Celtiis]].map(([op,col])=>(
                <div key={op} style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:col,marginBottom:6}}>FLOAT {op}</div>
                  <input type="number" placeholder={`Solde ${op}`} value={morning[op]} onChange={e=>setMorning(p=>({...p,[op]:e.target.value}))}
                    style={{width:"100%",background:T.input,border:`1.5px solid ${col}50`,borderRadius:11,padding:"12px 14px",color:T.text,fontSize:14,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <button onClick={()=>{
                const uid=agent.id||agent.telephone; const cashVal=Number(morning.cash);
                if(!isNaN(cashVal)&&morning.cash!==""){ls.set(KEY.cash(today(),uid),cashVal);setCash(cashVal);}
                const nf={MTN:null,MOOV:null,Celtiis:null};
                OPS.forEach(op=>{const v=Number(morning[op]);if(!isNaN(v)&&morning[op]!=="")nf[op]=v;});
                setFloats(nf); ls.set(KEY.floats(today(),uid),nf);
                api.saveFloat({agent_id:agent.id,patron_id:agent.patron_id||null,date:today(),cash:cashVal||0,float_mtn:nf.MTN,float_moov:nf.MOOV,float_celtiis:nf.Celtiis});
                setShowMorning(false);
              }} style={{width:"100%",padding:15,borderRadius:12,background:"linear-gradient(135deg,#00C896,#00A5FF)",border:"none",color:"#fff",fontWeight:900,fontSize:15,cursor:"pointer",marginBottom:10}}>
                Commencer la journee
              </button>
              <button onClick={()=>setShowMorning(false)} style={{width:"100%",padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer"}}>Plus tard</button>
            </div>
          </div>
        )}

        {/* ── MODAL TERMINER LA JOURNEE ────────────────────────────────────── */}
        {showClose&&isAgent&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:500,display:"flex",alignItems:"flex-end"}}>
            <div onClick={()=>setShowClose(false)} style={{position:"absolute",inset:0}}/>
            <div style={{position:"relative",background:T.card,borderRadius:"20px 20px 0 0",padding:"18px 18px 44px",width:"100%",maxHeight:"88vh",overflowY:"auto",border:`1px solid ${T.border2}`}}>
              <div style={{width:32,height:4,background:T.border2,borderRadius:2,margin:"0 auto 16px"}}/>
              <div style={{fontWeight:900,fontSize:18,marginBottom:6}}>Terminer la journee</div>
              <div style={{fontSize:13,color:T.sub,marginBottom:16}}>Saisis tes fonds reels de ce soir.</div>

              {agentPt!==null&&(
                <div style={{background:"#00C89612",borderRadius:10,padding:"10px 13px",marginBottom:18,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:12,color:T.sub,fontWeight:700}}>Attendu</div>
                  <div style={{fontSize:18,fontWeight:900,color:"#00C896"}}>{fF(agentPt)}</div>
                </div>
              )}

              <div style={{marginBottom:13}}>
                <div style={{fontSize:11,color:T.sub,fontWeight:700,marginBottom:6}}>ESPECES</div>
                <input type="number" placeholder="Cash reel ce soir" value={closeIn.cash} onChange={e=>setCloseIn(p=>({...p,cash:e.target.value}))}
                  style={{width:"100%",background:T.input,border:`1.5px solid ${closeIn.cash?"#00C896":T.border}`,borderRadius:11,padding:"13px 14px",color:T.text,fontSize:15,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {OPS.map(op=>(
                <div key={op} style={{marginBottom:13}}>
                  <div style={{fontSize:11,fontWeight:700,color:OPC[op],marginBottom:6}}>{op}</div>
                  <input type="number" placeholder={`Float ${op} reel`} value={closeIn[op]} onChange={e=>setCloseIn(p=>({...p,[op]:e.target.value}))}
                    style={{width:"100%",background:T.input,border:`1.5px solid ${closeIn[op]?OPC[op]:T.border}`,borderRadius:11,padding:"12px 14px",color:T.text,fontSize:14,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}

              {(closeIn.cash||OPS.some(op=>closeIn[op]))&&agentPt!==null&&(()=>{
                const total=(closeIn.cash?Number(closeIn.cash):0)+OPS.reduce((s,op)=>s+(closeIn[op]?Number(closeIn[op]):0),0);
                const diff=total-agentPt;
                const ok=Math.abs(diff)<=500;
                const c=ok?"#00C896":diff>0?"#FFB800":"#E63946";
                return (
                  <div style={{background:`${c}12`,borderRadius:10,padding:"10px 13px",marginBottom:16,border:`1px solid ${c}25`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,fontWeight:700,color:c}}>{ok?"Equilibre":diff>0?"Excedent":"Manquant"}</div>
                      <div style={{fontSize:16,fontWeight:900,color:c}}>{diff>0?"+":""}{fF(diff)}</div>
                    </div>
                    <div style={{fontSize:10,color:T.faint,marginTop:2}}>Total saisi: {fF(total)} · Attendu: {fF(agentPt)}</div>
                  </div>
                );
              })()}

              <button
                onClick={()=>{
                  if(agentPt!==null){
                    const total=(closeIn.cash?Number(closeIn.cash):0)+OPS.reduce((s,op)=>s+(closeIn[op]?Number(closeIn[op]):0),0);
                    setCloseResult({total,attendu:agentPt});
                  }
                  setShowClose(false);
                }}
                disabled={!closeIn.cash&&OPS.every(op=>!closeIn[op])}
                style={{width:"100%",padding:15,borderRadius:12,background:(!closeIn.cash&&OPS.every(op=>!closeIn[op]))?T.hero:"linear-gradient(135deg,#1A2A6C,#2541B2)",border:"none",color:(!closeIn.cash&&OPS.every(op=>!closeIn[op]))?T.faint:"#fff",fontWeight:900,fontSize:15,cursor:(!closeIn.cash&&OPS.every(op=>!closeIn[op]))?"not-allowed":"pointer",marginBottom:10}}>
                Valider la cloture
              </button>
              <button onClick={()=>setShowClose(false)} style={{width:"100%",padding:11,borderRadius:11,background:"transparent",border:`1px solid ${T.border}`,color:T.sub,fontSize:13,cursor:"pointer"}}>Annuler</button>
            </div>
          </div>
        )}

        {/* ── CALENDRIER ──────────────────────────────────────────────────── */}
        {showCal&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"flex-end",zIndex:300}} onClick={()=>setShowCal(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:"20px 20px 0 0",padding:"18px 16px 34px",width:"100%",border:`1px solid ${T.border2}`}}>
              <div style={{width:32,height:4,background:T.border2,borderRadius:2,margin:"0 auto 16px"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <button onClick={()=>calMonth===1?(setCalMonth(12),setCalYear(y=>y-1)):setCalMonth(m=>m-1)} style={{background:T.hero,border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:T.text}}>‹</button>
                <div style={{fontWeight:800,fontSize:14}}>{MOIS[calMonth-1]} {calYear}</div>
                <button onClick={()=>calMonth===12?(setCalMonth(1),setCalYear(y=>y+1)):setCalMonth(m=>m+1)} style={{background:T.hero,border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:T.text}}>›</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:6}}>
                {JOURS.map(j=><div key={j} style={{textAlign:"center",fontSize:9,color:T.sub,fontWeight:700,padding:"3px 0"}}>{j}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
                {Array(new Date(calYear,calMonth-1,1).getDay()).fill(null).map((_,i)=><div key={`e${i}`}/>)}
                {Array(new Date(calYear,calMonth,0).getDate()).fill(null).map((_,i)=>{
                  const d=i+1,ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                  const isT=ds===today(),isSel=ds===selDate,isFut=ds>today();
                  return <button key={d} disabled={isFut} onClick={()=>{setSelDate(ds);setShowCal(false);}}
                    style={{width:"100%",aspectRatio:"1",borderRadius:9,border:isSel?"2px solid #00C896":isT?`2px solid #FFB800`:`1px solid ${T.border}`,background:isSel?"#00C89620":isT?"#FFB80015":T.hero,color:isFut?T.faint:isSel?"#00C896":T.text,fontWeight:isSel||isT?800:400,fontSize:13,cursor:isFut?"not-allowed":"pointer",opacity:isFut?0.3:1}}>
                    {d}
                  </button>;
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIRM SUPPR TRANSACTION ────────────────────────────────────── */}
        {confirmDel&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:24}}>
            <div style={{background:T.card,borderRadius:18,padding:24,width:"100%",maxWidth:300,border:`1px solid ${T.border2}`}}>
              <div style={{fontWeight:900,fontSize:17,marginBottom:8}}>Supprimer ?</div>
              <div style={{fontSize:13,color:T.sub,marginBottom:20}}>Cette operation sera effacee.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmDel(null)} style={{flex:1,padding:13,borderRadius:11,background:T.hero,border:`1px solid ${T.border2}`,color:T.text,fontWeight:700,cursor:"pointer"}}>Annuler</button>
                <button onClick={()=>removeTx(confirmDel)} style={{flex:1,padding:13,borderRadius:11,background:"#E63946",border:"none",color:"#fff",fontWeight:800,cursor:"pointer"}}>Supprimer</button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIRM SUPPR AGENT ─────────────────────────────────────────── */}
        {delAgent&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:24}}>
            <div style={{background:T.card,borderRadius:20,padding:26,width:"100%",maxWidth:320,border:"1px solid #E6394630",textAlign:"center"}}>
              <div style={{fontWeight:900,fontSize:18,marginBottom:8,color:"#E63946"}}>Supprimer {delAgent.nom} ?</div>
              <div style={{fontSize:12,color:T.sub,marginBottom:20}}>Toutes ses donnees seront supprimees.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setDelAgent(null)} disabled={delBusy} style={{flex:1,padding:13,borderRadius:11,background:T.hero,border:`1px solid ${T.border2}`,color:T.text,fontWeight:700,cursor:"pointer"}}>Annuler</button>
                <button disabled={delBusy} onClick={async()=>{setDelBusy(true);await api.deleteAgent(delAgent.id);setDelBusy(false);setDelAgent(null);loadPatron();}}
                  style={{flex:1,padding:13,borderRadius:11,background:"#E63946",border:"none",color:"#fff",fontWeight:800,cursor:delBusy?"not-allowed":"pointer",opacity:delBusy?0.7:1}}>
                  {delBusy?"...":"Supprimer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONFIRM DECONNEXION ──────────────────────────────────────────── */}
        {confirmOut&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:24}}>
            <div style={{background:T.card,borderRadius:20,padding:28,width:"100%",maxWidth:320,border:`1px solid ${T.border2}`,textAlign:"center"}}>
              <div style={{fontWeight:900,fontSize:18,marginBottom:8}}>Se deconnecter ?</div>
              <div style={{fontSize:13,color:T.sub,marginBottom:24}}>Tes donnees restent sauvegardees.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setConfirmOut(false)} style={{flex:1,padding:13,borderRadius:11,background:T.hero,border:`1px solid ${T.border2}`,color:T.text,fontWeight:700,cursor:"pointer"}}>Annuler</button>
                <button onClick={logout} style={{flex:1,padding:13,borderRadius:11,background:"#E63946",border:"none",color:"#fff",fontWeight:800,cursor:"pointer"}}>Deconnexion</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
