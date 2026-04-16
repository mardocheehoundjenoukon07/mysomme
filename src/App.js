import { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SUPABASE ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";

function H() {
  return {
    "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`,
    "Content-Type": "application/json", "Prefer": "return=representation",
  };
}

// ─── LOCAL STORAGE ─────────────────────────────────────────────────────────────
const lsGet = k => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch { return null; } };
const lsSet = (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
const txKey    = (date,uid) => `ks_txs_${uid}_${date}`;
const pendKey  = uid        => `ks_pend_${uid}`;
const floatKey = (date,uid) => `ks_float_${uid}_${date}`;
const cashKey  = (date,uid) => `ks_cash_${uid}_${date}`;

// ─── DATE ─────────────────────────────────────────────────────────────────────
function todayStr() {
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function nowISO() {
  const d=new Date(), p=n=>String(n).padStart(2,"0");
  const off=-d.getTimezoneOffset(), sign=off>=0?"+":"-";
  const hh=p(Math.floor(Math.abs(off)/60)), mm=p(Math.abs(off)%60);
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${hh}:${mm}`;
}

// ─── HASH PIN SHA-256 ─────────────────────────────────────────────────────────
async function hashPin(pin) {
  try {
    const buf=new TextEncoder().encode(pin);
    const h=await crypto.subtle.digest("SHA-256",buf);
    return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,"0")).join("");
  } catch { return pin; }
}

// ─── DETECTION OPERATEUR ──────────────────────────────────────────────────────
const PREFIXES_MTN     = ["42","46","50","51","52","53","54","56","57","59","61","62","66","67","69","90","91","96","97"];
const PREFIXES_MOOV    = ["45","55","58","60","63","64","65","68","94","95","98","99"];
const PREFIXES_CELTIIS = ["20","21","22","23","24","28","29","40","41","43","44","47","48","49","92","93"];
function detectOp(tel) {
  if (!tel||tel.length<2) return null;
  const p=tel.slice(0,2);
  if (PREFIXES_MTN.includes(p))     return "MTN";
  if (PREFIXES_MOOV.includes(p))    return "MOOV";
  if (PREFIXES_CELTIIS.includes(p)) return "Celtiis";
  return null;
}

// ─── GRILLE FRAIS DE RETRAIT ──────────────────────────────────────────────────
const GRILLE = [
  { min:100,     max:500,     MTN:50,   MOOV:50,   Celtiis:25   },
  { min:501,     max:5000,    MTN:125,  MOOV:125,  Celtiis:75   },
  { min:5001,    max:10000,   MTN:225,  MOOV:225,  Celtiis:150  },
  { min:10001,   max:20000,   MTN:375,  MOOV:375,  Celtiis:250  },
  { min:20001,   max:50000,   MTN:700,  MOOV:700,  Celtiis:500  },
  { min:50001,   max:75000,   MTN:1000, MOOV:1000, Celtiis:750  },
  { min:75001,   max:100000,  MTN:1000, MOOV:1000, Celtiis:1000 },
  { min:100001,  max:200000,  MTN:2000, MOOV:2000, Celtiis:2000 },
  { min:200001,  max:300000,  MTN:3000, MOOV:3000, Celtiis:3000 },
  { min:300001,  max:500000,  MTN:3500, MOOV:3500, Celtiis:4000 },
  { min:500001,  max:750000,  MTN:5000, MOOV:5000, Celtiis:5000 },
  { min:750001,  max:1000000, MTN:6000, MOOV:6000, Celtiis:5000 },
  { min:1000001, max:1500000, MTN:8000, MOOV:8000, Celtiis:5000 },
  { min:1500001, max:2000000, MTN:9900, MOOV:9900, Celtiis:5000 },
];
function calcFrais(op, montant) {
  const mt=Number(montant)||0;
  const t=GRILLE.find(t=>mt>=t.min&&mt<=t.max);
  return t?(t[op]||0):0;
}
function getTranche(montant) {
  const mt=Number(montant)||0;
  return GRILLE.find(t=>mt>=t.min&&mt<=t.max)||null;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const OPS       = ["MTN","MOOV","Celtiis"];
const OP_COLORS = { MTN:"#D4A017", MOOV:"#1A5EB8", Celtiis:"#C0392B" };
const OP_BG_D   = { MTN:"#D4A01714", MOOV:"#1A5EB814", Celtiis:"#C0392B14" };
const OP_BG_L   = { MTN:"#D4A01720", MOOV:"#1A5EB818", Celtiis:"#C0392B18" };
const TYPE_COLOR = { depot:"#1A7A5E", retrait:"#1A4A8A", forfait:"#5A2D8A" };
const TYPE_LABEL = { depot:"Depot", retrait:"Retrait", forfait:"Forfait" };
const JOURS   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR = ["Janvier","Fevrier","Mars","Avril","Mai","Juin","Juillet","Aout","Septembre","Octobre","Novembre","Decembre"];
const PAYS    = ["Benin","Togo","Burkina Faso","Cote d'Ivoire","Senegal"];
const fF = n => Number(n||0).toLocaleString("fr-FR")+" F";
function getSalutation(nom) {
  const h=new Date().getHours(), p=(nom||"").split(" ")[0];
  const g=h>=5&&h<12?"Bonjour":h>=12&&h<18?"Bon apres-midi":"Bonsoir";
  return `${g}, ${p}`;
}

// ─── THEMES ───────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#080A10", card:"#0E1118", border:"#16192A", border2:"#1C2035",
  text:"#D8DCE8", sub:"#3D4260", faint:"#1E2238", hero:"#0B0D16",
  input:"#080A10", accent:"#1A7A5E", nav:"#0E1118",
};
const LIGHT = {
  bg:"#F2F4F9", card:"#FFFFFF", border:"#E0E4EF", border2:"#CDD3E4",
  text:"#16192A", sub:"#6A7090", faint:"#B8BDD0", hero:"#EAECf4",
  input:"#F8F9FC", accent:"#1A7A5E", nav:"#FFFFFF",
};

// ─── HOOK RESPONSIVE ──────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w,setW] = useState(typeof window!=="undefined"?window.innerWidth:375);
  useEffect(()=>{
    const h=()=>setW(window.innerWidth);
    window.addEventListener("resize",h);
    return ()=>window.removeEventListener("resize",h);
  },[]);
  return w;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── API SUPABASE ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchPatron(tel) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/patrons?telephone=eq.${tel}&select=*`,{headers:H()});
    if (!r.ok) return null; const d=await r.json(); return d[0]||null;
  } catch { return null; }
}
async function savePatron(p) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/patrons`,{method:"POST",headers:H(),body:JSON.stringify(p)});
    if (r.ok) return {success:true,data:(await r.json())[0]};
    const err=await r.json().catch(()=>({}));
    return {success:false,error:err.message||err.details||`Erreur ${r.status}`};
  } catch(e) { return {success:false,error:e.message||"Connexion impossible"}; }
}
async function fetchAgents(patronId) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents?patron_id=eq.${patronId}&select=*&order=created_at.asc`,{headers:H()});
    return r.ok?await r.json():[];
  } catch { return []; }
}
async function fetchAgent(tel) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents?telephone=eq.${tel}&select=*`,{headers:H()});
    if (!r.ok) return null; const d=await r.json(); return d[0]||null;
  } catch { return null; }
}
async function saveAgent(a) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents`,{method:"POST",headers:H(),body:JSON.stringify(a)});
    return r.ok?(await r.json())[0]:null;
  } catch { return null; }
}
async function deleteAgent(agentId) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=eq.${agentId}`,{method:"DELETE",headers:H()});
    await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats?agent_id=eq.${agentId}`,{method:"DELETE",headers:H()});
    await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents?id=eq.${agentId}`,{method:"DELETE",headers:H()});
    return true;
  } catch { return false; }
}
async function generateInviteCode(patronId) {
  const code=Math.random().toString(36).substring(2,8).toUpperCase();
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/invitations`,{method:"POST",headers:H(),body:JSON.stringify({code,patron_id:patronId})});
    return r.ok?code:null;
  } catch { return null; }
}
async function fetchInviteCode(code) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/invitations?code=eq.${code.toUpperCase()}&used=eq.false&select=*`,{headers:H()});
    if (!r.ok) return null; const d=await r.json(); return d[0]||null;
  } catch { return null; }
}
async function markInviteUsed(code, agentId) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/invitations?code=eq.${code.toUpperCase()}`,{
      method:"PATCH",headers:H(),body:JSON.stringify({used:true,used_by:agentId})
    });
  } catch {}
}
async function fetchAgentTxs(agentId, dateStr) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=eq.${agentId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,{headers:H()});
    return r.ok?await r.json():[];
  } catch { return []; }
}
async function saveTx(tx) {
  try {
    const { localId, id, ...cleanTx } = tx;
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions`,{method:"POST",headers:H(),body:JSON.stringify(cleanTx)});
    if (r.ok) return { ok:true, data:(await r.json())[0] };
    const err=await r.json().catch(()=>({}));
    return { ok:false, error: err.message||err.details||err.hint||`Erreur ${r.status}` };
  } catch(e) { return { ok:false, error:e.message||"Pas de connexion" }; }
}
async function deleteTx(id) {
  try { await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?id=eq.${id}`,{method:"DELETE",headers:H()}); } catch {}
}
async function saveFloat(f) {
  try {
    const { agent_id, patron_id, date, cash, float_mtn, float_moov, float_celtiis } = f;
    const cleanFloat = { agent_id, patron_id, date, cash, float_mtn, float_moov, float_celtiis };
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats`,{
      method:"POST",
      headers:{...H(),"Prefer":"return=representation,resolution=merge-duplicates"},
      body:JSON.stringify(cleanFloat)
    });
    return r.ok;
  } catch { return false; }
}
async function fetchAllTxsForPatron(patronId, dateStr, agentIds) {
  try {
    if (agentIds && agentIds.length > 0) {
      const ids = agentIds.join(",");
      const r = await fetch(
        `${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=in.(${ids})&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,
        { headers: H() }
      );
      if (r.ok) return await r.json();
    }
    const r = await fetch(
      `${SUPA_URL}/rest/v1/cashpoint_transactions?patron_id=eq.${patronId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,
      { headers: H() }
    );
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchAllFloatsForPatron(patronId, dateStr, agentIds) {
  try {
    if (agentIds && agentIds.length > 0) {
      const ids = agentIds.join(",");
      const r = await fetch(
        `${SUPA_URL}/rest/v1/cashpoint_floats?agent_id=in.(${ids})&date=eq.${dateStr}&select=*`,
        { headers: H() }
      );
      if (r.ok) return await r.json();
    }
    const r = await fetch(
      `${SUPA_URL}/rest/v1/cashpoint_floats?patron_id=eq.${patronId}&date=eq.${dateStr}&select=*`,
      { headers: H() }
    );
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function flushPending(agentId) {
  const pending=lsGet(pendKey(agentId));
  if (!pending?.length) return [];
  const synced=[];
  for (const tx of pending) { const s=await saveTx(tx); if (s.ok) synced.push(tx.localId); }
  if (synced.length>0) lsSet(pendKey(agentId),pending.filter(t=>!synced.includes(t.localId)));
  return synced;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PIN PAD ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin,setPin] = useState("");
  const add = d => {
    if (pin.length>=4) return;
    const p=pin+d; setPin(p);
    if (p.length===4) setTimeout(()=>{ onSubmit(p); setPin(""); },140);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"24px 20px", background:T.bg, width:"100%", boxSizing:"border-box" }}>
      <div style={{ width:44, height:44, borderRadius:12, background:T.accent, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:24, fontWeight:800, fontSize:18, color:"#fff", letterSpacing:"-0.5px" }}>CP</div>
      <div style={{ fontWeight:700, fontSize:22, marginBottom:6, textAlign:"center", color:T.text, letterSpacing:"-0.3px" }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:36, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:16, marginBottom:36 }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:pin.length>i?T.accent:T.faint, transition:"all 0.15s" }} />
        ))}
      </div>
      {error && <div style={{ background:"#C0392B12", border:`1px solid #C0392B30`, color:"#C0392B", borderRadius:8, padding:"8px 18px", fontSize:12, fontWeight:600, marginBottom:20, textAlign:"center" }}>{error}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, width:"100%", maxWidth:276 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"←"].map((d,i)=>(
          <button key={i} onClick={()=>d==="←"?setPin(p=>p.slice(0,-1)):d!==""?add(String(d)):null}
            style={{ height:60, borderRadius:12, border:`1px solid ${T.border}`, background:d===""?"transparent":T.card, color:T.text, fontSize:20, fontWeight:600, cursor:d===""?"default":"pointer", transition:"opacity 0.1s" }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function AuthScreen({ T, dark, setDark, onPatronLogin, onAgentLogin }) {
  const [mode,setMode]   = useState("choose");
  const [step,setStep]   = useState(1);
  const [form,setForm]   = useState({ nom:"", telephone:"", entreprise:"", rc:"", pays:"Benin", code:"" });
  const [pin1,setPin1]   = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  const inp = {
    width:"100%", background:T.input, border:`1.5px solid ${T.border}`,
    borderRadius:10, padding:"13px 14px", color:T.text, fontSize:14,
    outline:"none", boxSizing:"border-box", display:"block",
    fontFamily:"inherit",
  };

  const label = { fontSize:11, color:T.sub, marginBottom:6, fontWeight:700, letterSpacing:"0.08em", display:"block" };

  // ── PATRON INSCRIPTION ───────────────────────────────────────────────────────
  async function handlePatronRegister() {
    if (!form.nom.trim())     { setError("Nom complet requis"); return; }
    if (!form.telephone||form.telephone.length!==8) { setError("Numero a 8 chiffres requis"); return; }
    if (!form.entreprise.trim()) { setError("Nom de l'entreprise requis"); return; }
    if (!form.rc.trim())      { setError("Numero RC requis"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const existing=await fetchPatron(tel);
    if (existing) { setLoading(false); setError("Ce numero possede deja un compte."); return; }
    setLoading(false); setStep(3);
  }
  async function handlePatronPinCreate(p) { setPin1(p); setStep(4); }
  async function handlePatronPinConfirm(p) {
    if (p!==pin1) { setError("Les codes PIN ne correspondent pas"); setStep(3); return; }
    setLoading(true);
    const pinHash=await hashPin(p);
    const tel="01"+form.telephone;
    const patron={telephone:tel,nom:form.nom.trim(),nom_entreprise:form.entreprise.trim(),registre_commerce:form.rc.trim(),pays:form.pays,pin:pinHash,phone_verified:true};
    const result=await savePatron(patron); setLoading(false);
    if (!result.success) { setError(result.error); setStep(3); return; }
    lsSet("ks_patron",{...result.data,pin:pinHash});
    onPatronLogin({...result.data,pin:pinHash});
  }
  async function handlePatronLogin() {
    if (!form.telephone||form.telephone.length!==8) { setError("Numero a 8 chiffres requis"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const patron=await fetchPatron(tel); setLoading(false);
    if (!patron) { setError("Numero introuvable."); return; }
    lsSet("ks_patron",patron); setStep("patron-pin"); setForm(f=>({...f,_patron:patron}));
  }
  async function handlePatronPinLogin(p) {
    const patron=form._patron||lsGet("ks_patron");
    const pinHash=await hashPin(p);
    if (pinHash===patron.pin) onPatronLogin({...patron,pin:pinHash});
    else setError("Code PIN incorrect.");
  }

  // ── AGENT INVITATION ─────────────────────────────────────────────────────────
  async function handleAgentCode() {
    if (!form.code.trim()) { setError("Code d'invitation requis"); return; }
    setLoading(true); setError("");
    const invite=await fetchInviteCode(form.code.trim().toUpperCase()); setLoading(false);
    if (!invite) { setError("Code invalide ou deja utilise."); return; }
    setForm(f=>({...f,_invite:invite})); setStep("agent-form");
  }
  async function handleAgentForm() {
    if (!form.nom.trim()) { setError("Nom requis"); return; }
    if (!form.telephone||form.telephone.length!==8) { setError("Numero a 8 chiffres requis"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const existing=await fetchAgent(tel);
    if (existing) { setLoading(false); setError("Ce numero possede deja un compte."); return; }
    setLoading(false); setStep("agent-pin-create");
  }
  async function handleAgentPinCreate(p) { setPin1(p); setStep("agent-pin-confirm"); }
  async function handleAgentPinConfirm(p) {
    if (p!==pin1) { setError("Les codes PIN ne correspondent pas"); setStep("agent-pin-create"); return; }
    setLoading(true);
    const pinHash=await hashPin(p);
    const tel="01"+form.telephone;
    const agentData={telephone:tel,nom:form.nom.trim(),patron_id:form._invite.patron_id,pin:pinHash,phone_verified:true};
    const saved=await saveAgent(agentData);
    if (saved) await markInviteUsed(form.code.trim().toUpperCase(),saved.id);
    setLoading(false);
    if (!saved) { setError("Erreur lors de la creation. Reessayez."); return; }
    lsSet("ks_agent",{...saved,pin:pinHash});
    onAgentLogin({...saved,pin:pinHash});
  }
  async function handleAgentLogin() {
    if (!form.telephone||form.telephone.length!==8) { setError("Numero a 8 chiffres requis"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const ag=await fetchAgent(tel); setLoading(false);
    if (!ag) { setError("Numero introuvable."); return; }
    lsSet("ks_agent",ag); setStep("agent-pin-login"); setForm(f=>({...f,_agent:ag}));
  }
  async function handleAgentPinLogin(p) {
    const ag=form._agent||lsGet("ks_agent");
    const pinHash=await hashPin(p);
    if (pinHash===ag.pin) onAgentLogin({...ag,pin:pinHash});
    else setError("Code PIN incorrect.");
  }

  // ── AGENT INDEPENDANT ─────────────────────────────────────────────────────────
  async function handleIndepForm() {
    if (!form.nom.trim()) { setError("Nom requis"); return; }
    if (!form.telephone||form.telephone.length!==8) { setError("Numero a 8 chiffres requis"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const existing=await fetchAgent(tel);
    if (existing) { setLoading(false); setError("Ce numero possede deja un compte."); return; }
    setLoading(false); setStep("indep-pin-create");
  }
  async function handleIndepPinCreate(p) { setPin1(p); setStep("indep-pin-confirm"); }
  async function handleIndepPinConfirm(p) {
    if (p!==pin1) { setError("Les codes PIN ne correspondent pas"); setStep("indep-pin-create"); return; }
    setLoading(true);
    const pinHash=await hashPin(p);
    const tel="01"+form.telephone;
    const agentData={telephone:tel,nom:form.nom.trim(),patron_id:null,pin:pinHash,phone_verified:true};
    const saved=await saveAgent(agentData);
    setLoading(false);
    if (!saved) { setError("Erreur lors de la creation. Reessayez."); return; }
    lsSet("ks_agent",{...saved,pin:pinHash});
    onAgentLogin({...saved,pin:pinHash});
  }

  // Ecrans PIN
  if (step===3)                    return <PinPad title="Creez votre PIN" subtitle="4 chiffres pour securiser votre compte" onSubmit={handlePatronPinCreate} T={T} />;
  if (step===4)                    return <PinPad title="Confirmez votre PIN" subtitle="Retapez les memes 4 chiffres" onSubmit={handlePatronPinConfirm} T={T} error={error} />;
  if (step==="patron-pin")         return <PinPad title="Bon retour" subtitle="Entrez votre code PIN" onSubmit={handlePatronPinLogin} T={T} error={error} />;
  if (step==="agent-pin-create")   return <PinPad title="Creez votre PIN" subtitle="4 chiffres pour securiser votre compte" onSubmit={handleAgentPinCreate} T={T} />;
  if (step==="agent-pin-confirm")  return <PinPad title="Confirmez votre PIN" subtitle="Retapez les memes 4 chiffres" onSubmit={handleAgentPinConfirm} T={T} error={error} />;
  if (step==="agent-pin-login")    return <PinPad title="Bon retour" subtitle="Entrez votre code PIN" onSubmit={handleAgentPinLogin} T={T} error={error} />;
  if (step==="indep-pin-create")   return <PinPad title="Creez votre PIN" subtitle="4 chiffres pour securiser votre compte" onSubmit={handleIndepPinCreate} T={T} />;
  if (step==="indep-pin-confirm")  return <PinPad title="Confirmez votre PIN" subtitle="Retapez les memes 4 chiffres" onSubmit={handleIndepPinConfirm} T={T} error={error} />;

  const Divider = () => (
    <div style={{ display:"flex", alignItems:"center", gap:12, margin:"20px 0" }}>
      <div style={{ flex:1, height:1, background:T.border }} />
      <span style={{ fontSize:11, color:T.sub, fontWeight:600, letterSpacing:"0.06em" }}>OU</span>
      <div style={{ flex:1, height:1, background:T.border }} />
    </div>
  );

  const Btn = ({ children, onClick, disabled, variant="primary", style:extra={} }) => {
    const base = {
      width:"100%", padding:"14px 16px", borderRadius:10, fontWeight:700,
      fontSize:14, cursor:disabled?"not-allowed":"pointer", border:"none",
      opacity:disabled?0.5:1, fontFamily:"inherit", ...extra,
    };
    if (variant==="primary")   return <button onClick={onClick} disabled={disabled} style={{ ...base, background:T.accent, color:"#fff" }}>{children}</button>;
    if (variant==="secondary") return <button onClick={onClick} disabled={disabled} style={{ ...base, background:T.card, border:`1.5px solid ${T.border}`, color:T.text }}>{children}</button>;
    if (variant==="ghost")     return <button onClick={onClick} disabled={disabled} style={{ ...base, background:"transparent", border:`1.5px solid ${T.border}`, color:T.sub }}>{children}</button>;
    return null;
  };

  const errBox = error ? (
    <div style={{ background:"#C0392B10", border:"1px solid #C0392B30", color:"#C0392B", borderRadius:8, padding:"9px 14px", fontSize:12, fontWeight:600, marginBottom:14 }}>{error}</div>
  ) : null;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"28px 20px", background:T.bg, width:"100%", boxSizing:"border-box" }}>
      <div style={{ width:"100%", maxWidth:400 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ width:48, height:48, borderRadius:13, background:T.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#fff", margin:"0 auto 14px", letterSpacing:"-0.5px" }}>CP</div>
          <div style={{ fontWeight:800, fontSize:24, color:T.text, letterSpacing:"-0.5px" }}>CashPoint</div>
          <div style={{ fontSize:12, color:T.sub, marginTop:4 }}>Gestion de point Mobile Money</div>
        </div>

        {/* CHOIX INITIAL */}
        {mode==="choose" && (
          <div>
            <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:"0.08em", textAlign:"center", marginBottom:16 }}>JE SUIS</div>
            {[
              { key:"patron",    label:"Patron / Gerant",       desc:"Je gere des agents et plusieurs points" },
              { key:"agent",     label:"Agent (avec invitation)",desc:"J'ai un code d'invitation de mon patron" },
              { key:"independant",label:"Agent Independant",    desc:"Je gere seul mon propre point" },
            ].map(({ key, label, desc })=>(
              <button key={key} onClick={()=>{
                setError("");
                if (key==="patron")      { setMode("patron"); setStep(1); }
                if (key==="agent")       { setMode("agent"); setStep("agent-code"); }
                if (key==="independant") { setMode("independant"); setStep("indep-form"); }
              }} style={{ width:"100%", padding:"16px 18px", borderRadius:12, background:T.card, border:`1.5px solid ${T.border}`, color:T.text, fontWeight:600, fontSize:14, cursor:"pointer", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", textAlign:"left", fontFamily:"inherit" }}>
                <div>
                  <div style={{ fontWeight:700, marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:12, color:T.sub, fontWeight:400 }}>{desc}</div>
                </div>
                <span style={{ color:T.sub, fontSize:18, marginLeft:12 }}>›</span>
              </button>
            ))}
            <button onClick={()=>setDark(d=>!d)} style={{ width:"100%", marginTop:8, padding:"10px", borderRadius:10, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
              {dark?"Mode clair":"Mode sombre"}
            </button>
          </div>
        )}

        {/* PATRON INSCRIPTION */}
        {mode==="patron" && step===1 && (
          <div>
            <div style={{ display:"flex", gap:6, background:T.hero, borderRadius:10, padding:4, marginBottom:22, border:`1px solid ${T.border}` }}>
              <button style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:T.accent, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Nouveau compte</button>
              <button onClick={()=>{setMode("patron-login");setStep("patron-login-form");setError("");}} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:"transparent", color:T.sub, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Se connecter</button>
            </div>
            {[["NOM COMPLET","text","Koffi Mensah","nom"],["NOM ENTREPRISE","text","Point Cash Fidjrosse","entreprise"],["REGISTRE DE COMMERCE","text","RB/COT/24/B/1234","rc"]].map(([lbl,tp,ph,k])=>(
              <div key={k} style={{ marginBottom:12 }}>
                <span style={label}>{lbl}</span>
                <input type={tp} placeholder={ph} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inp} />
              </div>
            ))}
            <div style={{ marginBottom:12 }}>
              <span style={label}>NUMERO DE TELEPHONE</span>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"13px 12px", fontWeight:700, fontSize:13, display:"inline-flex", alignItems:"center" }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
              </div>
            </div>
            <div style={{ marginBottom:20 }}>
              <span style={label}>PAYS</span>
              <select value={form.pays} onChange={e=>setForm(f=>({...f,pays:e.target.value}))} style={{...inp,cursor:"pointer"}}>
                {PAYS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            {errBox}
            <Btn onClick={handlePatronRegister} disabled={loading}>{loading?"Verification...":"Creer mon compte"}</Btn>
            <div style={{ marginTop:10 }}><Btn onClick={()=>setMode("choose")} variant="ghost">Retour</Btn></div>
          </div>
        )}

        {/* PATRON CONNEXION */}
        {mode==="patron-login" && step==="patron-login-form" && (
          <div>
            <div style={{ display:"flex", gap:6, background:T.hero, borderRadius:10, padding:4, marginBottom:22, border:`1px solid ${T.border}` }}>
              <button onClick={()=>{setMode("patron");setStep(1);setError("");}} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:"transparent", color:T.sub, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Nouveau compte</button>
              <button style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background:T.accent, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Se connecter</button>
            </div>
            <div style={{ marginBottom:20 }}>
              <span style={label}>NUMERO DE TELEPHONE</span>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"13px 12px", fontWeight:700, fontSize:13, display:"inline-flex", alignItems:"center" }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus />
              </div>
            </div>
            {errBox}
            <Btn onClick={handlePatronLogin} disabled={loading}>{loading?"Verification...":"Continuer"}</Btn>
            <div style={{ marginTop:10 }}><Btn onClick={()=>setMode("choose")} variant="ghost">Retour</Btn></div>
          </div>
        )}

        {/* AGENT CODE INVITATION */}
        {mode==="agent" && step==="agent-code" && (
          <div>
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <div style={{ fontWeight:700, fontSize:18, color:T.text, marginBottom:6 }}>Code d'invitation</div>
              <div style={{ fontSize:13, color:T.sub }}>Demandez le code a votre patron pour rejoindre son equipe</div>
            </div>
            <span style={label}>CODE D'INVITATION (6 caracteres)</span>
            <input type="text" placeholder="AB12CD" maxLength={6} value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} autoFocus
              style={{...inp,fontSize:22,fontWeight:700,textAlign:"center",letterSpacing:6,marginBottom:14}} />
            {errBox}
            <Btn onClick={handleAgentCode} disabled={loading||form.code.length!==6}>{loading?"Verification...":"Valider le code"}</Btn>
            <Divider />
            <div style={{ textAlign:"center", fontSize:13, color:T.sub, marginBottom:14 }}>
              Deja un compte ?{" "}
              <button onClick={()=>{setMode("agent-login");setStep("agent-login-form");setError("");}} style={{ background:"none", border:"none", color:T.accent, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Se connecter</button>
            </div>
            <Btn onClick={()=>setMode("choose")} variant="ghost">Retour</Btn>
          </div>
        )}

        {/* AGENT FORMULAIRE */}
        {mode==="agent" && step==="agent-form" && (
          <div>
            <div style={{ background:`${T.accent}12`, border:`1px solid ${T.accent}30`, borderRadius:10, padding:"10px 14px", marginBottom:20, fontSize:12, color:T.accent, fontWeight:600 }}>
              Code valide — vous rejoignez l'equipe de votre patron
            </div>
            <div style={{ marginBottom:12 }}>
              <span style={label}>NOM COMPLET</span>
              <input type="text" placeholder="Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus />
            </div>
            <div style={{ marginBottom:20 }}>
              <span style={label}>NUMERO DE TELEPHONE</span>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"13px 12px", fontWeight:700, fontSize:13, display:"inline-flex", alignItems:"center" }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
              </div>
            </div>
            {errBox}
            <Btn onClick={handleAgentForm} disabled={loading}>{loading?"Verification...":"Creer mon compte"}</Btn>
          </div>
        )}

        {/* AGENT INDEPENDANT FORMULAIRE */}
        {mode==="independant" && step==="indep-form" && (
          <div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontWeight:700, fontSize:17, color:T.text, marginBottom:4 }}>Agent Independant</div>
              <div style={{ fontSize:13, color:T.sub }}>Vous gerez votre propre point sans patron rattache.</div>
            </div>
            <div style={{ marginBottom:12 }}>
              <span style={label}>NOM COMPLET</span>
              <input type="text" placeholder="Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus />
            </div>
            <div style={{ marginBottom:20 }}>
              <span style={label}>NUMERO DE TELEPHONE</span>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"13px 12px", fontWeight:700, fontSize:13, display:"inline-flex", alignItems:"center" }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
              </div>
            </div>
            {errBox}
            <Btn onClick={handleIndepForm} disabled={loading}>{loading?"Verification...":"Creer mon compte"}</Btn>
            <div style={{ marginTop:10 }}><Btn onClick={()=>setMode("choose")} variant="ghost">Retour</Btn></div>
          </div>
        )}

        {/* AGENT CONNEXION */}
        {mode==="agent-login" && step==="agent-login-form" && (
          <div>
            <div style={{ fontWeight:700, fontSize:18, color:T.text, marginBottom:20 }}>Connexion Agent</div>
            <div style={{ marginBottom:20 }}>
              <span style={label}>NUMERO DE TELEPHONE</span>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"13px 12px", fontWeight:700, fontSize:13, display:"inline-flex", alignItems:"center" }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus />
              </div>
            </div>
            {errBox}
            <Btn onClick={handleAgentLogin} disabled={loading}>{loading?"Verification...":"Continuer"}</Btn>
            <div style={{ marginTop:10 }}><Btn onClick={()=>setMode("choose")} variant="ghost">Retour</Btn></div>
          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function CashPoint() {
  const [dark,setDark]     = useState(true);
  const T                  = dark ? DARK : LIGHT;
  const OP_BG              = dark ? OP_BG_D : OP_BG_L;

  // AUTH
  const [patron,  setPatron]  = useState(lsGet("ks_patron"));
  const [agent,   setAgent]   = useState(lsGet("ks_agent"));
  const [locked,  setLocked]  = useState(!!lsGet("ks_patron")||!!lsGet("ks_agent"));
  const [pinErr,  setPinErr]  = useState("");
  const [pinAttempts,setPinAttempts] = useState(0);
  const [pinBlocked, setPinBlocked]  = useState(false);
  const [pinBlockTime,setPinBlockTime] = useState(null);

  // UI
  const [tab,        setTab]       = useState("dashboard");
  const [loading,    setLoading]   = useState(false);
  const [saving,     setSaving]    = useState(false);
  const [flash,      setFlash]     = useState(null);
  const [flashErr,   setFlashErr]  = useState(null);
  const [modal,      setModal]     = useState(null);
  const [form,       setForm]      = useState({});
  const [confirm,    setConfirm]   = useState(null);
  const [confirmLogout,setConfirmLogout] = useState(false);
  const [showCal,    setShowCal]   = useState(false);
  const [selectedDate,setSelectedDate]  = useState(todayStr());
  const [calMonth,   setCalMonth]  = useState(new Date().getMonth()+1);
  const [calYear,    setCalYear]   = useState(new Date().getFullYear());

  // PATRON DATA
  const [agents,       setAgents]       = useState([]);
  const [allTxs,       setAllTxs]       = useState([]);
  const [allFloats,    setAllFloats]    = useState([]);
  const [selectedAgent,setSelectedAgent]= useState(null);
  const [inviteCode,   setInviteCode]   = useState(null);
  const [confirmDelAgent,setConfirmDelAgent] = useState(null);
  const [deletingAgent,  setDeletingAgent]   = useState(false);

  // AGENT DATA
  const [agentTxs,    setAgentTxs]    = useState([]);
  const [pendingCount,setPendingCount]= useState(0);
  const [showReport,  setShowReport]  = useState(false);
  const [floats,      setFloats]      = useState({ MTN:null, MOOV:null, Celtiis:null });
  const [capitalCash, setCapitalCash] = useState(null);
  const [cashInput,   setCashInput]   = useState("");
  const [showCashModal,setShowCashModal]     = useState(false);
  const [showFloatModal,setShowFloatModal]   = useState(false);
  const [floatEditOp,  setFloatEditOp]       = useState(null);
  const [floatInput,   setFloatInput]        = useState("");
  const [showMorning,  setShowMorning]       = useState(false);
  const [morningInputs,setMorningInputs]     = useState({ cash:"", MTN:"", MOOV:"", Celtiis:"" });

  const isPatron = !!patron;
  const isAgent  = !!agent;
  const isToday  = selectedDate === todayStr();

  // EFFETS
  useEffect(()=>{
    const bg=dark?"#080A10":"#F2F4F9";
    document.documentElement.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;width:100%!important;`;
    document.body.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;`;
  },[dark]);

  useEffect(()=>{
    document.title="CashPoint";
  },[]);

  useEffect(()=>{ if (patron&&!locked) loadPatronData(); },[patron,locked,selectedDate]);

  useEffect(()=>{
    if (!patron||locked) return;
    const iv = setInterval(()=>{ loadPatronData(); }, 30000);
    return ()=>clearInterval(iv);
  },[patron,locked,selectedDate]);

  useEffect(()=>{ if (agent&&!locked) { loadAgentTxs(selectedDate); loadAgentFloats(selectedDate); } },[agent,locked,selectedDate]);

  useEffect(()=>{
    if (!agent||locked) return;
    const today=todayStr(); if (selectedDate!==today) return;
    const sf=lsGet(floatKey(today,agent.id||agent.telephone));
    const sc=lsGet(cashKey(today,agent.id||agent.telephone));
    const noFloat=!sf||Object.values(sf).every(v=>v===null);
    const noCash=sc===null||sc===undefined;
    if (noFloat&&noCash) setShowMorning(true);
  },[agent,locked,selectedDate]);

  useEffect(()=>{
    if (agent) { const p=lsGet(pendKey(agent.id||agent.telephone)); setPendingCount(p?p.length:0); }
  },[agent,agentTxs]);

  useEffect(()=>{
    if (!agent) return;
    const trySync=async()=>{ const s=await flushPending(agent.id||agent.telephone); if (s.length>0) { setPendingCount(0); loadAgentTxs(selectedDate); } };
    window.addEventListener("online",trySync); trySync();
    return ()=>window.removeEventListener("online",trySync);
  },[agent]);

  useEffect(()=>{
    window.history.pushState({cp:true},"");
    const onPop=()=>{ window.history.pushState({cp:true},""); setModal(null);setShowCal(false);setConfirm(null);setConfirmLogout(false); };
    window.addEventListener("popstate",onPop);
    return ()=>window.removeEventListener("popstate",onPop);
  },[]);

  useEffect(()=>{
    if (!agent) return;
    let last=todayStr();
    const iv=setInterval(()=>{ const now=todayStr(); if (now!==last) { last=now; setSelectedDate(now); setAgentTxs([]); } },60000);
    return ()=>clearInterval(iv);
  },[agent]);

  // CHARGEMENT DATA
  async function loadPatronData() {
    setLoading(true);
    const ag = await fetchAgents(patron.id);
    setAgents(ag);
    const agentIds = ag.map(a => a.id).filter(Boolean);
    const [txs, fls] = await Promise.all([
      fetchAllTxsForPatron(patron.id, selectedDate, agentIds),
      fetchAllFloatsForPatron(patron.id, selectedDate, agentIds),
    ]);
    setAllTxs(txs); setAllFloats(fls);
    setLoading(false);
  }

  async function loadAgentTxs(date) {
    setLoading(true);
    const key=txKey(date,agent.id||agent.telephone);
    const cached=lsGet(key)||[];
    if (cached.length>0) { setAgentTxs(cached); setLoading(false); }
    const fresh=await fetchAgentTxs(agent.id||agent.telephone,date);
    if (fresh.length>0) { setAgentTxs(fresh); lsSet(key,fresh); }
    else if (!cached.length) setAgentTxs([]);
    setLoading(false);
  }

  function loadAgentFloats(date) {
    const uid=agent.id||agent.telephone;
    const sf=lsGet(floatKey(date,uid));
    setFloats(sf||{MTN:null,MOOV:null,Celtiis:null});
    const sc=lsGet(cashKey(date,uid));
    setCapitalCash(sc!==null&&sc!==undefined?Number(sc):null);
  }

  // DEVERROUILLAGE PIN
  async function handleUnlock(pin) {
    if (pinBlocked) {
      const diff=Math.ceil((pinBlockTime+5*60*1000-Date.now())/60000);
      setPinErr(`Acces bloque. Reessayez dans ${diff} min.`); return;
    }
    const user=patron||agent;
    const pinHash=await hashPin(pin);
    if (pinHash===user.pin) {
      if (isPatron) fetchPatron(patron.telephone).then(f=>{ if(f){ const t={...f,pin:patron.pin}; lsSet("ks_patron",t); setPatron(t); } });
      if (isAgent)  fetchAgent(agent.telephone).then(f=>{ if(f){ const t={...f,pin:agent.pin}; lsSet("ks_agent",t); setAgent(t); } });
      setLocked(false); setPinErr(""); setPinAttempts(0);
    } else {
      const n=pinAttempts+1; setPinAttempts(n);
      if (n>=3) {
        setPinBlocked(true); setPinBlockTime(Date.now());
        setPinErr("3 tentatives echouees — acces bloque 5 minutes.");
        setTimeout(()=>{ setPinBlocked(false);setPinAttempts(0);setPinErr(""); },5*60*1000);
      } else { setPinErr(`Code PIN incorrect. ${3-n} tentative${3-n>1?"s":""} restante${3-n>1?"s":""}.`); }
    }
  }

  function handleLogout() {
    lsDel("ks_patron"); lsDel("ks_agent");
    setPatron(null); setAgent(null); setLocked(false); setTab("dashboard"); setConfirmLogout(false);
  }

  // AJOUTER TRANSACTION
  async function addTx() {
    if (!form.operateur||!form.montant) return;
    setSaving(true);
    const uid=agent.id||agent.telephone;
    const com=modal==="retrait"?calcFrais(form.operateur,Number(form.montant)):0;
    const localId=Date.now();
    const tx={
      agent_id:agent.id, patron_id:agent.patron_id||null,
      type:modal, operateur:form.operateur, montant:Number(form.montant), commission:com,
      telephone:form.telephone?`01${form.telephone}`:null,
      heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      created_at:nowISO(), localId,
    };
    const optimistic={...tx,id:localId};
    setAgentTxs(p=>[optimistic,...p]);
    const result=await saveTx(tx);
    if (result.ok) {
      setAgentTxs(p=>p.map(t=>t.id===localId?result.data:t));
    } else {
      setFlashErr(result.error);
      setTimeout(()=>setFlashErr(null), 6000);
      const pend=lsGet(pendKey(uid))||[];
      lsSet(pendKey(uid),[...pend,tx]); setPendingCount(c=>c+1);
    }
    const cached=lsGet(txKey(selectedDate,uid))||[];
    lsSet(txKey(selectedDate,uid),[(result.ok?result.data:optimistic),...cached]);
    setSaving(false); setModal(null); setForm({});
    if (result.ok) { setFlash(modal); setTimeout(()=>setFlash(null),2200); }
    setTimeout(()=>loadAgentTxs(selectedDate),1200);
  }

  async function addForfaitTx() {
    if (!form.forfaitOp||!form.forfaitPrix) return;
    setSaving(true);
    const uid=agent.id||agent.telephone; const localId=Date.now();
    const tx={
      agent_id:agent.id, patron_id:agent.patron_id||null,
      type:"forfait", operateur:form.forfaitOp, montant:Number(form.forfaitPrix), commission:0,
      telephone:null,
      heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      created_at:nowISO(), localId,
    };
    const opt={...tx,id:localId}; setAgentTxs(p=>[opt,...p]);
    const result=await saveTx(tx);
    if (result.ok) { setAgentTxs(p=>p.map(t=>t.id===localId?result.data:t)); }
    else {
      setFlashErr(result.error); setTimeout(()=>setFlashErr(null), 6000);
      const pend=lsGet(pendKey(uid))||[]; lsSet(pendKey(uid),[...pend,tx]); setPendingCount(c=>c+1);
    }
    lsSet(txKey(selectedDate,uid),[(result.ok?result.data:opt),...(lsGet(txKey(selectedDate,uid))||[])]);
    setSaving(false); setForm({});
    if (result.ok) { setFlash("forfait"); setTimeout(()=>setFlash(null),2200); }
    setTimeout(()=>loadAgentTxs(selectedDate),1200);
  }

  async function removeAgentTx(id) {
    await deleteTx(id);
    const updated=agentTxs.filter(t=>t.id!==id);
    setAgentTxs(updated);
    lsSet(txKey(selectedDate,agent.id||agent.telephone),updated);
    setConfirm(null);
  }

  // FLOATS
  function saveAgentFloat(op,solde) {
    const uid=agent.id||agent.telephone;
    const updated={...floats,[op]:Number(solde)};
    setFloats(updated); lsSet(floatKey(selectedDate,uid),updated);
    saveFloat({
      agent_id:agent.id, patron_id:agent.patron_id||null, date:selectedDate, cash:capitalCash||0,
      float_mtn:op==="MTN"?Number(solde):(updated.MTN||null),
      float_moov:op==="MOOV"?Number(solde):(updated.MOOV||null),
      float_celtiis:op==="Celtiis"?Number(solde):(updated.Celtiis||null),
    });
  }

  function calcCashActuel() {
    if (capitalCash===null) return null;
    const deps=agentTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const rets=agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    return capitalCash+deps-rets;
  }

  function calcFloatActuel(op) {
    if (floats[op]===null||floats[op]===undefined) return null;
    const deps=agentTxs.filter(t=>t.operateur===op&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const rets=agentTxs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const forf=agentTxs.filter(t=>t.operateur===op&&t.type==="forfait").reduce((s,t)=>s+Number(t.montant),0);
    return floats[op]-deps+rets-forf;
  }

  function getFloatStatus(actuel,depart) {
    if (actuel===null||!depart) return { color:"#3D4260", label:null };
    if (actuel<0) return { color:"#C0392B", label:"Depasse" };
    const p=actuel/depart;
    if (p<0.15) return { color:"#C0392B", label:"Critique" };
    if (p<0.35) return { color:"#C09000", label:"Faible" };
    return { color:"#1A7A5E", label:"OK" };
  }

  // STATS PATRON
  function getAgentStats(agentId) {
    const txs=allTxs.filter(t=>t.agent_id===agentId);
    const fl=allFloats.find(f=>f.agent_id===agentId)||null;
    const deps=txs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const rets=txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const frais=txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
    const cashDepart=fl?Number(fl.cash||0):null;
    const cashActuel=cashDepart!==null?cashDepart+deps-rets:null;
    const mtnD=fl?Number(fl.float_mtn||0):null;
    const moovD=fl?Number(fl.float_moov||0):null;
    const celtD=fl?Number(fl.float_celtiis||0):null;
    const mtnA=mtnD!==null?mtnD-txs.filter(t=>t.operateur==="MTN"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="MTN"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const moovA=moovD!==null?moovD-txs.filter(t=>t.operateur==="MOOV"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="MOOV"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const celtA=celtD!==null?celtD-txs.filter(t=>t.operateur==="Celtiis"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="Celtiis"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const momoA=(mtnA||0)+(moovA||0)+(celtA||0);
    const pointTotal=cashActuel!==null?cashActuel+momoA:null;
    return { depots:deps,retraits:rets,fraisRetrait:frais,nbOps:txs.length,lastOp:txs[0]?.heure||null,cashDepart,cashActuel,mtnActuel:mtnA,moovActuel:moovA,celtiisActuel:celtA,momoActuel:momoA,pointTotal,fl,mtnD,moovD,celtD };
  }

  // GARDES
  if (!patron&&!agent) return <AuthScreen T={T} dark={dark} setDark={setDark}
    onPatronLogin={p=>{setPatron(p);lsSet("ks_patron",p);setLocked(false);setTab("dashboard");}}
    onAgentLogin={a=>{setAgent(a);lsSet("ks_agent",a);setLocked(false);setTab("accueil");}} />;
  if (locked) return <PinPad title="Bon retour" subtitle={`${(patron||agent).nom.split(" ")[0]}`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  const totalAgentCA  = agentTxs.reduce((s,t)=>s+Number(t.montant),0);
  const totalAgentCom = agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
  const NAV_PATRON = [["dashboard","Dashboard"],["agents","Agents"],["profil","Profil"]];
  const NAV_AGENT  = [["accueil","Accueil"],["stats","Stats"],["historique","Historique"],["profil","Profil"]];

  // COMPOSANTS INTERNES
  const Card = ({ children, style:extra={} }) => (
    <div style={{ background:T.card, borderRadius:14, padding:"18px 18px", border:`1px solid ${T.border}`, ...extra }}>{children}</div>
  );

  const SectionLabel = ({ children }) => (
    <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:"0.1em", marginBottom:12 }}>{children}</div>
  );

  const StatRow = ({ label, value, valueColor }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${T.border}` }}>
      <span style={{ fontSize:13, color:T.sub }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color:valueColor||T.text }}>{value}</span>
    </div>
  );

  const Badge = ({ children, color="#1A7A5E" }) => (
    <span style={{ background:`${color}14`, border:`1px solid ${color}30`, color, borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:700 }}>{children}</span>
  );

  return (<>
    <style>{`*,*::before,*::after{box-sizing:border-box!important;}html,body{margin:0!important;padding:0!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;}button{-webkit-tap-highlight-color:transparent!important;font-family:inherit;}input,select{outline:none;font-family:inherit;}`}</style>

    <div style={{ background:T.bg, minHeight:"100vh", width:"100vw", color:T.text, fontFamily:"'Segoe UI',system-ui,sans-serif", overflowX:"hidden" }}>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash]||T.accent, color:"#fff", borderRadius:8, padding:"10px 24px", fontWeight:700, fontSize:13, zIndex:9999, boxShadow:"0 4px 20px rgba(0,0,0,0.25)", whiteSpace:"nowrap" }}>
          {TYPE_LABEL[flash]} enregistre
        </div>
      )}
      {flashErr && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", background:"#C0392B", color:"#fff", borderRadius:8, padding:"10px 20px", fontWeight:600, fontSize:12, zIndex:9999, boxShadow:"0 4px 20px rgba(0,0,0,0.25)", maxWidth:"90vw", textAlign:"center" }}>
          Erreur sync : {flashErr}
        </div>
      )}

      {/* HEADER */}
      <header style={{ background:T.card, padding:"12px 18px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:T.accent, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#fff", letterSpacing:"-0.5px" }}>CP</div>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:T.text, letterSpacing:"-0.3px" }}>CashPoint</div>
            <div style={{ fontSize:10, color:T.sub }}>{isPatron?patron.nom_entreprise:agent.nom}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {isAgent && pendingCount>0 && <Badge color="#C09000">{pendingCount} en attente</Badge>}
          {isAgent && <button onClick={()=>setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 9px", cursor:"pointer", fontSize:13, color:T.sub }}>Cal.</button>}
          <button onClick={()=>setDark(d=>!d)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 9px", cursor:"pointer", fontSize:12, color:T.sub }}>{dark?"Clair":"Sombre"}</button>
        </div>
      </header>

      {/* Bandeau date passee */}
      {!isToday && (
        <div style={{ background:"#1A4A8A12", border:"1px solid #1A4A8A30", margin:"12px 16px 0", borderRadius:10, padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:13, fontWeight:600, color:"#1A4A8A" }}>{new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</span>
          <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#1A4A8A", border:"none", borderRadius:7, padding:"4px 12px", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer" }}>Aujourd'hui</button>
        </div>
      )}

      {/* CONTENU PRINCIPAL */}
      <main style={{ padding:"16px 16px 110px", width:"100%", boxSizing:"border-box" }}>

        {/* ── DASHBOARD PATRON ── */}
        {isPatron && tab==="dashboard" && !selectedAgent && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px" }}>{getSalutation(patron.nom)}</div>
                <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{isToday?"Aujourd'hui":new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>setShowCal(true)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 11px", color:T.sub, fontSize:12, cursor:"pointer" }}>Date</button>
                <button onClick={loadPatronData} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 11px", color:T.sub, fontSize:12, cursor:"pointer" }}>Sync</button>
              </div>
            </div>

            {/* Totaux globaux */}
            {(()=>{
              const totalCA=allTxs.reduce((s,t)=>s+Number(t.montant),0);
              const totalFrais=allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
              const totalDeps=allTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
              const totalRets=allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
              return (
                <Card style={{ marginBottom:16 }}>
                  <SectionLabel>RESUME DU JOUR — {allTxs.length} OPERATIONS</SectionLabel>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:4, fontWeight:600 }}>CA TOTAL</div>
                      <div style={{ fontSize:24, fontWeight:700, color:T.accent, letterSpacing:"-0.5px" }}>{fF(totalCA)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:4, fontWeight:600 }}>FRAIS RETRAIT</div>
                      <div style={{ fontSize:24, fontWeight:700, color:"#C09000", letterSpacing:"-0.5px" }}>{fF(totalFrais)}</div>
                    </div>
                  </div>
                  <div style={{ height:1, background:T.border, margin:"0 0 12px" }} />
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:3, fontWeight:600 }}>DEPOTS</div>
                      <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{fF(totalDeps)}</div>
                      <div style={{ fontSize:11, color:T.sub }}>{allTxs.filter(t=>t.type==="depot").length} op.</div>
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:3, fontWeight:600 }}>RETRAITS</div>
                      <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{fF(totalRets)}</div>
                      <div style={{ fontSize:11, color:T.sub }}>{allTxs.filter(t=>t.type==="retrait").length} op.</div>
                    </div>
                  </div>
                </Card>
              );
            })()}

            {/* Liste agents */}
            <SectionLabel>MES AGENTS — {agents.length}</SectionLabel>
            {loading && <div style={{ textAlign:"center", color:T.sub, padding:32, fontSize:13 }}>Chargement...</div>}
            {!loading && agents.length===0 && (
              <Card style={{ textAlign:"center", padding:32 }}>
                <div style={{ fontWeight:600, marginBottom:8 }}>Aucun agent enregistre</div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Generez un code d'invitation depuis l'onglet Agents</div>
                <button onClick={()=>setTab("agents")} style={{ background:T.accent, border:"none", borderRadius:8, padding:"10px 20px", color:"#fff", fontWeight:700, cursor:"pointer" }}>Ajouter un agent</button>
              </Card>
            )}
            {agents.map(ag=>{
              const s=getAgentStats(ag.id);
              const actif=s.nbOps>0;
              return (
                <div key={ag.id} onClick={()=>setSelectedAgent(ag)} style={{ background:T.card, borderRadius:14, padding:"14px 16px", marginBottom:10, border:`1px solid ${T.border}`, borderLeft:`3px solid ${actif?T.accent:T.border}`, cursor:"pointer" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:14 }}>{ag.nom}</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{actif?`Derniere op : ${s.lastOp}`:"Aucune operation aujourd'hui"}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Badge color={actif?T.accent:"#3D4260"}>{actif?"Actif":"Inactif"}</Badge>
                      <span style={{ color:T.sub, fontSize:16 }}>›</span>
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                    {[["CA",fF(s.depots+s.retraits),T.text],["Frais",fF(s.fraisRetrait),"#C09000"],["Cash en sac",s.cashActuel!==null?fF(s.cashActuel):"—",s.cashActuel!==null&&s.cashActuel<0?"#C0392B":T.text]].map(([lbl,val,col])=>(
                      <div key={lbl} style={{ background:T.hero, borderRadius:8, padding:"8px 10px" }}>
                        <div style={{ fontSize:9, color:T.sub, marginBottom:3, fontWeight:700, letterSpacing:"0.05em" }}>{lbl}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Transactions live */}
            {allTxs.length > 0 && (
              <Card style={{ marginTop:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <SectionLabel>OPERATIONS EN DIRECT</SectionLabel>
                  <Badge color={T.accent}>Live</Badge>
                </div>
                {allTxs.map((t,i)=>{
                  const agNom=agents.find(a=>a.id===t.agent_id)?.nom||"Agent";
                  return (
                    <div key={t.id||i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:i<allTxs.length-1?`1px solid ${T.border}`:"none" }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:TYPE_COLOR[t.type]||T.accent, flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur], fontWeight:700 }}>{t.operateur}</span></div>
                        <div style={{ fontSize:11, color:T.sub }}>{agNom} · {t.heure||""}</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontWeight:700, color:TYPE_COLOR[t.type]||T.accent, fontSize:14 }}>{fF(t.montant)}</div>
                        {t.commission>0 && <div style={{ fontSize:11, color:"#C09000" }}>frais {fF(t.commission)}</div>}
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}

        {/* ── DETAIL AGENT (PATRON) ── */}
        {isPatron && tab==="dashboard" && selectedAgent && (()=>{
          const ag=selectedAgent; const s=getAgentStats(ag.id);
          return (
            <div>
              <button onClick={()=>setSelectedAgent(null)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 14px", color:T.text, fontSize:13, fontWeight:600, cursor:"pointer", marginBottom:18 }}>Retour</button>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px" }}>{ag.nom}</div>
                  <div style={{ fontSize:12, color:T.sub }}>+229 {ag.telephone}</div>
                </div>
                <Badge color={s.nbOps>0?T.accent:"#3D4260"}>{s.nbOps>0?"Actif":"Inactif"}</Badge>
              </div>

              {/* Liquidites */}
              <Card style={{ marginBottom:12 }}>
                <SectionLabel>ARGENT LIQUIDE (SAC)</SectionLabel>
                {s.cashDepart===null?(
                  <div style={{ color:T.sub, fontSize:13 }}>Donnees de depart non renseignees</div>
                ):(
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    {[["Depart",fF(s.cashDepart),T.sub],["Entrees","+"+fF(s.depots),T.accent],["Solde",fF(s.cashActuel),s.cashActuel<0?"#C0392B":T.text]].map(([lbl,val,col])=>(
                      <div key={lbl} style={{ background:T.hero, borderRadius:8, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, color:T.sub, marginBottom:4, fontWeight:600 }}>{lbl}</div>
                        <div style={{ fontSize:15, fontWeight:700, color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Comptes MoMo */}
              <Card style={{ marginBottom:12 }}>
                <SectionLabel>COMPTES MOMO</SectionLabel>
                {[{op:"MTN",a:s.mtnActuel,d:s.mtnD},{op:"MOOV",a:s.moovActuel,d:s.moovD},{op:"Celtiis",a:s.celtiisActuel,d:s.celtD}].map(({op,a,d},i)=>{
                  const st=getFloatStatus(a,d);
                  return (
                    <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:28, height:28, borderRadius:7, background:OP_BG_D[op], border:`1px solid ${OP_COLORS[op]}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:800, color:OP_COLORS[op] }}>{op}</div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600 }}>{op}</div>
                          {d!==null && <div style={{ fontSize:10, color:T.sub }}>Depart : {fF(d)}</div>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {a!==null?(
                          <>
                            <div style={{ fontSize:15, fontWeight:700, color:st.color }}>{fF(a)}</div>
                            {st.label && <div style={{ fontSize:10, fontWeight:600, color:st.color }}>{st.label}</div>}
                          </>
                        ):<div style={{ fontSize:12, color:T.sub }}>Non renseigne</div>}
                      </div>
                    </div>
                  );
                })}
              </Card>

              {/* Point total */}
              <Card style={{ marginBottom:12 }}>
                <SectionLabel>POINT TOTAL DU JOUR</SectionLabel>
                <StatRow label="Argent liquide" value={fF(s.cashActuel||0)} valueColor={s.cashActuel<0?"#C0392B":T.text} />
                <StatRow label="Total MoMo" value={fF(s.momoActuel)} />
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12, marginTop:4 }}>
                  <span style={{ fontWeight:700, fontSize:14 }}>Total general</span>
                  <span style={{ fontWeight:800, fontSize:22, color:T.accent, letterSpacing:"-0.5px" }}>{s.pointTotal!==null?fF(s.pointTotal):"—"}</span>
                </div>
              </Card>

              {/* Bilan */}
              <Card>
                <SectionLabel>BILAN JOURNEE</SectionLabel>
                <StatRow label="CA total" value={fF(s.depots+s.retraits)} valueColor={T.accent} />
                <StatRow label={`Depots (${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="depot").length} op.)`} value={fF(s.depots)} valueColor={T.accent} />
                <StatRow label={`Retraits (${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="retrait").length} op.)`} value={fF(s.retraits)} />
                <StatRow label="Frais de retrait" value={fF(s.fraisRetrait)} valueColor="#C09000" />
              </Card>
            </div>
          );
        })()}

        {/* ── GESTION AGENTS (PATRON) ── */}
        {isPatron && tab==="agents" && (
          <div>
            <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px", marginBottom:20 }}>Agents ({agents.length}/10)</div>
            <Card style={{ marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>Ajouter un agent</div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Generez un code unique a transmettre a votre agent.</div>
              {inviteCode?(
                <div>
                  <div style={{ background:`${T.accent}12`, border:`1px solid ${T.accent}30`, borderRadius:10, padding:"18px", textAlign:"center", marginBottom:12 }}>
                    <div style={{ fontSize:10, color:T.sub, marginBottom:6, fontWeight:700, letterSpacing:"0.1em" }}>CODE D'INVITATION</div>
                    <div style={{ fontSize:32, fontWeight:800, color:T.accent, letterSpacing:6 }}>{inviteCode}</div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:6 }}>Usage unique</div>
                  </div>
                  <button onClick={()=>navigator.clipboard?.writeText(inviteCode)} style={{ width:"100%", padding:"11px", borderRadius:9, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:13, cursor:"pointer", marginBottom:8, fontFamily:"inherit" }}>Copier le code</button>
                  <button onClick={()=>setInviteCode(null)} style={{ width:"100%", padding:"11px", borderRadius:9, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Generer un autre code</button>
                </div>
              ):(
                <button onClick={async()=>{ const c=await generateInviteCode(patron.id); setInviteCode(c); }} disabled={agents.length>=10}
                  style={{ width:"100%", padding:"13px", borderRadius:9, background:agents.length>=10?T.hero:T.accent, border:"none", color:agents.length>=10?T.sub:"#fff", fontWeight:700, fontSize:13, cursor:agents.length>=10?"not-allowed":"pointer", fontFamily:"inherit" }}>
                  {agents.length>=10?"Maximum 10 agents atteint":"Generer un code d'invitation"}
                </button>
              )}
            </Card>
            {agents.map(ag=>(
              <div key={ag.id} style={{ background:T.card, borderRadius:12, padding:"13px 15px", marginBottom:8, border:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{ag.nom}</div>
                  <div style={{ fontSize:12, color:T.sub }}>+229 {ag.telephone}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Badge color={T.accent}>Actif</Badge>
                  <button onClick={()=>setConfirmDelAgent(ag)} style={{ background:"#C0392B12", border:"1px solid #C0392B30", borderRadius:7, padding:"6px 10px", color:"#C0392B", fontSize:12, cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>Retirer</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── ACCUEIL AGENT ── */}
        {isAgent && tab==="accueil" && (
          <>
            <div style={{ marginBottom:18 }}>
              <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px" }}>{getSalutation(agent.nom)}</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{isToday?"Tableau de bord du jour":new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</div>
            </div>

            {/* Capital Cash */}
            {(()=>{
              const cashActuel=calcCashActuel();
              const depT=agentTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
              const retT=agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
              const cashColor=cashActuel===null?T.sub:cashActuel<0?"#C0392B":T.text;
              return (
                <Card style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <SectionLabel>CAPITAL CASH</SectionLabel>
                    {isToday && <button onClick={()=>{setCashInput(capitalCash!==null?String(capitalCash):"");setShowCashModal(true);}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 11px", color:T.sub, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{capitalCash===null?"Definir":"Modifier"}</button>}
                  </div>
                  {capitalCash===null?(
                    <div style={{ color:T.sub, fontSize:13, textAlign:"center", padding:"8px 0" }}>Capital de depart non renseigne</div>
                  ):(
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                      {[["Depart",fF(capitalCash),T.sub],["+Depots","+"+fF(depT),T.accent],["Disponible",fF(cashActuel),cashColor]].map(([lbl,val,col])=>(
                        <div key={lbl} style={{ background:T.hero, borderRadius:8, padding:"10px 10px" }}>
                          <div style={{ fontSize:9, color:T.sub, marginBottom:3, fontWeight:700, letterSpacing:"0.05em" }}>{lbl}</div>
                          <div style={{ fontSize:14, fontWeight:700, color:col }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {cashActuel!==null && cashActuel<0 && (
                    <div style={{ marginTop:10, background:"#C0392B12", border:"1px solid #C0392B30", borderRadius:7, padding:"7px 12px", fontSize:12, color:"#C0392B", fontWeight:600 }}>Cash insuffisant — manque {fF(Math.abs(cashActuel))}</div>
                  )}
                </Card>
              );
            })()}

            {/* Soldes MoMo */}
            <Card style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <SectionLabel>SOLDES ELECTRONIQUES</SectionLabel>
                {isToday && <button onClick={()=>{setFloatEditOp(null);setFloatInput("");setShowFloatModal(true);}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 11px", color:T.sub, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Modifier</button>}
              </div>
              {OPS.map((op,i)=>{
                const actuel=calcFloatActuel(op); const depart=floats[op];
                const st=getFloatStatus(actuel,depart);
                const depO=agentTxs.filter(t=>t.operateur===op&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
                const retO=agentTxs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
                return (
                  <div key={op} style={{ paddingBottom:i<2?14:0, marginBottom:i<2?14:0, borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:30, height:30, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}30`, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:800, color:OP_COLORS[op] }}>{op}</div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                          {depart!==null && <div style={{ fontSize:10, color:T.sub }}>Depart : {fF(depart)}</div>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {actuel!==null?(
                          <>
                            <div style={{ fontSize:16, fontWeight:700, color:st.color }}>{fF(actuel)}</div>
                            {st.label && <div style={{ fontSize:10, fontWeight:700, color:st.color }}>{st.label}</div>}
                          </>
                        ):(
                          <button onClick={()=>{setFloatEditOp(op);setFloatInput("");setShowFloatModal(true);}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 10px", color:T.sub, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Definir</button>
                        )}
                      </div>
                    </div>
                    {depart!==null && (depO>0||retO>0) && (
                      <div style={{ display:"flex", gap:6, marginTop:8 }}>
                        {depO>0 && <div style={{ flex:1, background:"#C0392B10", border:"1px solid #C0392B20", borderRadius:6, padding:"4px 8px", fontSize:10, color:"#C0392B", fontWeight:600 }}>Dep -{fF(depO)}</div>}
                        {retO>0 && <div style={{ flex:1, background:`${T.accent}10`, border:`1px solid ${T.accent}20`, borderRadius:6, padding:"4px 8px", fontSize:10, color:T.accent, fontWeight:600 }}>Ret +{fF(retO)}</div>}
                      </div>
                    )}
                    {actuel!==null && actuel<5000 && actuel>=0 && (
                      <div style={{ marginTop:6, background:"#C09000", borderRadius:6, padding:"4px 10px", fontSize:10, color:"#fff", fontWeight:600, display:"inline-block" }}>Solde {op} bas</div>
                    )}
                  </div>
                );
              })}
            </Card>

            {/* Vente forfaits */}
            {isToday && (
              <Card style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <SectionLabel>VENTE D'UNITES</SectionLabel>
                  <span style={{ fontSize:11, color:T.sub }}>{agentTxs.filter(t=>t.type==="forfait").length} vendu(s)</span>
                </div>
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:"0.08em", marginBottom:8 }}>1 — TYPE</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {[["internet","Internet"],["appel","Appel"],["simple","Simple"]].map(([k,lbl])=>(
                      <button key={k} onClick={()=>setForm(f=>({...f,forfaitType:f.forfaitType===k?null:k,forfaitPrix:null,forfaitOp:null}))}
                        style={{ flex:1, padding:"10px 4px", borderRadius:9, border:`1.5px solid ${form.forfaitType===k?T.accent:T.border}`, background:form.forfaitType===k?`${T.accent}12`:"transparent", color:form.forfaitType===k?T.accent:T.sub, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                {form.forfaitType && (
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:"0.08em", marginBottom:8 }}>2 — RESEAU</div>
                    <div style={{ display:"flex", gap:8 }}>
                      {OPS.map(op=>(
                        <button key={op} onClick={()=>setForm(f=>({...f,forfaitOp:f.forfaitOp===op?null:op,forfaitPrix:null}))}
                          style={{ flex:1, padding:"10px 0", borderRadius:9, border:`1.5px solid ${form.forfaitOp===op?OP_COLORS[op]:T.border}`, background:form.forfaitOp===op?OP_BG[op]:"transparent", color:form.forfaitOp===op?OP_COLORS[op]:T.sub, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                          {op}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {form.forfaitType && form.forfaitOp && (()=>{
                  const G={MTN:{internet:[100,300,500,1000,2000,3500,6000,15000,25000,50000],appel:[100,150,200,300,500,1000,2500,5000],simple:[100,200,500,1000,2000,5000]},MOOV:{internet:[200,500,1000,2000,4500,8000,15000,20000,50000],appel:[100,200,500,1000,2500,5000],simple:[100,200,500,1000,5000]},Celtiis:{internet:[1000,3000,5000,10000,20000],appel:[100,200,500,1500,3000,5000,10000],simple:[200,500,1000,2000,5000]}};
                  const prix=G[form.forfaitOp]?.[form.forfaitType]||[];
                  return (
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:"0.08em", marginBottom:8 }}>3 — MONTANT</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {prix.map(p=>(
                          <button key={p} onClick={()=>setForm(f=>({...f,forfaitPrix:p}))}
                            style={{ padding:"6px 11px", borderRadius:7, border:`1.5px solid ${form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.border}`, background:form.forfaitPrix===p?OP_BG[form.forfaitOp]:"transparent", color:form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.sub, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                            {p>=1000?`${p/1000}k`:p} F
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {form.forfaitType && form.forfaitOp && form.forfaitPrix && (
                  <button onClick={addForfaitTx} disabled={saving}
                    style={{ width:"100%", padding:"12px", borderRadius:9, background:saving?T.hero:OP_COLORS[form.forfaitOp], border:"none", color:saving?T.sub:"#fff", fontWeight:700, fontSize:13, cursor:saving?"not-allowed":"pointer", fontFamily:"inherit" }}>
                    {saving?"Sauvegarde en cours...":`Enregistrer — ${form.forfaitOp} ${form.forfaitType} ${fF(form.forfaitPrix)}`}
                  </button>
                )}
              </Card>
            )}

            {/* Rapport WhatsApp */}
            <button onClick={()=>setShowReport(true)} style={{ width:"100%", padding:"13px", borderRadius:10, background:"#1A7A5E", border:"none", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:12, fontFamily:"inherit" }}>
              Envoyer le point du jour
            </button>

            {/* Ops recentes */}
            <Card>
              <SectionLabel>OPERATIONS DU JOUR</SectionLabel>
              {loading && <div style={{ textAlign:"center", color:T.sub, padding:"20px 0", fontSize:13 }}>Chargement...</div>}
              {!loading && agentTxs.length===0 && <div style={{ textAlign:"center", color:T.sub, padding:"28px 0", fontSize:13 }}>{isToday?"Aucune operation — utilisez les boutons ci-dessous":"Aucune operation ce jour"}</div>}
              {agentTxs.slice(0,8).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:i<Math.min(agentTxs.length,8)-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:TYPE_COLOR[t.type]||T.accent, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur], fontWeight:700 }}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub }}>{t.telephone||"—"} · {t.heure}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                    {t.commission>0 && <div style={{ fontSize:11, color:"#C09000" }}>+{fF(t.commission)}</div>}
                  </div>
                  {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14, padding:"0 4px", fontFamily:"inherit" }}>×</button>}
                </div>
              ))}
            </Card>
          </>
        )}

        {/* ── STATS AGENT ── */}
        {isAgent && tab==="stats" && (
          <div>
            <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px", marginBottom:18 }}>Statistiques</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
              {[["CA TOTAL",fF(totalAgentCA),T.accent],["FRAIS RETRAIT",fF(totalAgentCom),"#C09000"]].map(([lbl,val,col])=>(
                <Card key={lbl}>
                  <div style={{ fontSize:9, color:T.sub, marginBottom:6, fontWeight:700, letterSpacing:"0.1em" }}>{lbl}</div>
                  <div style={{ fontSize:22, fontWeight:700, color:col, letterSpacing:"-0.5px" }}>{val}</div>
                </Card>
              ))}
            </div>
            {["depot","retrait"].map(type=>{
              const tTxs=agentTxs.filter(t=>t.type===type);
              return (
                <Card key={type} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                    <SectionLabel>{TYPE_LABEL[type].toUpperCase()}S</SectionLabel>
                    <span style={{ color:TYPE_COLOR[type], fontWeight:700, fontSize:14 }}>{fF(tTxs.reduce((s,t)=>s+Number(t.montant),0))}</span>
                  </div>
                  {OPS.map((op,i)=>{
                    const o=agentTxs.filter(t=>t.type===type&&t.operateur===op);
                    return (
                      <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                        <div>
                          <span style={{ color:OP_COLORS[op], fontWeight:700, fontSize:13 }}>{op}</span>
                          <span style={{ color:T.sub, fontSize:11, marginLeft:6 }}>{o.length} op.</span>
                        </div>
                        <span style={{ fontWeight:700, fontSize:13 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</span>
                      </div>
                    );
                  })}
                </Card>
              );
            })}
          </div>
        )}

        {/* ── HISTORIQUE AGENT ── */}
        {isAgent && tab==="historique" && (
          <div>
            <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px", marginBottom:18 }}>Historique</div>
            {loading && <div style={{ textAlign:"center", color:T.sub, padding:"40px 0", fontSize:13 }}>Chargement...</div>}
            {!loading && agentTxs.length===0 && <div style={{ textAlign:"center", color:T.sub, padding:"50px 0", fontSize:13 }}>Aucune operation {isToday?"enregistree":"ce jour"}</div>}
            {agentTxs.map(t=>(
              <div key={t.id} style={{ background:T.card, borderRadius:12, padding:"13px 15px", marginBottom:8, border:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:TYPE_COLOR[t.type]||T.accent, flexShrink:0 }} />
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{TYPE_LABEL[t.type]} · <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub }}>{t.telephone||"—"} · {t.heure}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                    {t.commission>0 && <div style={{ fontSize:11, color:"#C09000" }}>+{fF(t.commission)}</div>}
                  </div>
                  {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>×</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PROFIL ── */}
        {tab==="profil" && (
          <div>
            <div style={{ fontWeight:700, fontSize:18, letterSpacing:"-0.3px", marginBottom:18 }}>Profil</div>
            <Card style={{ marginBottom:12 }}>
              {isPatron && (
                <>
                  <SectionLabel>COMPTE PATRON</SectionLabel>
                  {[["Nom",patron.nom],["Telephone",patron.telephone],["Entreprise",patron.nom_entreprise],["RC",patron.registre_commerce],["Pays",patron.pays]].map(([l,v])=>(
                    <StatRow key={l} label={l} value={v||"—"} />
                  ))}
                </>
              )}
              {isAgent && (
                <>
                  <SectionLabel>{agent.patron_id?"COMPTE AGENT":"AGENT INDEPENDANT"}</SectionLabel>
                  {[["Nom",agent.nom],["Telephone",agent.telephone]].map(([l,v])=>(
                    <StatRow key={l} label={l} value={v||"—"} />
                  ))}
                  <div style={{ marginTop:14 }}>
                    {pendingCount>0?(
                      <div style={{ background:"#C0900014", border:"1px solid #C0900030", borderRadius:8, padding:"9px 14px", fontSize:12, color:"#C09000", fontWeight:600 }}>{pendingCount} operation(s) en attente de synchronisation</div>
                    ):(
                      <div style={{ background:`${T.accent}12`, border:`1px solid ${T.accent}25`, borderRadius:8, padding:"9px 14px", fontSize:12, color:T.accent, fontWeight:600 }}>Toutes les donnees sont synchronisees</div>
                    )}
                  </div>
                </>
              )}
            </Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:T.card, borderRadius:12, padding:"13px 15px", marginBottom:12, border:`1px solid ${T.border}` }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13 }}>{dark?"Mode sombre actif":"Mode clair actif"}</div>
                <div style={{ fontSize:11, color:T.sub }}>Apparence de l'interface</div>
              </div>
              <button onClick={()=>setDark(d=>!d)} style={{ padding:"7px 14px", borderRadius:8, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{dark?"Passer au clair":"Passer au sombre"}</button>
            </div>
            <button onClick={()=>setConfirmLogout(true)} style={{ width:"100%", padding:"14px", borderRadius:10, background:"#C0392B12", border:"1.5px solid #C0392B30", color:"#C0392B", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Se deconnecter</button>
          </div>
        )}

      </main>

      {/* FABs AGENT */}
      {isAgent && tab==="accueil" && isToday && (
        <div style={{ position:"fixed", bottom:86, right:16, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
          <button onClick={()=>{setModal("retrait");setForm({});}} style={{ height:44, paddingLeft:16, paddingRight:18, borderRadius:22, background:"#1A4A8A", border:"none", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 14px rgba(26,74,138,0.4)", display:"flex", alignItems:"center", gap:8, fontFamily:"inherit" }}>Retrait</button>
          <button onClick={()=>{setModal("depot");setForm({});}} style={{ height:50, paddingLeft:18, paddingRight:20, borderRadius:25, background:T.accent, border:"none", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:"0 6px 18px rgba(26,122,94,0.4)", display:"flex", alignItems:"center", gap:8, fontFamily:"inherit" }}>Depot</button>
        </div>
      )}

      {/* BOTTOM NAV */}
      <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.nav, borderTop:`1px solid ${T.border}`, zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-around", padding:"8px 0 10px", maxWidth:520, margin:"0 auto" }}>
          {(isPatron?NAV_PATRON:NAV_AGENT).map(([key,label])=>(
            <button key={key} onClick={()=>{ setTab(key); if(key==="dashboard") setSelectedAgent(null); }} style={{ background:"none", border:"none", color:tab===key?T.accent:T.sub, fontSize:10, fontWeight:tab===key?700:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"0 14px", fontFamily:"inherit" }}>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{label}</span>
              {tab===key && <div style={{ width:16, height:2, borderRadius:1, background:T.accent }} />}
            </button>
          ))}
        </div>
      </nav>

      {/* MODAL TRANSACTION */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:"100%", background:T.card, borderRadius:"18px 18px 0 0", padding:"16px 18px 48px", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ width:32, height:3, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
            <div style={{ fontWeight:700, fontSize:17, marginBottom:16, letterSpacing:"-0.3px" }}>{modal==="depot"?"Nouveau Depot":"Nouveau Retrait"}</div>

            {modal==="retrait" && form.montant && Number(form.montant)>=100 && (()=>{
              const t=getTranche(form.montant);
              const c=form.operateur?calcFrais(form.operateur,form.montant):0;
              return t?(
                <div style={{ background:"#1A4A8A10", border:"1px solid #1A4A8A25", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:10, color:"#1A4A8A", fontWeight:700, marginBottom:8, letterSpacing:"0.08em" }}>TRANCHE : {Number(t.min).toLocaleString("fr-FR")} – {Number(t.max).toLocaleString("fr-FR")} F</div>
                  <div style={{ display:"flex", gap:8, marginBottom:form.operateur?10:0 }}>
                    {OPS.map(op=>{ const sel=op===form.operateur; return (
                      <div key={op} style={{ flex:1, textAlign:"center", background:sel?`${OP_COLORS[op]}18`:T.hero, border:`1.5px solid ${sel?OP_COLORS[op]:T.border}`, borderRadius:9, padding:"8px 4px" }}>
                        <div style={{ fontSize:10, color:OP_COLORS[op], fontWeight:800, marginBottom:3 }}>{op}</div>
                        <div style={{ fontSize:15, fontWeight:700, color:sel?OP_COLORS[op]:T.text }}>{fF(t[op])}</div>
                      </div>
                    ); })}
                  </div>
                  {form.operateur && (
                    <div style={{ background:`${T.accent}12`, border:`1px solid ${T.accent}25`, borderRadius:8, padding:"8px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:T.sub }}>Frais de retrait</span>
                      <span style={{ fontSize:17, fontWeight:800, color:T.accent }}>{fF(c)}</span>
                    </div>
                  )}
                </div>
              ):null;
            })()}

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:"0.08em" }}>MONTANT (FCFA)</div>
              <input type="number" placeholder="5000" value={form.montant||""} onChange={e=>setForm(f=>({...f,montant:e.target.value}))} autoFocus
                style={{ width:"100%", background:T.input, border:`1.5px solid ${T.border}`, borderRadius:10, padding:"13px 14px", color:T.text, fontSize:22, fontWeight:700, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }} />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:"0.08em" }}>NUMERO CLIENT (optionnel)</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ background:T.input, border:`1.5px solid ${T.border}`, borderRadius:10, padding:"11px 10px", color:T.sub, fontSize:12, fontWeight:700 }}>+229 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone||""} onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,8); const op=detectOp(v); setForm(f=>({...f,telephone:v,operateur:op||f.operateur})); }}
                  style={{ flex:1, background:T.input, border:`1.5px solid ${form.operateur?OP_COLORS[form.operateur]:T.border}`, borderRadius:10, padding:"11px 13px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }} />
              </div>
            </div>
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:10, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:"0.08em" }}>RESEAU</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPS.map(op=>(
                  <button key={op} onClick={()=>setForm(f=>({...f,operateur:op}))} style={{ flex:1, padding:"11px 0", borderRadius:9, border:`1.5px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?OP_BG[op]:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>{op}</button>
                ))}
              </div>
            </div>
            <button onClick={addTx} disabled={saving||!form.operateur||!form.montant}
              style={{ width:"100%", padding:"15px", borderRadius:10, background:(!form.operateur||!form.montant)?T.hero:modal==="depot"?T.accent:"#1A4A8A", border:"none", color:(!form.operateur||!form.montant)?T.sub:"#fff", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>
              {saving?"Sauvegarde en cours...":"Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* MODAL RAPPORT */}
      {showReport && isAgent && (()=>{
        const dateLabel=new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
        const cashActuel=calcCashActuel();
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowReport(false)}>
            <div style={{ background:T.card, borderRadius:16, padding:22, maxWidth:400, width:"100%", maxHeight:"90vh", overflowY:"auto", border:`1px solid ${T.border}` }} onClick={e=>e.stopPropagation()}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:15 }}>Point du jour</div>
                  <div style={{ fontSize:12, color:T.sub }}>{dateLabel}</div>
                </div>
                <button onClick={()=>setShowReport(false)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, width:30, height:30, cursor:"pointer", fontSize:16, color:T.sub, fontFamily:"inherit" }}>×</button>
              </div>
              <div style={{ background:T.hero, borderRadius:9, padding:"9px 12px", marginBottom:14, fontSize:13, color:T.sub }}>{agent.nom} — {agent.telephone}</div>
              {OPS.map(op=>{
                const deps=agentTxs.filter(t=>t.type==="depot"&&t.operateur===op);
                const rets=agentTxs.filter(t=>t.type==="retrait"&&t.operateur===op);
                if (!deps.length&&!rets.length) return null;
                return (
                  <div key={op} style={{ marginBottom:8, background:T.hero, borderRadius:9, padding:"10px 12px" }}>
                    <div style={{ fontWeight:700, fontSize:12, color:OP_COLORS[op], marginBottom:6 }}>{op}</div>
                    {deps.length>0 && <div style={{ fontSize:13, marginBottom:3 }}>Depots : <strong>{deps.length} op — {fF(deps.reduce((s,t)=>s+Number(t.montant),0))}</strong></div>}
                    {rets.length>0 && <div style={{ fontSize:13 }}>Retraits : <strong>{rets.length} op — {fF(rets.reduce((s,t)=>s+Number(t.montant),0))}</strong> <span style={{color:T.sub,fontSize:11}}>frais {fF(rets.reduce((s,t)=>s+Number(t.commission),0))}</span></div>}
                  </div>
                );
              })}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, margin:"12px 0" }}>
                <div style={{ background:`${T.accent}14`, borderRadius:9, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3, fontWeight:600 }}>CA Total</div>
                  <div style={{ fontWeight:800, fontSize:18, color:T.accent }}>{fF(totalAgentCA)}</div>
                </div>
                <div style={{ background:"#C0900014", borderRadius:9, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3, fontWeight:600 }}>Frais retrait</div>
                  <div style={{ fontWeight:800, fontSize:18, color:"#C09000" }}>{fF(totalAgentCom)}</div>
                </div>
              </div>
              {cashActuel!==null && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ height:1, background:T.border, marginBottom:10 }} />
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:13 }}><span style={{ color:T.sub }}>Caisse depart</span><strong>{fF(capitalCash)}</strong></div>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:13 }}><span style={{ color:T.sub }}>Caisse actuelle</span><strong style={{color:cashActuel<0?"#C0392B":T.accent}}>{fF(cashActuel)}</strong></div>
                </div>
              )}
              <button onClick={()=>{
                const lines=[];
                lines.push(`*POINT DU JOUR — ${dateLabel.toUpperCase()}*`);
                lines.push(`${agent.nom} | ${agent.telephone}`);
                lines.push("");
                OPS.forEach(op=>{
                  const deps=agentTxs.filter(t=>t.type==="depot"&&t.operateur===op);
                  const rets=agentTxs.filter(t=>t.type==="retrait"&&t.operateur===op);
                  if (deps.length||rets.length) {
                    lines.push(`[ ${op} ]`);
                    if (deps.length) lines.push(`  Depots: ${deps.length} op — ${fF(deps.reduce((s,t)=>s+Number(t.montant),0))}`);
                    if (rets.length) lines.push(`  Retraits: ${rets.length} op — ${fF(rets.reduce((s,t)=>s+Number(t.montant),0))} (frais ${fF(rets.reduce((s,t)=>s+Number(t.commission),0))})`);
                  }
                });
                lines.push("");
                lines.push(`CA total : ${fF(totalAgentCA)} | Frais retrait : ${fF(totalAgentCom)}`);
                if (cashActuel!==null) lines.push(`Caisse : ${fF(capitalCash)} -> ${fF(cashActuel)}`);
                lines.push("");
                lines.push("_CashPoint_");
                window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`,"_blank");
              }} style={{ width:"100%", padding:"13px", borderRadius:10, background:"#1A7A5E", border:"none", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Partager sur WhatsApp
              </button>
            </div>
          </div>
        );
      })()}

      {/* MODAL CALENDRIER */}
      {showCal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:300 }} onClick={()=>setShowCal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:"18px 18px 0 0", padding:"18px 18px 32px", border:`1px solid ${T.border}`, width:"100%" }}>
            <div style={{ width:32, height:3, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <button onClick={()=>{if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, width:34, height:34, cursor:"pointer", color:T.text, fontFamily:"inherit" }}>‹</button>
              <div style={{ fontWeight:700, fontSize:14 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
              <button onClick={()=>{if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, width:34, height:34, cursor:"pointer", color:T.text, fontFamily:"inherit" }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:6 }}>
              {JOURS.map(j=>(<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"3px 0" }}>{j}</div>))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
              {Array(new Date(calYear,calMonth-1,1).getDay()).fill(null).map((_,i)=>(<div key={`e${i}`}/>))}
              {Array(new Date(calYear,calMonth,0).getDate()).fill(null).map((_,i)=>{
                const day=i+1, ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isTod=ds===todayStr(), isSel=ds===selectedDate, isFut=ds>todayStr();
                return (
                  <button key={day} disabled={isFut} onClick={()=>{ setSelectedDate(ds); setShowCal(false); if(isAgent) setTab("accueil"); }}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:8, border:isSel?`1.5px solid ${T.accent}`:isTod?`1.5px solid #C09000`:`1px solid ${T.border}`, background:isSel?`${T.accent}20`:isTod?"#C0900015":T.hero, color:isFut?T.faint:isSel?T.accent:T.text, fontWeight:isSel||isTod?700:400, fontSize:12, cursor:isFut?"not-allowed":"pointer", opacity:isFut?0.3:1, fontFamily:"inherit" }}>
                    {day}
                  </button>
                );
              })}
            </div>
            {isPatron && (
              <button onClick={()=>{ setSelectedDate(todayStr()); setShowCal(false); }} style={{ width:"100%", marginTop:14, padding:"11px", borderRadius:9, background:T.accent, border:"none", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Aujourd'hui
              </button>
            )}
          </div>
        </div>
      )}

      {/* CONFIRM SUPPRESSION TX */}
      {confirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:24 }}>
          <div style={{ background:T.card, borderRadius:16, padding:24, width:"100%", maxWidth:320, border:`1px solid ${T.border}` }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>Supprimer cette operation ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>Cette action est irreversible.</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setConfirm(null)} style={{ flex:1, padding:"12px", borderRadius:9, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={()=>removeAgentTx(confirm)} style={{ flex:1, padding:"12px", borderRadius:9, background:"#C0392B", border:"none", color:"#fff", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM SUPPRESSION AGENT */}
      {confirmDelAgent && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
          <div style={{ background:T.card, borderRadius:16, padding:24, width:"100%", maxWidth:340, border:"1px solid #C0392B30" }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:6, color:"#C0392B" }}>Retirer cet agent ?</div>
            <div style={{ background:T.hero, borderRadius:9, padding:"10px 14px", marginBottom:14 }}>
              <div style={{ fontWeight:700 }}>{confirmDelAgent.nom}</div>
              <div style={{ fontSize:12, color:T.sub }}>+229 {confirmDelAgent.telephone}</div>
            </div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:18, lineHeight:1.6 }}>
              Toutes ses operations et donnees seront <strong style={{color:"#C0392B"}}>definitivement supprimees</strong>.
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setConfirmDelAgent(null)} disabled={deletingAgent} style={{ flex:1, padding:"12px", borderRadius:9, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button disabled={deletingAgent} onClick={async()=>{ setDeletingAgent(true); await deleteAgent(confirmDelAgent.id); setDeletingAgent(false); setConfirmDelAgent(null); loadPatronData(); }}
                style={{ flex:1, padding:"12px", borderRadius:9, background:"#C0392B", border:"none", color:"#fff", fontWeight:700, cursor:deletingAgent?"not-allowed":"pointer", opacity:deletingAgent?0.6:1, fontFamily:"inherit" }}>
                {deletingAgent?"Suppression...":"Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DECONNEXION */}
      {confirmLogout && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
          <div style={{ background:T.card, borderRadius:16, padding:26, width:"100%", maxWidth:320, border:`1px solid ${T.border}`, textAlign:"center" }}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:6 }}>Se deconnecter ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:22 }}>Vos donnees restent sauvegardees.</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setConfirmLogout(false)} style={{ flex:1, padding:"12px", borderRadius:9, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={handleLogout} style={{ flex:1, padding:"12px", borderRadius:9, background:"#C0392B", border:"none", color:"#fff", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Deconnexion</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CASH */}
      {showCashModal && isAgent && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowCashModal(false)}>
          <div style={{ background:T.card, borderRadius:16, padding:22, maxWidth:360, width:"100%", border:`1px solid ${T.border}` }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Capital Cash du matin</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Argent liquide total disponible (commun MTN, MOOV, Celtiis).</div>
            <input type="number" placeholder="300000" value={cashInput} onChange={e=>setCashInput(e.target.value)} autoFocus
              style={{ width:"100%", background:T.input, border:`1.5px solid ${T.accent}`, borderRadius:10, padding:"14px", color:T.text, fontSize:22, fontWeight:700, outline:"none", boxSizing:"border-box", marginBottom:12, textAlign:"center", fontFamily:"inherit" }} />
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:16 }}>
              {[100000,200000,300000,500000].map(v=>(
                <button key={v} onClick={()=>setCashInput(String(v))} style={{ padding:"8px 0", borderRadius:8, border:`1px solid ${T.accent}25`, background:`${T.accent}10`, color:T.accent, fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>{v/1000}k</button>
              ))}
            </div>
            <button onClick={()=>{ const val=Number(cashInput); if(!cashInput||isNaN(val)) return; const uid=agent.id||agent.telephone; lsSet(cashKey(selectedDate,uid),val); setCapitalCash(val); setShowCashModal(false); setCashInput(""); }}
              style={{ width:"100%", padding:"13px", borderRadius:10, background:T.accent, border:"none", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* MODAL FLOAT */}
      {showFloatModal && isAgent && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", zIndex:600 }} onClick={()=>setShowFloatModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:"18px 18px 0 0", padding:"20px 18px 38px", width:"100%", border:`1px solid ${T.border}` }}>
            <div style={{ width:32, height:3, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />
            <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Solde de depart</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:18 }}>Unites electroniques disponibles ce matin.</div>
            {floatEditOp===null?(
              <div>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:"0.08em", marginBottom:10 }}>CHOISIR UN OPERATEUR</div>
                <div style={{ display:"flex", gap:8 }}>
                  {OPS.map(op=>(
                    <button key={op} onClick={()=>{setFloatEditOp(op);setFloatInput(floats[op]!==null?String(floats[op]):"");}}
                      style={{ flex:1, padding:"13px 0", borderRadius:10, border:`1.5px solid ${OP_COLORS[op]}40`, background:OP_BG[op], color:OP_COLORS[op], fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                      {op}
                      {floats[op]!==null && <div style={{ fontSize:9, marginTop:3, opacity:0.8 }}>{fF(floats[op])}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ):(
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                  <button onClick={()=>{setFloatEditOp(null);setFloatInput("");}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 11px", color:T.sub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Retour</button>
                  <div style={{ fontWeight:700, fontSize:14, color:OP_COLORS[floatEditOp] }}>Solde {floatEditOp}</div>
                </div>
                <input type="number" placeholder="150000" value={floatInput} onChange={e=>setFloatInput(e.target.value)} autoFocus
                  style={{ width:"100%", background:T.input, border:`1.5px solid ${OP_COLORS[floatEditOp]}`, borderRadius:10, padding:"14px", color:T.text, fontSize:22, fontWeight:700, outline:"none", boxSizing:"border-box", textAlign:"center", marginBottom:12, fontFamily:"inherit" }} />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:16 }}>
                  {[25000,50000,100000,200000].map(v=>(
                    <button key={v} onClick={()=>setFloatInput(String(v))} style={{ padding:"8px 0", borderRadius:8, border:`1px solid ${OP_COLORS[floatEditOp]}25`, background:`${OP_COLORS[floatEditOp]}10`, color:OP_COLORS[floatEditOp], fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>{v/1000}k</button>
                  ))}
                </div>
                <button onClick={()=>{ if(!floatInput||isNaN(Number(floatInput))) return; saveAgentFloat(floatEditOp,floatInput); setFloatEditOp(null); setFloatInput(""); setShowFloatModal(false); }}
                  style={{ width:"100%", padding:"13px", borderRadius:10, background:OP_COLORS[floatEditOp], border:"none", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                  Enregistrer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL MATIN */}
      {showMorning && isAgent && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:T.card, borderRadius:16, padding:22, maxWidth:390, width:"100%", maxHeight:"92vh", overflowY:"auto", border:`1px solid ${T.border}` }}>
            <div style={{ textAlign:"center", marginBottom:22 }}>
              <div style={{ fontWeight:700, fontSize:19, color:T.text, marginBottom:4 }}>Debut de journee</div>
              <div style={{ fontSize:13, color:T.sub }}>{agent.nom.split(" ")[0]}, renseignez vos fonds de depart</div>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color:T.accent, marginBottom:6 }}>CAPITAL CASH (commun aux 3 reseaux)</div>
              <input type="number" placeholder="300000" value={morningInputs.cash} onChange={e=>setMorningInputs(p=>({...p,cash:e.target.value}))}
                style={{ width:"100%", background:T.input, border:`1.5px solid ${T.accent}40`, borderRadius:10, padding:"12px 14px", color:T.text, fontSize:16, fontWeight:700, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }} />
            </div>
            <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:14, marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color:T.sub, marginBottom:12 }}>SOLDES ELECTRONIQUES</div>
              {[["MTN","#D4A017"],["MOOV","#1A5EB8"],["Celtiis","#C0392B"]].map(([op,col])=>(
                <div key={op} style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:col, marginBottom:5 }}>{op}</div>
                  <input type="number" placeholder={`Solde ${op} du matin`} value={morningInputs[op]} onChange={e=>setMorningInputs(p=>({...p,[op]:e.target.value}))}
                    style={{ width:"100%", background:T.input, border:`1.5px solid ${col}35`, borderRadius:10, padding:"11px 14px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box", fontFamily:"inherit" }} />
                </div>
              ))}
            </div>
            <button onClick={()=>{
              const uid=agent.id||agent.telephone;
              const cashVal=Number(morningInputs.cash);
              if (!isNaN(cashVal)&&morningInputs.cash!=="") { lsSet(cashKey(todayStr(),uid),cashVal); setCapitalCash(cashVal); }
              const nf={MTN:null,MOOV:null,Celtiis:null};
              OPS.forEach(op=>{ const v=Number(morningInputs[op]); if(!isNaN(v)&&morningInputs[op]!=="") nf[op]=v; });
              setFloats(nf); lsSet(floatKey(todayStr(),uid),nf);
              saveFloat({ agent_id:agent.id, patron_id:agent.patron_id||null, date:todayStr(), cash:Number(morningInputs.cash)||0, float_mtn:nf.MTN, float_moov:nf.MOOV, float_celtiis:nf.Celtiis });
              setShowMorning(false);
            }} style={{ width:"100%", padding:"14px", borderRadius:10, background:T.accent, border:"none", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer", marginBottom:8, fontFamily:"inherit" }}>
              Commencer la journee
            </button>
            <button onClick={()=>setShowMorning(false)} style={{ width:"100%", padding:"11px", borderRadius:10, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Passer — je remplirai plus tard</button>
          </div>
        </div>
      )}

    </div>
  </>);
}
