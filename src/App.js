import { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SUPABASE ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";

// Headers génériques (pour patron et appels sans identité)
function H(patronId, agentId) {
  return {
    "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`,
    "Content-Type": "application/json", "Prefer": "return=representation",
    ...(patronId ? { "x-patron-id": patronId } : {}),
    ...(agentId  ? { "x-agent-id":  agentId  } : {}),
  };
}
// Headers spécifiques agent (pour RLS)
function HA(agentId) { return { ...H(), "x-agent-id": agentId || "" }; }

// ─── OTP ──────────────────────────────────────────────────────────────────────
async function sendOTP(telephone) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/send-otp`, {
      method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${SUPA_KEY}`},
      body:JSON.stringify({ telephone })
    });
    const data = await res.json();
    return res.ok ? { success:true } : { success:false, error:data.error||"Échec envoi SMS" };
  } catch { return { success:false, error:"Pas de connexion." }; }
}
async function verifyOTP(telephone, code) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/verify-otp`, {
      method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${SUPA_KEY}`},
      body:JSON.stringify({ telephone, code })
    });
    const data = await res.json();
    return res.ok ? { success:true } : { success:false, error:data.error||"Code incorrect" };
  } catch { return { success:false, error:"Pas de connexion." }; }
}

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const lsGet = k => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch { return null; } };
const lsSet = (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
const txKey    = (date,uid) => `cp_txs_${uid}_${date}`;
const pendKey  = uid        => `cp_pend_${uid}`;
const floatKey = (date,uid) => `cp_float_${uid}_${date}`;
const cashKey  = (date,uid) => `cp_cash_${uid}_${date}`;

// ─── DATE (UTC+1 Bénin) ───────────────────────────────────────────────────────
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

// ─── DÉTECTION OPÉRATEUR ──────────────────────────────────────────────────────
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
const OP_COLORS = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
const OP_BG_D   = { MTN:"#FFB80018", MOOV:"#0066CC18", Celtiis:"#E6394618" };
const OP_BG_L   = { MTN:"#FFB80028", MOOV:"#0066CC20", Celtiis:"#E6394620" };
const TYPE_COLOR = { depot:"#00C896", retrait:"#4F8EF7", forfait:"#9B5FDE" };
const TYPE_ICON  = { depot:"⬇️", retrait:"⬆️", forfait:"📦" };
const TYPE_LABEL = { depot:"Dépôt", retrait:"Retrait", forfait:"Forfait" };
const JOURS   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const PAYS    = ["Bénin","Togo","Burkina Faso","Côte d'Ivoire","Sénégal"];
const fF = n => Number(n||0).toLocaleString("fr-FR")+" F";
function getSalutation(nom) {
  const h=new Date().getHours(), p=(nom||"").split(" ")[0];
  const g=h>=5&&h<12?"Bonjour":h>=12&&h<18?"Bon après-midi":"Bonsoir";
  return `${g}, ${p} 👋`;
}

// ─── THÈMES ───────────────────────────────────────────────────────────────────
const DARK  = { bg:"#06080F", card:"#0C0F1A", border:"#181C2E", border2:"#1E2235", text:"#E8EAF0", sub:"#404560", faint:"#252840", hero:"#10131F", input:"#06080F", accent:"#00C896", nav:"#0C0F1A", sidebar:"#08090F" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", accent:"#00C896", nav:"#FFFFFF", sidebar:"#EAECF5" };

// ─── HOOK RESPONSIVE ─────────────────────────────────────────────────────────
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
    const r=await fetch(`${SUPA_URL}/rest/v1/patrons?telephone=eq.${tel}&select=*`,{headers:H(tel)});
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
// Transactions agent
async function fetchAgentTxs(agentId, dateStr) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=eq.${agentId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,{headers:H()});
    return r.ok?await r.json():[];
  } catch { return []; }
}
async function saveTx(tx) {
  try {
    // ⚠️ Retirer les champs locaux non connus de Supabase
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
// Float agent
async function fetchFloat(agentId, date) {
  try {
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats?agent_id=eq.${agentId}&date=eq.${date}&select=*`,{headers:H()});
    if (!r.ok) return null; const d=await r.json(); return d[0]||null;
  } catch { return null; }
}
async function saveFloat(f) {
  try {
    // Garder seulement les colonnes connues de Supabase
    const { agent_id, patron_id, date, cash, float_mtn, float_moov, float_celtiis } = f;
    const cleanFloat = { agent_id, patron_id, date, cash, float_mtn, float_moov, float_celtiis };
    const r=await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats`,{
      method:"POST",
      headers:{...H(),"Prefer":"return=representation,resolution=merge-duplicates"},
      body:JSON.stringify(cleanFloat)
    });
    if (!r.ok) {
      const err=await r.json().catch(()=>({}));
      console.error("❌ saveFloat erreur:", err.message||err.details||r.status);
    }
    return r.ok;
  } catch(e) { console.error("❌ saveFloat exception:", e.message); return false; }
}
// Patron — toutes les données agents
async function fetchAllTxsForPatron(patronId, dateStr, agentIds) {
  try {
    // Stratégie 1 : on a les IDs des agents → requête directe et fiable
    if (agentIds && agentIds.length > 0) {
      const ids = agentIds.join(",");
      const r = await fetch(
        `${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=in.(${ids})&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,
        { headers: H() }
      );
      if (r.ok) return await r.json();
    }
    // Stratégie 2 : fallback par patron_id
    const r = await fetch(
      `${SUPA_URL}/rest/v1/cashpoint_transactions?patron_id=eq.${patronId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`,
      { headers: H() }
    );
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchAllFloatsForPatron(patronId, dateStr, agentIds) {
  try {
    // Stratégie 1 : par agent IDs
    if (agentIds && agentIds.length > 0) {
      const ids = agentIds.join(",");
      const r = await fetch(
        `${SUPA_URL}/rest/v1/cashpoint_floats?agent_id=in.(${ids})&date=eq.${dateStr}&select=*`,
        { headers: H() }
      );
      if (r.ok) return await r.json();
    }
    // Stratégie 2 : fallback par patron_id
    const r = await fetch(
      `${SUPA_URL}/rest/v1/cashpoint_floats?patron_id=eq.${patronId}&date=eq.${dateStr}&select=*`,
      { headers: H() }
    );
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
// Cache offline agent
async function flushPending(agentId) {
  const pending=lsGet(pendKey(agentId));
  if (!pending?.length) return [];
  const synced=[];
  for (const tx of pending) { const s=await saveTx(tx); if (s) synced.push(tx.localId); }
  if (synced.length>0) lsSet(pendKey(agentId),pending.filter(t=>!synced.includes(t.localId)));
  return synced;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── COMPOSANT PIN PAD ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin,setPin] = useState("");
  const add = d => {
    if (pin.length>=4) return;
    const p=pin+d; setPin(p);
    if (p.length===4) setTimeout(()=>{ onSubmit(p); setPin(""); },140);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:56, height:56, borderRadius:16, background:"linear-gradient(135deg,#00C896,#00A5FF,#7B2FBE)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:22, fontWeight:900, fontSize:24, color:"#fff" }}>C</div>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:6, textAlign:"center", color:T.text }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:36, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:18, marginBottom:36 }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:20, height:20, borderRadius:"50%", background:pin.length>i?"#00C896":T.border2, border:`2px solid ${pin.length>i?"#00C896":T.border}`, transition:"all 0.15s" }} />
        ))}
      </div>
      {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"8px 20px", fontSize:12, fontWeight:700, marginBottom:22 }}>{error}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, width:"100%", maxWidth:288 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?setPin(p=>p.slice(0,-1)):d!==""?add(String(d)):null}
            style={{ height:64, borderRadius:16, border:`1px solid ${T.border}`, background:d===""?"transparent":T.card, color:T.text, fontSize:24, fontWeight:700, cursor:d===""?"default":"pointer" }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ÉCRAN AUTH (PATRON + AGENT) ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function AuthScreen({ T, dark, setDark, onPatronLogin, onAgentLogin }) {
  const [mode,setMode]   = useState("choose");
  const [step,setStep]   = useState(1);
  const [form,setForm]   = useState({ nom:"", telephone:"", entreprise:"", rc:"", pays:"Bénin", code:"" });
  const [pin1,setPin1]   = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── PATRON INSCRIPTION ───────────────────────────────────────────────────────
  async function handlePatronRegister() {
    if (!form.nom.trim())     { setError("Entre ton nom complet"); return; }
    if (!form.telephone||form.telephone.length!==8) { setError("Entre les 8 chiffres"); return; }
    if (!form.entreprise.trim()) { setError("Entre le nom de l'entreprise"); return; }
    if (!form.rc.trim())      { setError("Entre le numéro RC"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const existing=await fetchPatron(tel);
    if (existing) { setLoading(false); setError("Ce numéro a déjà un compte."); return; }
    const r=await sendOTP(tel); setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep(2);
  }
  async function handlePatronOTP() {
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const r=await verifyOTP(tel,form.otpCode||""); setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep(3);
  }
  async function handlePatronPinCreate(p) { setPin1(p); setStep(4); }
  async function handlePatronPinConfirm(p) {
    if (p!==pin1) { setError("PIN ne correspondent pas"); setStep(3); return; }
    setLoading(true);
    const pinHash=await hashPin(p);
    const tel="01"+form.telephone;
    const patron={telephone:tel,nom:form.nom.trim(),nom_entreprise:form.entreprise.trim(),registre_commerce:form.rc.trim(),pays:form.pays,pin:pinHash,phone_verified:true};
    const result=await savePatron(patron); setLoading(false);
    if (!result.success) { setError(`❌ ${result.error}`); setStep(3); return; }
    lsSet("cp_patron",{...result.data,pin:pinHash});
    onPatronLogin({...result.data,pin:pinHash});
  }
  // ── PATRON CONNEXION ────────────────────────────────────────────────────────
  async function handlePatronLogin() {
    if (!form.telephone||form.telephone.length!==8) { setError("Entre les 8 chiffres"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const patron=await fetchPatron(tel); setLoading(false);
    if (!patron) { setError("Numéro introuvable."); return; }
    lsSet("cp_patron",patron); setStep("patron-pin"); setForm(f=>({...f,_patron:patron}));
  }
  async function handlePatronPinLogin(p) {
    const patron=form._patron||lsGet("cp_patron");
    const pinHash=await hashPin(p);
    if (pinHash===patron.pin) onPatronLogin({...patron,pin:pinHash});
    else setError("Code PIN incorrect.");
  }
  // ── AGENT — CODE INVITATION ─────────────────────────────────────────────────
  async function handleAgentCode() {
    if (!form.code.trim()) { setError("Entre le code d'invitation"); return; }
    setLoading(true); setError("");
    const invite=await fetchInviteCode(form.code.trim().toUpperCase()); setLoading(false);
    if (!invite) { setError("Code invalide ou expiré. Demande un nouveau code."); return; }
    setForm(f=>({...f,_invite:invite})); setStep("agent-form");
  }
  async function handleAgentForm() {
    if (!form.nom.trim()) { setError("Entre ton nom"); return; }
    if (!form.telephone||form.telephone.length!==8) { setError("Entre les 8 chiffres"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const existing=await fetchAgent(tel);
    if (existing) { setLoading(false); setError("Ce numéro a déjà un compte."); return; }
    const r=await sendOTP(tel); setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep("agent-otp");
  }
  async function handleAgentOTP() {
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const r=await verifyOTP(tel,form.otpCode||""); setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep("agent-pin-create");
  }
  async function handleAgentPinCreate(p) { setPin1(p); setStep("agent-pin-confirm"); }
  async function handleAgentPinConfirm(p) {
    if (p!==pin1) { setError("PIN ne correspondent pas"); setStep("agent-pin-create"); return; }
    setLoading(true);
    const pinHash=await hashPin(p);
    const tel="01"+form.telephone;
    const agentData={telephone:tel,nom:form.nom.trim(),patron_id:form._invite.patron_id,pin:pinHash,phone_verified:true};
    const saved=await saveAgent(agentData);
    if (saved) await markInviteUsed(form.code.trim().toUpperCase(),saved.id);
    setLoading(false);
    if (!saved) { setError("Erreur. Réessaie."); return; }
    lsSet("cp_agent",{...saved,pin:pinHash});
    onAgentLogin({...saved,pin:pinHash});
  }
  async function handleAgentLogin() {
    if (!form.telephone||form.telephone.length!==8) { setError("Entre les 8 chiffres"); return; }
    const tel="01"+form.telephone;
    setLoading(true); setError("");
    const ag=await fetchAgent(tel); setLoading(false);
    if (!ag) { setError("Numéro introuvable."); return; }
    lsSet("cp_agent",ag); setStep("agent-pin-login"); setForm(f=>({...f,_agent:ag}));
  }
  async function handleAgentPinLogin(p) {
    const ag=form._agent||lsGet("cp_agent");
    const pinHash=await hashPin(p);
    if (pinHash===ag.pin) onAgentLogin({...ag,pin:pinHash});
    else setError("Code PIN incorrect.");
  }

  // Écrans PIN
  if (step===3)              return <PinPad title="Crée ton PIN 🔐" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handlePatronPinCreate} T={T} />;
  if (step===4)              return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePatronPinConfirm} T={T} error={error} />;
  if (step==="patron-pin")   return <PinPad title="Bon retour 👋" subtitle="Entre ton code PIN" onSubmit={handlePatronPinLogin} T={T} error={error} />;
  if (step==="agent-pin-create")  return <PinPad title="Crée ton PIN 🔐" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handleAgentPinCreate} T={T} />;
  if (step==="agent-pin-confirm") return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handleAgentPinConfirm} T={T} error={error} />;
  if (step==="agent-pin-login")   return <PinPad title="Bon retour 👋" subtitle="Entre ton code PIN" onSubmit={handleAgentPinLogin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:64, height:64, borderRadius:18, background:"linear-gradient(135deg,#00C896,#00A5FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, fontWeight:900, color:"#fff", margin:"0 auto 14px" }}>C</div>
          <div style={{ fontWeight:900, fontSize:28, color:T.text }}>CashPoint</div>
          <div style={{ fontSize:13, color:T.sub }}>Gestion POS pour les pros 🇧🇯</div>
        </div>

        {/* ── CHOIX INITIAL ── */}
        {mode==="choose" && (<div>
          <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, textAlign:"center", marginBottom:16 }}>JE SUIS...</div>
          <button onClick={()=>{setMode("patron");setStep(1);setError("");}}
            style={{ width:"100%", padding:20, borderRadius:16, background:T.card, border:"2px solid #00C896", color:T.text, fontWeight:800, fontSize:16, cursor:"pointer", marginBottom:12, display:"flex", alignItems:"center", gap:14 }}>
            <span style={{ fontSize:32 }}>👑</span>
            <div style={{ textAlign:"left" }}><div style={{ fontWeight:900 }}>Patron / Boss POS</div><div style={{ fontSize:12, color:T.sub, fontWeight:400 }}>Je gère des agents et plusieurs points</div></div>
          </button>
          <button onClick={()=>{setMode("agent");setStep("agent-code");setError("");}}
            style={{ width:"100%", padding:20, borderRadius:16, background:T.card, border:"2px solid #00A5FF", color:T.text, fontWeight:800, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
            <span style={{ fontSize:32 }}>👷</span>
            <div style={{ textAlign:"left" }}><div style={{ fontWeight:900 }}>Agent / Staff</div><div style={{ fontSize:12, color:T.sub, fontWeight:400 }}>J'ai un code d'invitation de mon patron</div></div>
          </button>
          <button onClick={()=>setDark(d=>!d)} style={{ width:"100%", marginTop:20, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>
            {dark?"☀️ Mode clair":"🌙 Mode sombre"}
          </button>
        </div>)}

        {/* ── PATRON INSCRIPTION ÉTAPE 1 ── */}
        {mode==="patron" && step===1 && (<div>
          <div style={{ display:"flex", gap:8, background:T.hero, borderRadius:13, padding:4, marginBottom:24, border:`1px solid ${T.border}` }}>
            <button style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"linear-gradient(135deg,#00C896,#00A5FF)", color:"#fff", fontWeight:800, fontSize:13, cursor:"pointer" }}>Nouveau compte</button>
            <button onClick={()=>{setMode("patron-login");setStep("patron-login-form");}} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"transparent", color:T.sub, fontWeight:700, fontSize:13, cursor:"pointer" }}>Se connecter</button>
          </div>
          {[["TON NOM COMPLET","text","Ex : Koffi Mensah","nom"],["NOM ENTREPRISE / POINT POS","text","Ex : Point Cash Fidjrossè","entreprise"],["NUMÉRO REGISTRE COMMERCE","text","Ex : RB/COT/24/B/1234","rc"]].map(([lbl,tp,ph,k])=>(
            <div key={k} style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>{lbl}</div>
              <input type={tp} placeholder={ph} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inp} />
            </div>
          ))}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
              <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
            </div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>PAYS</div>
            <select value={form.pays} onChange={e=>setForm(f=>({...f,pays:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              {PAYS.map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
          {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"10px 14px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
          <button onClick={handlePatronRegister} disabled={loading} style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Envoi SMS...":"Recevoir mon code SMS →"}
          </button>
          <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
        </div>)}

        {/* ── PATRON OTP ── */}
        {mode==="patron" && step===2 && (<div>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📱</div>
            <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Vérifie ton numéro</div>
            <div style={{ fontSize:13, color:T.sub }}>Code envoyé au <strong style={{color:T.text}}>+229 01{form.telephone}</strong></div>
          </div>
          <input type="tel" placeholder="_ _ _ _ _ _" maxLength={6} value={form.otpCode||""} onChange={e=>setForm(f=>({...f,otpCode:e.target.value.replace(/\D/g,"").slice(0,6)}))} autoFocus
            style={{...inp,fontSize:28,fontWeight:800,textAlign:"center",letterSpacing:12,marginBottom:14,border:`2px solid ${(form.otpCode||"").length===6?"#00C896":T.border}`}} />
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
          <button onClick={handlePatronOTP} disabled={loading||(form.otpCode||"").length!==6}
            style={{ width:"100%", padding:16, borderRadius:12, background:(form.otpCode||"").length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:(form.otpCode||"").length===6?"#fff":T.sub, fontWeight:900, fontSize:15, cursor:"pointer" }}>
            {loading?"⏳...":"✅ Confirmer"}
          </button>
          <button onClick={()=>setStep(1)} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
        </div>)}

        {/* ── PATRON CONNEXION ── */}
        {mode==="patron-login" && step==="patron-login-form" && (<div>
          <div style={{ display:"flex", gap:8, background:T.hero, borderRadius:13, padding:4, marginBottom:24, border:`1px solid ${T.border}` }}>
            <button onClick={()=>{setMode("patron");setStep(1);}} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"transparent", color:T.sub, fontWeight:700, fontSize:13, cursor:"pointer" }}>Nouveau compte</button>
            <button style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"linear-gradient(135deg,#00C896,#00A5FF)", color:"#fff", fontWeight:800, fontSize:13, cursor:"pointer" }}>Se connecter</button>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
              <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus />
            </div>
          </div>
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
          <button onClick={handlePatronLogin} disabled={loading} style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
            {loading?"⏳...":"Continuer →"}
          </button>
          <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
        </div>)}

        {/* ── AGENT CODE INVITATION ── */}
        {mode==="agent" && step==="agent-code" && (<div>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:40, marginBottom:10 }}>🔑</div>
            <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Code d'invitation</div>
            <div style={{ fontSize:13, color:T.sub }}>Demande le code à ton patron pour rejoindre son équipe</div>
          </div>
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>CODE D'INVITATION (6 caractères)</div>
            <input type="text" placeholder="Ex : AB12CD" maxLength={6} value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} autoFocus
              style={{...inp,fontSize:24,fontWeight:800,textAlign:"center",letterSpacing:8}} />
          </div>
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
          <button onClick={handleAgentCode} disabled={loading||form.code.length!==6}
            style={{ width:"100%", padding:17, borderRadius:14, background:form.code.length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:form.code.length===6?"#fff":T.sub, fontWeight:900, fontSize:16, cursor:"pointer", marginBottom:10 }}>
            {loading?"⏳ Vérification...":"Valider le code →"}
          </button>
          <div style={{ textAlign:"center", marginBottom:10 }}>
            <span style={{ fontSize:12, color:T.sub }}>Déjà un compte ? </span>
            <button onClick={()=>{setMode("agent-login");setStep("agent-login-form");}} style={{ background:"none", border:"none", color:"#00C896", fontSize:12, fontWeight:700, cursor:"pointer" }}>Se connecter</button>
          </div>
          <button onClick={()=>setMode("choose")} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
        </div>)}

        {/* ── AGENT FORMULAIRE ── */}
        {mode==="agent" && step==="agent-form" && (<div>
          <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:12, padding:"12px 16px", marginBottom:20, fontSize:12, color:"#00C896", fontWeight:700, textAlign:"center" }}>
            ✅ Code valide ! Tu rejoins l'équipe de ton patron
          </div>
          {[["TON NOM COMPLET","text","Ex : Koffi Mensah","nom"]].map(([lbl,tp,ph,k])=>(
            <div key={k} style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>{lbl}</div>
              <input type={tp} placeholder={ph} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inp} autoFocus />
            </div>
          ))}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
              <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
            </div>
          </div>
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
          <button onClick={handleAgentForm} disabled={loading} style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
            {loading?"⏳ Envoi SMS...":"Recevoir mon code SMS →"}
          </button>
        </div>)}

        {/* ── AGENT OTP ── */}
        {mode==="agent" && step==="agent-otp" && (<div>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📱</div>
            <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Vérifie ton numéro</div>
            <div style={{ fontSize:13, color:T.sub }}>Code envoyé au <strong style={{color:T.text}}>+229 01{form.telephone}</strong></div>
          </div>
          <input type="tel" placeholder="_ _ _ _ _ _" maxLength={6} value={form.otpCode||""} onChange={e=>setForm(f=>({...f,otpCode:e.target.value.replace(/\D/g,"").slice(0,6)}))} autoFocus
            style={{...inp,fontSize:28,fontWeight:800,textAlign:"center",letterSpacing:12,marginBottom:14,border:`2px solid ${(form.otpCode||"").length===6?"#00C896":T.border}`}} />
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
          <button onClick={handleAgentOTP} disabled={loading||(form.otpCode||"").length!==6}
            style={{ width:"100%", padding:16, borderRadius:12, background:(form.otpCode||"").length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:(form.otpCode||"").length===6?"#fff":T.sub, fontWeight:900, fontSize:15, cursor:"pointer" }}>
            {loading?"⏳...":"✅ Confirmer"}
          </button>
        </div>)}

        {/* ── AGENT CONNEXION ── */}
        {mode==="agent-login" && step==="agent-login-form" && (<div>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:36, marginBottom:8 }}>👷</div>
            <div style={{ fontWeight:900, fontSize:20, color:T.text }}>Connexion Agent</div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
              <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} autoFocus />
            </div>
          </div>
          {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
          <button onClick={handleAgentLogin} disabled={loading} style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
            {loading?"⏳...":"Continuer →"}
          </button>
          <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
        </div>)}

        {error && !["patron","agent","patron-login","agent-login"].includes(mode) && (
          <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:14, fontWeight:700, background:"#E6394612", border:"1px solid #E6394630", borderRadius:10, padding:"10px 14px" }}>{error}</div>
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
  const w                  = useWindowWidth();
  const mobile             = w < 640;
  const tablet             = w >= 640 && w < 1024;
  const desktop            = w >= 1024;

  // ── AUTH ────────────────────────────────────────────────────────────────────
  const [patron,  setPatron]  = useState(lsGet("cp_patron"));
  const [agent,   setAgent]   = useState(lsGet("cp_agent"));
  const [locked,  setLocked]  = useState(!!lsGet("cp_patron")||!!lsGet("cp_agent"));
  const [pinErr,  setPinErr]  = useState("");
  const [pinAttempts,setPinAttempts] = useState(0);
  const [pinBlocked, setPinBlocked]  = useState(false);
  const [pinBlockTime,setPinBlockTime] = useState(null);

  // ── UI ──────────────────────────────────────────────────────────────────────
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
  const [activeDays, setActiveDays]= useState([]);

  // ── PATRON DATA ─────────────────────────────────────────────────────────────
  const [agents,       setAgents]       = useState([]);
  const [allTxs,       setAllTxs]       = useState([]);
  const [allFloats,    setAllFloats]    = useState([]);
  const [selectedAgent,setSelectedAgent]= useState(null);
  const [inviteCode,   setInviteCode]   = useState(null);
  const [confirmDelAgent,setConfirmDelAgent] = useState(null); // agent à supprimer
  const [deletingAgent,  setDeletingAgent]   = useState(false);

  // ── AGENT DATA ──────────────────────────────────────────────────────────────
  const [agentTxs,    setAgentTxs]    = useState([]);
  const [pendingCount,setPendingCount]= useState(0);
  const [showReport,  setShowReport]  = useState(false);
  const [retraitDist, setRetraitDist] = useState(false);
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

  // ── EFFETS ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const bg=dark?"#06080F":"#F0F2F8";
    document.documentElement.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;width:100%!important;`;
    document.body.style.cssText=`margin:0!important;padding:0!important;background:${bg}!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;`;
  },[dark]);

  useEffect(()=>{
    document.title="CashPoint 💚";
    const faviconSVG=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><defs><linearGradient id="fg" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#00C896"/><stop offset="50%" stop-color="#00A5FF"/><stop offset="100%" stop-color="#7B2FBE"/></linearGradient></defs><rect x="2" y="2" width="48" height="48" rx="14" fill="url(#fg)"/><text x="26" y="36" text-anchor="middle" fill="white" font-weight="900" font-size="26" font-family="system-ui">C</text></svg>`;
    const url="data:image/svg+xml,"+encodeURIComponent(faviconSVG);
    document.querySelectorAll('link[rel*="icon"]').forEach(el=>el.remove());
    const fav=document.createElement("link"); fav.rel="icon"; fav.type="image/svg+xml"; fav.href=url; document.head.appendChild(fav);
  },[]);

  useEffect(()=>{
    if (patron&&!locked) loadPatronData();
  },[patron,locked,selectedDate]);

  // Auto-refresh toutes les 30 secondes pour le patron
  useEffect(()=>{
    if (!patron||locked) return;
    const iv = setInterval(()=>{ loadPatronData(); }, 30000);
    return ()=>clearInterval(iv);
  },[patron,locked,selectedDate]);

  useEffect(()=>{
    if (agent&&!locked) { loadAgentTxs(selectedDate); loadAgentFloats(selectedDate); }
  },[agent,locked,selectedDate]);

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

  // ── CHARGEMENT DATA PATRON ──────────────────────────────────────────────────
  async function loadPatronData() {
    setLoading(true);
    // Charger les agents d'abord pour avoir leurs IDs
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

  // ── CHARGEMENT DATA AGENT ───────────────────────────────────────────────────
  async function loadAgentTxs(date) {
    setLoading(true);
    const key=txKey(date,agent.id||agent.telephone);
    const cached=lsGet(key)||[];
    if (cached.length>0) { setAgentTxs(cached); setLoading(false); }
    else setLoading(true);
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

  // ── DÉVERROUILLAGE PIN ──────────────────────────────────────────────────────
  async function handleUnlock(pin) {
    if (pinBlocked) {
      const diff=Math.ceil((pinBlockTime+5*60*1000-Date.now())/60000);
      setPinErr(`🔒 Bloqué. Réessaie dans ${diff} min.`); return;
    }
    const user=patron||agent;
    const pinHash=await hashPin(pin);
    if (pinHash===user.pin) {
      if (isPatron) {
        fetchPatron(patron.telephone).then(f=>{
          if(f){ const t={...f,pin:patron.pin}; lsSet("cp_patron",t); setPatron(t); }
        });
      }
      if (isAgent) {
        // Recharger depuis Supabase pour avoir patron_id, id UUID etc.
        fetchAgent(agent.telephone).then(f=>{
          if(f){ const t={...f,pin:agent.pin}; lsSet("cp_agent",t); setAgent(t); }
        });
      }
      setLocked(false); setPinErr(""); setPinAttempts(0);
    } else {
      const n=pinAttempts+1; setPinAttempts(n);
      if (n>=3) {
        setPinBlocked(true); setPinBlockTime(Date.now());
        setPinErr("🔒 3 tentatives — bloqué 5 minutes.");
        setTimeout(()=>{ setPinBlocked(false);setPinAttempts(0);setPinErr(""); },5*60*1000);
      } else { setPinErr(`Code PIN incorrect. ${3-n} tentative${3-n>1?"s":""} restante${3-n>1?"s":""}.`); }
    }
  }

  function handleLogout() {
    lsDel("cp_patron"); lsDel("cp_agent");
    setPatron(null); setAgent(null); setLocked(false); setTab("dashboard"); setConfirmLogout(false);
  }

  // ── AJOUTER TRANSACTION AGENT ───────────────────────────────────────────────
  async function addTx() {
    if (!form.operateur||!form.montant) return;
    setSaving(true);
    const uid=agent.id||agent.telephone;
    const com=(modal==="retrait"&&!retraitDist)?calcFrais(form.operateur,Number(form.montant)):0;
    const localId=Date.now();
    const tx={
      agent_id:agent.id,
      patron_id:agent.patron_id,
      type:modal, operateur:form.operateur, montant:Number(form.montant), commission:com,
      telephone:form.telephone?`01${form.telephone}`:null,
      heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      created_at:nowISO(), localId
    };

    // Log pour diagnostic — visible dans F12 > Console
    console.log("💾 Tentative save tx:", JSON.stringify(tx));

    const optimistic={...tx,id:localId};
    setAgentTxs(p=>[optimistic,...p]);
    const result=await saveTx(tx);

    if (result.ok) {
      console.log("✅ TX sauvegardée dans Supabase:", result.data);
      setAgentTxs(p=>p.map(t=>t.id===localId?result.data:t));
    } else {
      console.error("❌ ERREUR Supabase:", result.error, "| TX:", JSON.stringify(tx));
      // Afficher l'erreur à l'agent pour qu'il puisse la reporter
      setFlashErr(result.error);
      setTimeout(()=>setFlashErr(null), 6000);
      const pend=lsGet(pendKey(uid))||[];
      lsSet(pendKey(uid),[...pend,tx]); setPendingCount(c=>c+1);
    }
    const cached=lsGet(txKey(selectedDate,uid))||[];
    lsSet(txKey(selectedDate,uid),[(result.ok?result.data:optimistic),...cached]);
    setSaving(false); setModal(null); setForm({}); setRetraitDist(false);
    if (result.ok) { setFlash(modal); setTimeout(()=>setFlash(null),2200); }
    setTimeout(()=>loadAgentTxs(selectedDate),1200);
  }

  async function removeAgentTx(id) {
    await deleteTx(id);
    const updated=agentTxs.filter(t=>t.id!==id);
    setAgentTxs(updated);
    lsSet(txKey(selectedDate,agent.id||agent.telephone),updated);
    setConfirm(null);
  }

  // ── FLOATS AGENT ────────────────────────────────────────────────────────────
  function saveAgentFloat(op,solde) {
    const uid=agent.id||agent.telephone;
    const updated={...floats,[op]:Number(solde)};
    setFloats(updated); lsSet(floatKey(selectedDate,uid),updated);
    // ✅ Sync Supabase pour que le patron voie les soldes
    saveFloat({
      agent_id: agent.id,
      patron_id: agent.patron_id,
      date: selectedDate,
      cash: capitalCash||0,
      float_mtn: op==="MTN"?Number(solde):(updated.MTN||null),
      float_moov: op==="MOOV"?Number(solde):(updated.MOOV||null),
      float_celtiis: op==="Celtiis"?Number(solde):(updated.Celtiis||null),
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
    return floats[op]-deps+rets;
  }
  function getFloatColor(actuel,depart) {
    if (actuel===null||!depart) return "#4A5060";
    if (actuel<0) return "#E63946";
    const p=actuel/depart; if (p<0.15) return "#E63946"; if (p<0.35) return "#FFB800"; return "#00C896";
  }
  function getFloatLabel(actuel,depart) {
    if (actuel===null) return null;
    if (actuel<0) return "⚠️ Dépassé";
    const p=depart>0?actuel/depart:1; if (p<0.15) return "🔴 Critique"; if (p<0.35) return "🟡 Faible"; return "🟢 OK";
  }

  // ── CALCULS STATS PATRON ────────────────────────────────────────────────────
  function getAgentStats(agentId) {
    const txs=allTxs.filter(t=>t.agent_id===agentId);
    const fl=allFloats.find(f=>f.agent_id===agentId)||null;
    const deps=txs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
    const rets=txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const frais=txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
    const cashDepart=fl?Number(fl.cash||0):null;
    const cashActuel=cashDepart!==null?cashDepart+deps-rets:null;
    const mtnA=fl?Number(fl.float_mtn||0)-txs.filter(t=>t.operateur==="MTN"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="MTN"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const moovA=fl?Number(fl.float_moov||0)-txs.filter(t=>t.operateur==="MOOV"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="MOOV"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const celtA=fl?Number(fl.float_celtiis||0)-txs.filter(t=>t.operateur==="Celtiis"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0)+txs.filter(t=>t.operateur==="Celtiis"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0):null;
    const momoA=(mtnA||0)+(moovA||0)+(celtA||0);
    const pointTotal=cashActuel!==null?cashActuel+momoA:null;
    return { depots:deps,retraits:rets,fraisRetrait:frais,nbOps:txs.length,lastOp:txs[0]?.heure||null,cashDepart,cashActuel,mtnActuel:mtnA,moovActuel:moovA,celtiisActuel:celtA,momoActuel:momoA,pointTotal,fl };
  }

  // ── GARDES ──────────────────────────────────────────────────────────────────
  if (!patron&&!agent) return <AuthScreen T={T} dark={dark} setDark={setDark}
    onPatronLogin={p=>{setPatron(p);lsSet("cp_patron",p);setLocked(false);setTab("dashboard");}}
    onAgentLogin={a=>{setAgent(a);lsSet("cp_agent",a);setLocked(false);setTab("accueil");}} />;
  if (locked) return <PinPad title="Bon retour 👋" subtitle={`Content de te revoir, ${(patron||agent).nom.split(" ")[0]} !`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  const totalAgentCA  = agentTxs.reduce((s,t)=>s+Number(t.montant),0);
  const totalAgentCom = agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);

  const NAV_PATRON = [["dashboard","📊","Dashboard"],["agents","👷","Agents"],["profil","👤","Profil"]];
  const NAV_AGENT  = [["accueil","🏠","Accueil"],["stats","📊","Stats"],["historique","🗂️","Historique"],["profil","👤","Profil"]];

  const modalWrap = { position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:200 };
  const modalBox  = { width:"100%", background:T.card, borderRadius:"22px 22px 0 0", padding:"16px 18px 48px", maxHeight:"90vh", overflowY:"auto" };

  return (<>
    <style>{`*,*::before,*::after{box-sizing:border-box!important;}html{margin:0!important;padding:0!important;}body{margin:0!important;padding:0!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;}button{-webkit-tap-highlight-color:transparent!important;}input,select{outline:none;}`}</style>
    <div style={{ background:T.bg, minHeight:"100vh", width:"100vw", maxWidth:"100%", color:T.text, fontFamily:"'Segoe UI',system-ui,sans-serif", overflowX:"hidden" }}>

      {/* FLASH SUCCÈS */}
      {flash && (<div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash]||"#00C896", color:"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:9999, boxShadow:"0 4px 24px #0009", whiteSpace:"nowrap" }}>
        ✅ {TYPE_LABEL[flash]||"Opération"} enregistrée !
      </div>)}

      {/* FLASH ERREUR — montre le vrai message Supabase */}
      {flashErr && (<div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:"#E63946", color:"#fff", borderRadius:14, padding:"12px 20px", fontWeight:700, fontSize:12, zIndex:9999, boxShadow:"0 4px 24px #0009", maxWidth:"90vw", textAlign:"center" }}>
        ❌ Erreur sync : {flashErr}
      </div>)}

      {/* HEADER */}
      <header style={{ background:T.card, padding:"14px 20px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#00C896,#00A5FF)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, color:"#fff" }}>C</div>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:T.text }}>CashPoint</div>
            <div style={{ fontSize:10, color:T.sub }}>{isPatron?`👑 ${patron.nom_entreprise}`:`👷 ${agent.nom}`}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {isAgent && pendingCount>0 && <div style={{ background:"#FFB80018", color:"#FFB800", borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:700 }}>⚡{pendingCount}</div>}
          {isAgent && <button onClick={()=>setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:16 }}>📅</button>}
          <button onClick={()=>setDark(d=>!d)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:14, color:T.text }}>{dark?"☀️":"🌙"}</button>
        </div>
      </header>

      {/* Bandeau date passée (agent) */}
      {isAgent && !isToday && (
        <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", margin:"12px 16px 0", borderRadius:12, padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
          <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          CONTENU PRINCIPAL
      ════════════════════════════════════════════════════════════════════════ */}
      <main style={{ padding:"16px 16px 120px", maxWidth:520, margin:"0 auto" }}>

        {/* ══════════════ DASHBOARD PATRON ══════════════════════════════ */}
        {isPatron && tab==="dashboard" && !selectedAgent && (<div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
            <div>
              <div style={{ fontWeight:900, fontSize:20 }}>{getSalutation(patron.nom)}</div>
              <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{todayStr()===selectedDate?"Tableau de bord du jour":"Données du "+new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setShowCal(true)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 12px", color:T.text, fontSize:16, cursor:"pointer" }}>📅</button>
              <button onClick={loadPatronData} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 12px", color:T.sub, fontSize:16, cursor:"pointer" }}>🔄</button>
            </div>
          </div>

          {/* Bandeau date passée */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", borderRadius:12, padding:"10px 16px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          {/* Résumé global */}
          {(()=>{
            const totalCA=allTxs.reduce((s,t)=>s+Number(t.montant),0);
            const totalFrais=allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
            const totalCash=allFloats.reduce((s,f)=>s+Number(f.cash||0),0);
            return (<div style={{ marginBottom:20 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>CHIFFRE D'AFFAIRES</div>
                  <div style={{ fontSize:22, fontWeight:900, color:"#00C896" }}>{fF(totalCA)}</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{allTxs.length} opérations</div>
                </div>
                <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>FRAIS DE RETRAIT</div>
                  <div style={{ fontSize:22, fontWeight:900, color:"#FFB800" }}>{fF(totalFrais)}</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>du jour</div>
                </div>
              </div>
              {totalCash>0 && <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:"1px solid #00C89630" }}>
                <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>💵 CASH TOTAL DE DÉPART (tous agents)</div>
                <div style={{ fontSize:20, fontWeight:900, color:"#00C896" }}>{fF(totalCash)}</div>
              </div>}
            </div>);
          })()}

          {/* Liste agents */}
          <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:12 }}>MES AGENTS — {agents.length} au total</div>
          {loading && <div style={{ textAlign:"center", color:T.sub, padding:32 }}>⏳ Chargement...</div>}
          {!loading && agents.length===0 && (<div style={{ background:T.card, borderRadius:16, padding:32, textAlign:"center", border:`1px solid ${T.border}` }}>
            <div style={{ fontSize:32, marginBottom:12 }}>👷</div>
            <div style={{ fontWeight:700, marginBottom:8 }}>Aucun agent encore</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Génère un code d'invitation pour ajouter ton premier agent</div>
            <button onClick={()=>setTab("agents")} style={{ background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", borderRadius:12, padding:"12px 24px", color:"#fff", fontWeight:800, cursor:"pointer" }}>➕ Ajouter un agent</button>
          </div>)}
          {agents.map(ag=>{
            const s=getAgentStats(ag.id);
            const actif=s.nbOps>0;
            const cashColor=s.cashActuel===null?T.sub:s.cashActuel<0?"#E63946":s.cashActuel/(s.cashDepart||1)<0.2?"#FFB800":"#00C896";
            return (<div key={ag.id} onClick={()=>setSelectedAgent(ag)} style={{ background:T.card, borderRadius:16, padding:16, marginBottom:12, border:`1px solid ${T.border}`, borderLeft:`3px solid ${actif?"#00C896":"#4A5060"}`, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:15 }}>👷 {ag.nom}</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{actif?`🕐 Dernière op : ${s.lastOp}`:"Aucune opération aujourd'hui"}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ background:actif?"#00C89618":"#4A506020", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:actif?"#00C896":T.sub }}>{actif?"🟢 Actif":"⚫ Inactif"}</div>
                  <span style={{ color:T.sub, fontSize:16 }}>›</span>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3 }}>CA DU JOUR</div>
                  <div style={{ fontSize:15, fontWeight:900, color:"#00C896" }}>{fF(s.depots+s.retraits)}</div>
                </div>
                <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3 }}>FRAIS DE RETRAIT</div>
                  <div style={{ fontSize:15, fontWeight:900, color:"#FFB800" }}>{fF(s.fraisRetrait)}</div>
                </div>
              </div>
              {s.cashActuel!==null && (<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3 }}>💵 CASH EN SAC</div>
                  <div style={{ fontSize:15, fontWeight:900, color:cashColor }}>{fF(s.cashActuel)}</div>
                </div>
                <div style={{ background:"#00C89610", borderRadius:10, padding:"10px 12px", border:"1px solid #00C89625" }}>
                  <div style={{ fontSize:10, color:T.sub, marginBottom:3 }}>📊 POINT TOTAL</div>
                  <div style={{ fontSize:15, fontWeight:900, color:"#00C896" }}>{fF(s.pointTotal)}</div>
                </div>
              </div>)}
            </div>);
          })}

          {/* ══ FIL DES TRANSACTIONS EN DIRECT ══════════════════════════ */}
          {allTxs.length > 0 && (
            <div style={{ background:T.card, borderRadius:16, padding:18, marginTop:8, border:`1px solid ${T.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>📋 Opérations en direct</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{allTxs.length} opération{allTxs.length>1?"s":""} aujourd'hui</div>
                </div>
                <div style={{ background:"#00C89618", borderRadius:8, padding:"4px 10px", fontSize:10, fontWeight:800, color:"#00C896" }}>🔴 LIVE</div>
              </div>

              {/* Totaux rapides */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
                {[
                  ["⬇️ Dépôts", allTxs.filter(t=>t.type==="depot").length, allTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0), "#00C896"],
                  ["⬆️ Retraits", allTxs.filter(t=>t.type==="retrait").length, allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0), "#4F8EF7"],
                  ["💰 Frais", allTxs.filter(t=>t.type==="retrait").length, allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0), "#FFB800"],
                ].map(([lbl,nb,total,col])=>(
                  <div key={lbl} style={{ background:T.hero, borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.sub, marginBottom:4 }}>{lbl}</div>
                    <div style={{ fontSize:14, fontWeight:900, color:col }}>{fF(total)}</div>
                    <div style={{ fontSize:10, color:T.faint }}>{nb} op</div>
                  </div>
                ))}
              </div>

              {/* Liste des transactions */}
              {allTxs.map((t,i) => {
                const agNom = agents.find(a=>a.id===t.agent_id)?.nom || "Agent";
                return (
                  <div key={t.id||i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom: i<allTxs.length-1?`1px solid ${T.border}`:"none" }}>
                    {/* Icône type */}
                    <div style={{ width:36, height:36, borderRadius:10, background:`${TYPE_COLOR[t.type]||"#00C896"}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
                      {TYPE_ICON[t.type]||"💳"}
                    </div>
                    {/* Info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>
                        {TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span>
                      </div>
                      <div style={{ fontSize:11, color:T.sub }}>
                        👷 {agNom} · {t.heure||""}
                      </div>
                    </div>
                    {/* Montant + frais */}
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontWeight:900, color:TYPE_COLOR[t.type]||"#00C896", fontSize:14 }}>{fF(t.montant)}</div>
                      {t.commission>0 && <div style={{ fontSize:11, color:"#FFB800", fontWeight:700 }}>frais {fF(t.commission)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>)}

        {/* ══════════════ DETAIL AGENT (PATRON) ═════════════════════════ */}
        {isPatron && tab==="dashboard" && selectedAgent && (()=>{
          const ag=selectedAgent; const s=getAgentStats(ag.id);
          const cashColor=s.cashActuel===null?T.sub:s.cashActuel<0?"#E63946":s.cashActuel/(s.cashDepart||1)<0.2?"#FFB800":"#00C896";
          return (<div>
            <button onClick={()=>setSelectedAgent(null)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 16px", color:T.text, fontSize:13, fontWeight:700, cursor:"pointer", marginBottom:20 }}>← Retour</button>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div><div style={{ fontWeight:900, fontSize:20 }}>👷 {ag.nom}</div><div style={{ fontSize:12, color:T.sub }}>+229 {ag.telephone}</div></div>
              <div style={{ background:s.nbOps>0?"#00C89618":"#4A506020", borderRadius:10, padding:"6px 14px", fontSize:12, fontWeight:800, color:s.nbOps>0?"#00C896":T.sub }}>{s.nbOps>0?"🟢 Actif":"⚫ Inactif"}</div>
            </div>
            {/* Cash en sac */}
            <div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:12, border:"1px solid #00C89630" }}>
              <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:12 }}>💵 ARGENT LIQUIDE (SAC)</div>
              {s.cashDepart===null?<div style={{ color:T.faint, fontSize:13 }}>Cash de départ non renseigné</div>:(<>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:8 }}>
                  <div><div style={{ fontSize:11, color:T.sub }}>Départ</div><div style={{ fontSize:14, fontWeight:700, color:T.sub }}>{fF(s.cashDepart)}</div></div>
                  <div style={{ textAlign:"right" }}><div style={{ fontSize:11, color:T.sub }}>Disponible</div><div style={{ fontSize:26, fontWeight:900, color:cashColor }}>{fF(s.cashActuel)}</div></div>
                </div>
                <div style={{ height:6, background:T.faint, borderRadius:3, overflow:"hidden", marginBottom:8 }}>
                  <div style={{ height:"100%", width:`${Math.max(0,Math.min(100,s.cashActuel/(s.cashDepart||1)*100))}%`, background:cashColor, borderRadius:3 }} />
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89625", borderRadius:8, padding:"6px 10px", fontSize:11 }}><span style={{ color:T.sub }}>⬇️ </span><span style={{ color:"#00C896", fontWeight:800 }}>+{fF(s.depots)}</span></div>
                  <div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394625", borderRadius:8, padding:"6px 10px", fontSize:11 }}><span style={{ color:T.sub }}>⬆️ </span><span style={{ color:"#E63946", fontWeight:800 }}>-{fF(s.retraits)}</span></div>
                </div>
              </>)}
            </div>
            {/* Comptes MoMo */}
            <div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:12, border:"1px solid #7B2FBE30" }}>
              <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:14 }}>📱 COMPTES MOMO</div>
              {[{op:"MTN",a:s.mtnActuel,d:s.fl?Number(s.fl.float_mtn||0):null},{op:"MOOV",a:s.moovActuel,d:s.fl?Number(s.fl.float_moov||0):null},{op:"Celtiis",a:s.celtiisActuel,d:s.fl?Number(s.fl.float_celtiis||0):null}].map(({op,a,d},i)=>(
                <div key={op} style={{ marginBottom:i<2?14:0, paddingBottom:i<2?14:0, borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:30, height:30, borderRadius:8, background:`${OP_COLORS[op]}18`, border:`1px solid ${OP_COLORS[op]}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:900, color:OP_COLORS[op] }}>{op}</div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                    </div>
                    {a!==null?<div style={{ fontSize:16, fontWeight:900, color:a<0?"#E63946":d>0&&a/d<0.15?"#FFB800":"#00C896" }}>{fF(a)}</div>:<div style={{ fontSize:12, color:T.faint }}>Non renseigné</div>}
                  </div>
                  {d!==null&&d>0&&<div style={{ height:4, background:T.faint, borderRadius:2, overflow:"hidden" }}><div style={{ height:"100%", width:`${Math.max(0,Math.min(100,a/d*100))}%`, background:OP_COLORS[op], borderRadius:2 }} /></div>}
                </div>
              ))}
            </div>
            {/* Point total */}
            <div style={{ background:"linear-gradient(135deg,#00C89615,#00A5FF10)", borderRadius:16, padding:18, marginBottom:12, border:"1px solid #00C89635" }}>
              <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>📊 POINT TOTAL DU JOUR</div>
              {[["Argent liquide",fF(s.cashActuel!==null?s.cashActuel:0),cashColor],["Total MoMo",fF(s.momoActuel),"#9B5FDE"]].map(([lbl,val,col])=>(
                <div key={lbl} style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}><div style={{ fontSize:13, color:T.sub }}>{lbl}</div><div style={{ fontSize:15, fontWeight:800, color:col }}>{val}</div></div>
              ))}
              <div style={{ height:1, background:T.border, margin:"10px 0" }} />
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:14, fontWeight:800 }}>TOTAL GÉNÉRAL</div>
                <div style={{ fontSize:24, fontWeight:900, color:"#00C896" }}>{s.pointTotal!==null?fF(s.pointTotal):"—"}</div>
              </div>
            </div>
            {/* Bilan journée */}
            <div style={{ background:T.card, borderRadius:16, padding:18, border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:14 }}>📋 BILAN DE JOURNÉE</div>
              {[["CA total",fF(s.depots+s.retraits),"#00C896"],["Dépôts",`${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="depot").length} op · ${fF(s.depots)}`,"#00C896"],["Retraits",`${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="retrait").length} op · ${fF(s.retraits)}`,"#4F8EF7"],["Frais de retrait",fF(s.fraisRetrait),"#FFB800"]].map(([l,v,c])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:13, color:T.sub }}>{l}</div><div style={{ fontSize:14, fontWeight:800, color:c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>);
        })()}

        {/* ══════════════ GESTION AGENTS (PATRON) ═══════════════════════ */}
        {isPatron && tab==="agents" && (<div>
          <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>👷 Mes agents ({agents.length}/10)</div>
          <div style={{ background:T.card, borderRadius:16, padding:20, marginBottom:20, border:`1px solid ${T.border}` }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>➕ Ajouter un agent</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Génère un code unique que tu donnes à ton agent pour qu'il crée son compte.</div>
            {inviteCode?(
              <div>
                <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:12, padding:20, textAlign:"center", marginBottom:12 }}>
                  <div style={{ fontSize:11, color:T.sub, marginBottom:6 }}>CODE D'INVITATION</div>
                  <div style={{ fontSize:36, fontWeight:900, color:"#00C896", letterSpacing:8 }}>{inviteCode}</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:6 }}>Usage unique · Partage-le à ton agent</div>
                </div>
                <button onClick={()=>navigator.clipboard?.writeText(inviteCode)} style={{ width:"100%", padding:12, borderRadius:12, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:13, cursor:"pointer", marginBottom:8 }}>📋 Copier le code</button>
                <button onClick={()=>setInviteCode(null)} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:12, cursor:"pointer" }}>Générer un autre code</button>
              </div>
            ):(
              <button onClick={async()=>{ const c=await generateInviteCode(patron.id); setInviteCode(c); }} disabled={agents.length>=10}
                style={{ width:"100%", padding:16, borderRadius:12, background:agents.length>=10?T.hero:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:agents.length>=10?T.sub:"#fff", fontWeight:800, fontSize:14, cursor:agents.length>=10?"not-allowed":"pointer" }}>
                {agents.length>=10?"Maximum 10 agents atteint":"🔑 Générer un code d'invitation"}
              </button>
            )}
          </div>
          {agents.map(ag=>(
            <div key={ag.id} style={{ background:T.card, borderRadius:14, padding:16, marginBottom:10, border:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontWeight:700 }}>{ag.nom}</div>
                <div style={{ fontSize:12, color:T.sub }}>+229 {ag.telephone}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ background:"#00C89618", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:"#00C896" }}>Actif</div>
                <button onClick={()=>setConfirmDelAgent(ag)}
                  style={{ background:"#E6394618", border:"1px solid #E6394640", borderRadius:8, padding:"6px 10px", color:"#E63946", fontSize:13, cursor:"pointer", fontWeight:700 }}>
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>)}

        {/* ══════════════ ACCUEIL AGENT ══════════════════════════════════ */}
        {isAgent && tab==="accueil" && (<>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontWeight:900, fontSize:20 }}>{getSalutation(agent.nom)}</div>
            <div style={{ fontSize:12, color:T.sub, marginTop:3 }}>{isToday?"Tableau de bord du jour":`${new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}`}</div>
          </div>

          {/* Capital Cash */}
          {(()=>{
            const cashActuel=calcCashActuel();
            const cashPct=capitalCash>0&&cashActuel!==null?Math.max(0,Math.min(100,cashActuel/capitalCash*100)):0;
            const cashColor=cashActuel===null?T.sub:cashActuel<0?"#E63946":cashActuel/(capitalCash||1)<0.2?"#FFB800":"#00C896";
            const depT=agentTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
            const retT=agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
            return (<div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:14, border:"1px solid #00C89630" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div><div style={{ fontWeight:800, fontSize:14 }}>💵 Capital Cash</div><div style={{ fontSize:11, color:T.sub }}>Commun MTN · MOOV · Celtiis</div></div>
                {isToday && <button onClick={()=>{setCashInput(capitalCash!==null?String(capitalCash):"");setShowCashModal(true);}} style={{ background:"#00C89618", border:"1px solid #00C89640", borderRadius:9, padding:"6px 14px", color:"#00C896", fontSize:11, fontWeight:800, cursor:"pointer" }}>{capitalCash===null?"+ Définir":"✏️ Modifier"}</button>}
              </div>
              {capitalCash===null?(<div style={{ textAlign:"center", padding:"12px 0", color:T.faint, fontSize:13 }}>Entre ton capital cash du matin</div>):(<>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
                  <div><div style={{ fontSize:11, color:T.sub }}>Départ</div><div style={{ fontSize:15, fontWeight:700, color:T.sub }}>{fF(capitalCash)}</div></div>
                  <div style={{ textAlign:"right" }}><div style={{ fontSize:11, color:T.sub }}>Disponible</div><div style={{ fontSize:26, fontWeight:900, color:cashColor }}>{fF(cashActuel)}</div></div>
                </div>
                <div style={{ height:6, background:T.faint, borderRadius:3, overflow:"hidden", marginBottom:10 }}><div style={{ height:"100%", width:`${cashPct}%`, background:cashColor, borderRadius:3, transition:"width 0.4s" }} /></div>
                <div style={{ display:"flex", gap:8 }}>
                  {depT>0&&<div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89625", borderRadius:8, padding:"6px 10px", fontSize:11 }}><span style={{ color:T.sub }}>⬇️ </span><span style={{ color:"#00C896", fontWeight:800 }}>+{fF(depT)}</span></div>}
                  {retT>0&&<div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394625", borderRadius:8, padding:"6px 10px", fontSize:11 }}><span style={{ color:T.sub }}>⬆️ </span><span style={{ color:"#E63946", fontWeight:800 }}>-{fF(retT)}</span></div>}
                </div>
                {cashActuel<0&&<div style={{ marginTop:8, background:"#E6394620", border:"1px solid #E6394650", borderRadius:8, padding:"6px 12px", fontSize:11, color:"#E63946", fontWeight:800 }}>🚨 Cash insuffisant ! Manque {fF(Math.abs(cashActuel))}</div>}
                {cashActuel>=0&&capitalCash>0&&cashActuel/capitalCash<0.2&&<div style={{ marginTop:8, background:"#FFB80015", border:"1px solid #FFB80035", borderRadius:8, padding:"6px 12px", fontSize:11, color:"#FFB800", fontWeight:700 }}>⚠️ Cash faible — pense à te réapprovisionner</div>}
              </>)}
            </div>);
          })()}

          {/* Solde de départ (floats) */}
          <div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:14, border:"1px solid #7B2FBE30" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div><div style={{ fontWeight:800, fontSize:14 }}>💼 Solde de départ</div><div style={{ fontSize:11, color:T.sub }}>Unités électroniques par réseau</div></div>
              {isToday&&<button onClick={()=>{setFloatEditOp(null);setFloatInput("");setShowFloatModal(true);}} style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:9, padding:"6px 14px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>✏️ Modifier</button>}
            </div>
            {OPS.map((op,i)=>{
              const actuel=calcFloatActuel(op); const depart=floats[op];
              const color=getFloatColor(actuel,depart); const label=getFloatLabel(actuel,depart);
              const depO=agentTxs.filter(t=>t.operateur===op&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
              const retO=agentTxs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
              const pct=depart>0&&actuel!==null?Math.max(0,Math.min(100,actuel/depart*100)):0;
              return (<div key={op} style={{ marginBottom:i<2?14:0, paddingBottom:i<2?14:0, borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:depart!==null?8:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op] }}>{op}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                      {depart!==null?<div style={{ fontSize:10, color:T.sub }}>Départ : {fF(depart)}</div>:<div style={{ fontSize:10, color:T.faint }}>Non défini</div>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {actuel!==null?(<><div style={{ fontSize:17, fontWeight:900, color }}>{fF(actuel)}</div><div style={{ fontSize:10, fontWeight:700, color }}>{label}</div></>):(
                      <button onClick={()=>{setFloatEditOp(op);setFloatInput("");setShowFloatModal(true);}} style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:8, padding:"6px 12px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>+ Définir</button>
                    )}
                  </div>
                </div>
                {depart!==null&&actuel!==null&&<div style={{ height:5, background:T.faint, borderRadius:3, overflow:"hidden", marginBottom:6 }}><div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3 }} /></div>}
                {depart!==null&&(depO>0||retO>0)&&<div style={{ display:"flex", gap:6, marginTop:4 }}>
                  {depO>0&&<div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬇️ </span><span style={{ color:"#E63946", fontWeight:700 }}>-{fF(depO)}</span></div>}
                  {retO>0&&<div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬆️ </span><span style={{ color:"#00C896", fontWeight:700 }}>+{fF(retO)}</span></div>}
                </div>}
                {actuel!==null&&actuel<5000&&actuel>=0&&<div style={{ marginTop:6, background:"#E6394612", border:"1px solid #E6394635", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:700 }}>⚠️ Solde {op} bas !</div>}
                {actuel!==null&&actuel<0&&<div style={{ marginTop:6, background:"#E6394620", border:"1px solid #E6394650", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:800 }}>🚨 Dépassé de {fF(Math.abs(actuel))} !</div>}
              </div>);
            })}
          </div>

          {/* Vente d'unités (forfaits) */}
          {isToday && (<div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:14, border:"1px solid #9B5FDE30" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div><div style={{ fontWeight:800, fontSize:14 }}>📦 Vente d'unités</div><div style={{ fontSize:11, color:T.sub }}>3 taps pour enregistrer</div></div>
              <div style={{ fontSize:11, color:"#9B5FDE", fontWeight:700 }}>{agentTxs.filter(t=>t.type==="forfait").length} vendu(s)</div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>1 — TYPE</div>
              <div style={{ display:"flex", gap:8 }}>
                {[["internet","🌐","Internet"],["appel","📞","Appel"],["simple","📱","Simple"]].map(([k,ico,lbl])=>(
                  <button key={k} onClick={()=>setForm(f=>({...f,forfaitType:f.forfaitType===k?null:k,forfaitPrix:null}))}
                    style={{ flex:1, padding:"10px 4px", borderRadius:11, border:`2px solid ${form.forfaitType===k?"#9B5FDE":T.border}`, background:form.forfaitType===k?"#9B5FDE18":"transparent", color:form.forfaitType===k?"#9B5FDE":T.sub, fontWeight:800, fontSize:12, cursor:"pointer", textAlign:"center" }}>
                    <div style={{ fontSize:16 }}>{ico}</div><div style={{ marginTop:2 }}>{lbl}</div>
                  </button>
                ))}
              </div>
            </div>
            {form.forfaitType && (<div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>2 — RÉSEAU</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPS.map(op=>(
                  <button key={op} onClick={()=>setForm(f=>({...f,forfaitOp:f.forfaitOp===op?null:op,forfaitPrix:null}))}
                    style={{ flex:1, padding:"10px 0", borderRadius:11, border:`2px solid ${form.forfaitOp===op?OP_COLORS[op]:T.border}`, background:form.forfaitOp===op?OP_BG[op]:"transparent", color:form.forfaitOp===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                    {op}
                  </button>
                ))}
              </div>
            </div>)}
            {form.forfaitType&&form.forfaitOp&&(()=>{
              const G={MTN:{internet:[100,300,500,1000,2000,3500,6000,15100,25000,50000,100000],appel:[100,150,200,300,500,1000,2500,5000],simple:[100,200,500,1000,2000,5000]},MOOV:{internet:[200,500,1000,2000,4500,8000,15000,20000,50000],appel:[100,200,500,1000,2500,5000],simple:[100,200,500,1000,5000]},Celtiis:{internet:[1000,3000,5000,10000,20000],appel:[100,200,500,1500,3000,5000,10000],simple:[200,500,1000,2000,5000]}};
              const prix=G[form.forfaitOp]?.[form.forfaitType]||[];
              return (<div style={{ marginBottom:10 }}>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>3 — MONTANT</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {prix.map(p=>(<button key={p} onClick={()=>setForm(f=>({...f,forfaitPrix:p}))}
                    style={{ padding:"7px 12px", borderRadius:9, border:`2px solid ${form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.border}`, background:form.forfaitPrix===p?OP_BG[form.forfaitOp]:"transparent", color:form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.sub, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    {p>=1000?`${p/1000}k`:p} F
                  </button>))}
                </div>
              </div>);
            })()}
            {form.forfaitType&&form.forfaitOp&&form.forfaitPrix&&(<button onClick={async()=>{
              setSaving(true);
              const uid=agent.id||agent.telephone; const localId=Date.now();
              const lbls={internet:"🌐 Internet",appel:"📞 Appel",simple:"📱 Simple"};
              const tx={agent_id:agent.id,patron_id:agent.patron_id,type:"forfait",operateur:form.forfaitOp,montant:Number(form.forfaitPrix),commission:0,client:lbls[form.forfaitType]||"Forfait",telephone:null,heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),created_at:nowISO(),localId};
              const opt={...tx,id:localId}; setAgentTxs(p=>[opt,...p]);
              const result=await saveTx(tx);
              if(result.ok){setAgentTxs(p=>p.map(t=>t.id===localId?result.data:t));}
              else{console.error("❌ Forfait Supabase:",result.error);const pend=lsGet(pendKey(uid))||[];lsSet(pendKey(uid),[...pend,tx]);setPendingCount(c=>c+1);}
              lsSet(txKey(selectedDate,uid),[(result.ok?result.data:opt),...(lsGet(txKey(selectedDate,uid))||[])]);
              setSaving(false); setForm({});
              if(result.ok){setFlash("forfait"); setTimeout(()=>setFlash(null),2200);}
              setTimeout(()=>loadAgentTxs(selectedDate),1200);
            }} disabled={saving} style={{ width:"100%", padding:14, borderRadius:12, background:saving?"#1A1D2E":"linear-gradient(135deg,#9B5FDE,#7B2FBE)", border:"none", color:saving?T.sub:"#fff", fontWeight:900, fontSize:14, cursor:saving?"not-allowed":"pointer" }}>
              {saving?"⏳ Sauvegarde…":`✅ ${form.forfaitOp} ${form.forfaitType} ${fF(form.forfaitPrix)}`}
            </button>)}
          </div>)}

          {/* Bouton rapport */}
          <button onClick={()=>setShowReport(true)} style={{ width:"100%", padding:14, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
            <span style={{ fontSize:18 }}>📤</span> Envoyer le point du jour
          </button>

          {/* Opérations récentes */}
          <div style={{ background:T.card, borderRadius:14, padding:16, border:`1px solid ${T.border}` }}>
            <div style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>Opérations du jour</div>
            {loading&&<div style={{ textAlign:"center", color:T.faint, padding:"24px 0" }}>⏳ Chargement...</div>}
            {!loading&&agentTxs.length===0&&<div style={{ textAlign:"center", color:T.faint, padding:"32px 0", fontSize:13 }}>{isToday?"Aucune opération · Appuie sur ⬇️ ou ⬆️":"Aucune opération ce jour"}</div>}
            {agentTxs.slice(0,8).map((t,i)=>(
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:i<Math.min(agentTxs.length,8)-1?`1px solid ${T.border}`:"none" }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                  <div style={{ fontSize:11, color:T.sub }}>{t.telephone||"—"} · {t.heure}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                  {t.commission>0&&<div style={{ fontSize:11, color:"#FFB800" }}>+{fF(t.commission)}</div>}
                </div>
                {isToday&&<button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:15, padding:"0 4px" }}>🗑️</button>}
              </div>
            ))}
          </div>
        </>)}

        {/* ══════════════ STATS AGENT ════════════════════════════════════ */}
        {isAgent && tab==="stats" && (<div>
          <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>📊 Statistiques</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[["CA TOTAL",fF(totalAgentCA),"#00C896"],["FRAIS DE RETRAIT",fF(totalAgentCom),"#FFB800"]].map(([lbl,val,col])=>(
              <div key={lbl} style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>{lbl}</div>
                <div style={{ fontSize:20, fontWeight:900, color:col }}>{val}</div>
              </div>
            ))}
          </div>
          {["depot","retrait"].map(type=>{
            const tTxs=agentTxs.filter(t=>t.type===type);
            return (<div key={type} style={{ background:T.card, borderRadius:16, padding:18, marginBottom:12, border:`1px solid ${TYPE_COLOR[type]}22` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                <div style={{ fontWeight:800, fontSize:14 }}>{TYPE_ICON[type]} {TYPE_LABEL[type]}s</div>
                <div><span style={{ color:TYPE_COLOR[type], fontWeight:900 }}>{fF(tTxs.reduce((s,t)=>s+Number(t.montant),0))}</span></div>
              </div>
              {OPS.map((op,i)=>{
                const o=agentTxs.filter(t=>t.type===type&&t.operateur===op);
                return (<div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:i<2?`1px solid ${T.border}`:"none", fontSize:13 }}>
                  <div><span style={{ color:OP_COLORS[op], fontWeight:700 }}>{op}</span><span style={{ color:T.faint, fontSize:11 }}> {o.length} op</span></div>
                  <div style={{ fontWeight:700 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</div>
                </div>);
              })}
            </div>);
          })}
        </div>)}

        {/* ══════════════ HISTORIQUE AGENT ══════════════════════════════ */}
        {isAgent && tab==="historique" && (<div>
          <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>🗂️ Historique</div>
          {loading&&<div style={{ textAlign:"center", color:T.faint, padding:"48px 0" }}>⏳ Chargement...</div>}
          {!loading&&agentTxs.length===0&&<div style={{ textAlign:"center", color:T.faint, padding:"56px 0", fontSize:14 }}>Aucune opération {isToday?"enregistrée":"ce jour"}</div>}
          {agentTxs.map(t=>(
            <div key={t.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", marginBottom:10, border:`1px solid ${TYPE_COLOR[t.type]}18`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:11, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{TYPE_ICON[t.type]}</div>
                <div>
                  <div style={{ fontWeight:700, fontSize:13 }}>{TYPE_LABEL[t.type]} · <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                  <div style={{ fontSize:11, color:T.sub }}>{t.telephone||"—"} · {t.heure}</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:15 }}>{fF(t.montant)}</div>
                  {t.commission>0&&<div style={{ fontSize:11, color:"#FFB800" }}>+{fF(t.commission)}</div>}
                </div>
                {isToday&&<button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:15 }}>🗑️</button>}
              </div>
            </div>
          ))}
        </div>)}

        {/* ══════════════ PROFIL (PATRON + AGENT) ═══════════════════════ */}
        {tab==="profil" && (<div>
          <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>👤 Profil</div>
          <div style={{ background:T.card, borderRadius:16, padding:20, marginBottom:14, border:`1px solid ${T.border}` }}>
            {isPatron&&(<>
              <div style={{ fontSize:11, color:T.sub, marginBottom:12, fontWeight:700 }}>COMPTE PATRON</div>
              {[["👑 Nom",patron.nom],["📞 Téléphone",patron.telephone],["🏢 Entreprise",patron.nom_entreprise],["📋 RC",patron.registre_commerce],["🌍 Pays",patron.pays]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ fontSize:13, color:T.sub }}>{l}</span><span style={{ fontSize:13, fontWeight:700 }}>{v}</span>
                </div>
              ))}
            </>)}
            {isAgent&&(<>
              <div style={{ fontSize:11, color:T.sub, marginBottom:12, fontWeight:700 }}>COMPTE AGENT</div>
              {[["👷 Nom",agent.nom],["📞 Téléphone",agent.telephone]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ fontSize:13, color:T.sub }}>{l}</span><span style={{ fontSize:13, fontWeight:700 }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:12 }}>
                {pendingCount>0?<div style={{ background:"#FFB80018", border:"1px solid #FFB80040", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#FFB800", fontWeight:700 }}>⚡ {pendingCount} opération(s) en attente de sync</div>:<div style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#00C896", fontWeight:700 }}>✅ Toutes les données synchronisées</div>}
              </div>
            </>)}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:T.card, borderRadius:14, padding:"14px 16px", marginBottom:14, border:`1px solid ${T.border}` }}>
            <div><div style={{ fontWeight:700, fontSize:13 }}>{dark?"Mode sombre":"Mode clair"}</div><div style={{ fontSize:11, color:T.sub }}>Changer l'apparence</div></div>
            <button onClick={()=>setDark(d=>!d)} style={{ padding:"8px 16px", borderRadius:10, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:13, fontWeight:700, cursor:"pointer" }}>{dark?"☀️":"🌙"}</button>
          </div>
          <button onClick={()=>setConfirmLogout(true)} style={{ width:"100%", padding:16, borderRadius:14, background:"#E6394618", border:"2px solid #E6394640", color:"#E63946", fontWeight:800, fontSize:15, cursor:"pointer" }}>🔓 Se déconnecter</button>
        </div>)}

      </main>

      {/* ══ FABs AGENT ══════════════════════════════════════════════════ */}
      {isAgent && tab==="accueil" && isToday && (<div style={{ position:"fixed", bottom:90, right:16, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
        <button onClick={()=>{setModal("retrait");setForm({});setRetraitDist(false);}} style={{ height:48, paddingLeft:16, paddingRight:18, borderRadius:24, background:"#4F8EF7", border:"none", color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 4px 18px #4F8EF760", display:"flex", alignItems:"center", gap:8 }}><span>⬆️</span> Retrait</button>
        <button onClick={()=>{setModal("depot");setForm({});}} style={{ height:54, paddingLeft:18, paddingRight:20, borderRadius:27, background:"linear-gradient(135deg,#00C896,#009E78)", border:"none", color:"#fff", fontSize:14, fontWeight:900, cursor:"pointer", boxShadow:"0 6px 24px #00C89660", display:"flex", alignItems:"center", gap:8 }}><span>⬇️</span> Dépôt</button>
      </div>)}

      {/* ══ BOTTOM NAV ══════════════════════════════════════════════════ */}
      <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.nav, borderTop:`1px solid ${T.border}`, zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-around", padding:"8px 0 12px", maxWidth:520, margin:"0 auto" }}>
          {(isPatron?NAV_PATRON:NAV_AGENT).map(([key,icon,label])=>(
            <button key={key} onClick={()=>{ setTab(key); if(key==="dashboard") setSelectedAgent(null); }} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.faint, fontSize:10, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"0 16px" }}>
              <span style={{ fontSize:22 }}>{icon}</span>{label}
              {tab===key&&<div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
            </button>
          ))}
        </div>
      </nav>

      {/* ══ MODAL TRANSACTION ═══════════════════════════════════════════ */}
      {modal && (<div style={modalWrap} onClick={()=>setModal(null)}>
        <div onClick={e=>e.stopPropagation()} style={modalBox}>
          <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
          <div style={{ fontWeight:900, fontSize:18, marginBottom:16 }}>{modal==="depot"?"⬇️ Nouveau Dépôt":"⬆️ Nouveau Retrait"}</div>

          {modal==="retrait" && (<>
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              {[["normal","✅ Normal",false],["distance","📡 À distance",true]].map(([k,lbl,val])=>(
                <button key={k} onClick={()=>setRetraitDist(val)} style={{ flex:1, padding:"10px 0", borderRadius:12, border:`2px solid ${retraitDist===val?(val?"#FFB800":"#00C896"):T.border}`, background:retraitDist===val?(val?"#FFB80020":"#00C89620"):"transparent", color:retraitDist===val?(val?"#FFB800":"#00C896"):T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>{lbl}</button>
              ))}
            </div>
            {retraitDist&&<div style={{ background:"#FFB80015", border:"1px solid #FFB80040", borderRadius:10, padding:"9px 14px", fontSize:12, color:"#FFB800", fontWeight:700, marginBottom:12 }}>📡 Frais de retrait = 0 F pour toi</div>}
            {form.montant&&Number(form.montant)>=100&&(()=>{
              const t=getTranche(form.montant);
              const c=form.operateur?calcFrais(form.operateur,form.montant):0;
              return t?(<div style={{ background:"#4F8EF712", border:"1px solid #4F8EF735", borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
                <div style={{ fontSize:11, color:"#4F8EF7", fontWeight:700, marginBottom:10 }}>TRANCHE : {Number(t.min).toLocaleString("fr-FR")} – {Number(t.max).toLocaleString("fr-FR")} F</div>
                <div style={{ display:"flex", gap:8 }}>
                  {OPS.map(op=>{ const sel=op===form.operateur; return (<div key={op} style={{ flex:1, textAlign:"center", background:sel?`${OP_COLORS[op]}20`:T.hero, border:`2px solid ${sel?OP_COLORS[op]:T.border}`, borderRadius:11, padding:"10px 4px" }}>
                    <div style={{ fontSize:10, color:OP_COLORS[op], fontWeight:800, marginBottom:4 }}>{op}</div>
                    <div style={{ fontSize:15, fontWeight:900, color:sel?OP_COLORS[op]:T.text }}>{fF(t[op])}</div>
                  </div>); })}
                </div>
                {form.operateur&&!retraitDist&&<div style={{ marginTop:10, background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:12, color:T.sub }}>💰 Frais de retrait</span>
                  <span style={{ fontSize:18, fontWeight:900, color:"#00C896" }}>{fF(c)}</span>
                </div>}
              </div>):null;
            })()}
          </>)}

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>MONTANT (FCFA)</div>
            <input type="number" placeholder="Ex : 5000" value={form.montant||""} onChange={e=>setForm(f=>({...f,montant:e.target.value}))} autoFocus
              style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:20, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>NUMÉRO CLIENT (optionnel)</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 10px", color:T.text, fontSize:13, fontWeight:800 }}>🇧🇯 01</div>
              <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone||""} onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,8); const op=detectOp(v); setForm(f=>({...f,telephone:v,operateur:op||f.operateur})); }}
                style={{ flex:1, background:T.input, border:`2px solid ${form.operateur?OP_COLORS[form.operateur]:T.border}`, borderRadius:12, padding:"12px 14px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>RÉSEAU</div>
            <div style={{ display:"flex", gap:8 }}>
              {OPS.map(op=>(<button key={op} onClick={()=>setForm(f=>({...f,operateur:op}))} style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?OP_BG[op]:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>{op}</button>))}
            </div>
          </div>
          <button onClick={addTx} disabled={saving||!form.operateur||!form.montant}
            style={{ width:"100%", padding:17, borderRadius:14, background:(!form.operateur||!form.montant)?T.hero:modal==="depot"?"#00C896":"#4F8EF7", border:"none", color:(!form.operateur||!form.montant)?T.sub:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
            {saving?"⏳ Sauvegarde…":"Enregistrer ✓"}
          </button>
        </div>
      </div>)}

      {/* ══ MODAL RAPPORT AGENT ═════════════════════════════════════════ */}
      {showReport && isAgent && (()=>{
        const dateLabel=new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
        const cashActuel=calcCashActuel();
        return (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowReport(false)}>
          <div style={{ background:"#fff", borderRadius:20, padding:24, maxWidth:400, width:"100%", maxHeight:"90vh", overflowY:"auto", color:"#111" }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div><div style={{ fontWeight:900, fontSize:16 }}>📊 Point du jour</div><div style={{ fontSize:12, color:"#666" }}>{dateLabel}</div></div>
              <button onClick={()=>setShowReport(false)} style={{ background:"#f0f0f0", border:"none", borderRadius:20, width:32, height:32, cursor:"pointer", fontSize:16 }}>✕</button>
            </div>
            <div style={{ background:"#f8f8f8", borderRadius:12, padding:"10px 14px", marginBottom:16, fontSize:13 }}>👤 <strong>{agent.nom}</strong> · {agent.telephone}</div>
            <div style={{ fontWeight:900, fontSize:13, color:"#00C896", borderBottom:"2px solid #00C89630", paddingBottom:6, marginBottom:12 }}>💵 ARGENT</div>
            {OPS.map(op=>{
              const deps=agentTxs.filter(t=>t.type==="depot"&&t.operateur===op);
              const rets=agentTxs.filter(t=>t.type==="retrait"&&t.operateur===op);
              if (!deps.length&&!rets.length) return null;
              return (<div key={op} style={{ marginBottom:10, background:"#f8f8f8", borderRadius:10, padding:"10px 14px" }}>
                <div style={{ fontWeight:800, fontSize:13, marginBottom:6 }}>{op}</div>
                {deps.length>0&&<div style={{ fontSize:13, marginBottom:3 }}>⬇️ Dépôts : <strong>{deps.length} op — {fF(deps.reduce((s,t)=>s+Number(t.montant),0))}</strong></div>}
                {rets.length>0&&<div style={{ fontSize:13 }}>⬆️ Retraits : <strong>{rets.length} op — {fF(rets.reduce((s,t)=>s+Number(t.montant),0))}</strong> <span style={{color:"#888",fontSize:11}}>frais {fF(rets.reduce((s,t)=>s+Number(t.commission),0))}</span></div>}
              </div>);
            })}
            <div style={{ display:"flex", gap:10, marginBottom:12 }}>
              <div style={{ flex:1, background:"#00C89615", borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#666" }}>CA Total</div><div style={{ fontWeight:900, fontSize:18, color:"#00C896" }}>{fF(totalAgentCA)}</div>
              </div>
              <div style={{ flex:1, background:"#FFB80015", borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#666" }}>Frais retrait</div><div style={{ fontWeight:900, fontSize:18, color:"#FFB800" }}>{fF(totalAgentCom)}</div>
              </div>
            </div>
            {cashActuel!==null&&(<div style={{ marginBottom:12 }}>
              <div style={{ fontWeight:900, fontSize:13, color:"#00C896", borderBottom:"2px solid #00C89630", paddingBottom:6, marginBottom:10 }}>💵 CAISSE</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:13, borderBottom:"1px solid #eee" }}><span>Départ</span><strong>{fF(capitalCash)}</strong></div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:13 }}><span>Maintenant</span><strong style={{color:cashActuel<0?"#E63946":"#00C896"}}>{fF(cashActuel)}</strong></div>
            </div>)}
            <div style={{ marginTop:12, fontSize:11, color:"#aaa", textAlign:"center", marginBottom:12 }}>Généré par CashPoint · {new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>
            <button onClick={()=>{
              const lines=[];
              lines.push(`📊 *POINT DU JOUR — ${dateLabel.toUpperCase()}*`);
              lines.push(`👤 ${agent.nom} | ${agent.telephone}`);
              lines.push("");
              OPS.forEach(op=>{
                const deps=agentTxs.filter(t=>t.type==="depot"&&t.operateur===op);
                const rets=agentTxs.filter(t=>t.type==="retrait"&&t.operateur===op);
                if (deps.length||rets.length) {
                  lines.push(`▪️ ${op}`);
                  if (deps.length) lines.push(`  ⬇️ Dépôts: ${deps.length} op · ${fF(deps.reduce((s,t)=>s+Number(t.montant),0))}`);
                  if (rets.length) lines.push(`  ⬆️ Retraits: ${rets.length} op · ${fF(rets.reduce((s,t)=>s+Number(t.montant),0))} · frais ${fF(rets.reduce((s,t)=>s+Number(t.commission),0))}`);
                }
              });
              lines.push(""); lines.push(`💰 CA: ${fF(totalAgentCA)} | Frais retrait: ${fF(totalAgentCom)}`);
              if (cashActuel!==null) lines.push(`💵 Caisse: ${fF(capitalCash)} → ${fF(cashActuel)}`);
              lines.push(""); lines.push("_CashPoint_");
              window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`,"_blank");
            }} style={{ width:"100%", padding:14, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:900, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <span style={{fontSize:18}}>📤</span> Partager sur WhatsApp
            </button>
          </div>
        </div>);
      })()}

      {/* ══ MODAL CALENDRIER ════════════════════════════════════════════ */}
      {showCal && isAgent && (<div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:300 }} onClick={()=>setShowCal(false)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:"22px 22px 0 0", padding:"20px 18px 36px", border:`1px solid ${T.border2}`, width:"100%" }}>
          <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
            <button onClick={()=>{if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>‹</button>
            <div style={{ fontWeight:800, fontSize:15 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
            <button onClick={()=>{if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:8 }}>
            {JOURS.map(j=>(<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"4px 0" }}>{j}</div>))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {Array(new Date(calYear,calMonth-1,1).getDay()).fill(null).map((_,i)=>(<div key={`e${i}`}/>))}
            {Array(new Date(calYear,calMonth,0).getDate()).fill(null).map((_,i)=>{
              const day=i+1, ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const isTod=ds===todayStr(), isSel=ds===selectedDate, isFut=ds>todayStr();
              return (<button key={day} disabled={isFut} onClick={()=>{setSelectedDate(ds);setShowCal(false);setTab("accueil");}}
                style={{ width:"100%", aspectRatio:"1", borderRadius:10, border:isSel?"2px solid #00C896":isTod?`2px solid ${OP_COLORS.MTN}`:`1px solid ${T.border}`, background:isSel?"#00C89620":isTod?"#FFB80015":T.hero, color:isFut?T.faint:isSel?"#00C896":T.text, fontWeight:isSel||isTod?800:500, fontSize:13, cursor:isFut?"not-allowed":"pointer", opacity:isFut?0.3:1 }}>
                {day}
              </button>);
            })}
          </div>
        </div>
      </div>)}

      {/* ══ CONFIRM SUPPRESSION ═════════════════════════════════════════ */}
      {confirm && (<div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:24 }}>
        <div style={{ background:T.card, borderRadius:20, padding:26, width:"100%", maxWidth:320, border:`1px solid ${T.border2}` }}>
          <div style={{ fontSize:18, fontWeight:900, marginBottom:8 }}>🗑️ Supprimer ?</div>
          <div style={{ fontSize:13, color:T.sub, marginBottom:22 }}>Cette opération sera effacée définitivement.</div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setConfirm(null)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
            <button onClick={()=>removeAgentTx(confirm)} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Supprimer</button>
          </div>
        </div>
      </div>)}

      {/* ══ CONFIRM SUPPRESSION AGENT (PATRON) ═══════════════════════════ */}
      {confirmDelAgent && (<div style={{ position:"fixed", inset:0, background:"#000D", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
        <div style={{ background:T.card, borderRadius:22, padding:28, width:"100%", maxWidth:340, border:"1px solid #E6394640", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
          <div style={{ fontSize:18, fontWeight:900, marginBottom:8, color:"#E63946" }}>Supprimer cet agent ?</div>
          <div style={{ background:T.hero, borderRadius:12, padding:"12px 16px", marginBottom:16, fontSize:13 }}>
            <strong>{confirmDelAgent.nom}</strong><br/>
            <span style={{ color:T.sub, fontSize:12 }}>+229 {confirmDelAgent.telephone}</span>
          </div>
          <div style={{ fontSize:12, color:T.sub, marginBottom:22, lineHeight:1.6 }}>
            Toutes ses opérations et données seront <strong style={{color:"#E63946"}}>définitivement supprimées</strong>.
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setConfirmDelAgent(null)} disabled={deletingAgent}
              style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
            <button disabled={deletingAgent} onClick={async()=>{
              setDeletingAgent(true);
              await deleteAgent(confirmDelAgent.id);
              setDeletingAgent(false);
              setConfirmDelAgent(null);
              loadPatronData();
            }} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:deletingAgent?"not-allowed":"pointer", opacity:deletingAgent?0.7:1 }}>
              {deletingAgent?"⏳ Suppression...":"Supprimer"}
            </button>
          </div>
        </div>
      </div>)}

      {/* ══ CALENDRIER PATRON ════════════════════════════════════════════ */}
      {showCal && isPatron && (<div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:300 }} onClick={()=>setShowCal(false)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:"22px 22px 0 0", padding:"20px 18px 36px", border:`1px solid ${T.border2}`, width:"100%" }}>
          <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
            <button onClick={()=>{if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>‹</button>
            <div style={{ fontWeight:800, fontSize:15 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
            <button onClick={()=>{if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:8 }}>
            {JOURS.map(j=>(<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"4px 0" }}>{j}</div>))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {Array(new Date(calYear,calMonth-1,1).getDay()).fill(null).map((_,i)=>(<div key={`e${i}`}/>))}
            {Array(new Date(calYear,calMonth,0).getDate()).fill(null).map((_,i)=>{
              const day=i+1, ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const isTod=ds===todayStr(), isSel=ds===selectedDate, isFut=ds>todayStr();
              return (<button key={day} disabled={isFut} onClick={()=>{ setSelectedDate(ds); setShowCal(false); }}
                style={{ width:"100%", aspectRatio:"1", borderRadius:10, border:isSel?"2px solid #00C896":isTod?`2px solid ${OP_COLORS.MTN}`:`1px solid ${T.border}`, background:isSel?"#00C89620":isTod?"#FFB80015":T.hero, color:isFut?T.faint:isSel?"#00C896":T.text, fontWeight:isSel||isTod?800:500, fontSize:13, cursor:isFut?"not-allowed":"pointer", opacity:isFut?0.3:1 }}>
                {day}
              </button>);
            })}
          </div>
          <button onClick={()=>{ setSelectedDate(todayStr()); setShowCal(false); }} style={{ width:"100%", marginTop:16, padding:12, borderRadius:12, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer" }}>
            📅 Aujourd'hui
          </button>
        </div>
      </div>)}

      {/* ══ CONFIRM DÉCONNEXION ═════════════════════════════════════════ */}
      {confirmLogout && (<div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
        <div style={{ background:T.card, borderRadius:22, padding:30, width:"100%", maxWidth:340, border:`1px solid ${T.border2}`, textAlign:"center" }}>
          <div style={{ fontSize:44, marginBottom:14 }}>🔓</div>
          <div style={{ fontSize:19, fontWeight:900, marginBottom:8 }}>Se déconnecter ?</div>
          <div style={{ fontSize:13, color:T.sub, marginBottom:26 }}>Tes données restent sauvegardées.</div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setConfirmLogout(false)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
            <button onClick={handleLogout} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Déconnexion</button>
          </div>
        </div>
      </div>)}

      {/* ══ MODAL CAPITAL CASH ══════════════════════════════════════════ */}
      {showCashModal && isAgent && (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowCashModal(false)}>
        <div style={{ background:T.card, borderRadius:20, padding:24, maxWidth:380, width:"100%", border:`1px solid #00C89640` }} onClick={e=>e.stopPropagation()}>
          <div style={{ fontWeight:900, fontSize:18, marginBottom:4 }}>💵 Capital Cash du matin</div>
          <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Argent liquide total commun (3 réseaux).</div>
          <input type="number" placeholder="Ex: 300000" value={cashInput} onChange={e=>setCashInput(e.target.value)} autoFocus
            style={{ width:"100%", background:T.input, border:"2px solid #00C896", borderRadius:12, padding:"16px", color:T.text, fontSize:22, fontWeight:900, outline:"none", boxSizing:"border-box", marginBottom:14, textAlign:"center" }} />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:18 }}>
            {[100000,200000,300000,500000].map(v=>(<button key={v} onClick={()=>setCashInput(String(v))} style={{ padding:"9px 0", borderRadius:9, border:"1px solid #00C89630", background:"#00C89612", color:"#00C896", fontWeight:700, fontSize:11, cursor:"pointer" }}>{v/1000}k</button>))}
          </div>
          <button onClick={()=>{ const val=Number(cashInput); if(!cashInput||isNaN(val)) return; const uid=agent.id||agent.telephone; lsSet(cashKey(selectedDate,uid),val); setCapitalCash(val); setShowCashModal(false); setCashInput(""); }}
            style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:15, cursor:"pointer" }}>
            ✅ Enregistrer
          </button>
        </div>
      </div>)}

      {/* ══ MODAL FLOAT ════════════════════════════════════════════════ */}
      {showFloatModal && isAgent && (<div style={{ position:"fixed", inset:0, background:"#000D", display:"flex", alignItems:"flex-end", zIndex:600 }} onClick={()=>setShowFloatModal(false)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:"22px 22px 0 0", padding:"22px 20px 40px", width:"100%", border:"1px solid #7B2FBE40" }}>
          <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
          <div style={{ fontWeight:900, fontSize:18, marginBottom:4 }}>💼 Solde de départ</div>
          <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Unités disponibles ce matin par opérateur.</div>
          {floatEditOp===null?(<div style={{ marginBottom:18 }}>
            <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:10 }}>CHOISIR UN OPÉRATEUR</div>
            <div style={{ display:"flex", gap:8 }}>
              {OPS.map(op=>(<button key={op} onClick={()=>{setFloatEditOp(op);setFloatInput(floats[op]!==null?String(floats[op]):"");}} style={{ flex:1, padding:"14px 0", borderRadius:12, border:`2px solid ${OP_COLORS[op]}50`, background:`${OP_COLORS[op]}18`, color:OP_COLORS[op], fontWeight:800, fontSize:13, cursor:"pointer" }}>{op}{floats[op]!==null&&<div style={{ fontSize:9, marginTop:3, opacity:0.8 }}>{fF(floats[op])}</div>}</button>))}
            </div>
          </div>):(
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
                <button onClick={()=>{setFloatEditOp(null);setFloatInput("");}} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:9, padding:"7px 12px", color:T.sub, fontSize:12, cursor:"pointer" }}>← Retour</button>
                <div style={{ fontWeight:800, fontSize:15, color:OP_COLORS[floatEditOp] }}>Solde {floatEditOp}</div>
              </div>
              <input type="number" placeholder="Ex : 150 000" value={floatInput} onChange={e=>setFloatInput(e.target.value)} autoFocus
                style={{ width:"100%", background:T.input, border:`2px solid ${OP_COLORS[floatEditOp]}`, borderRadius:12, padding:"16px", color:T.text, fontSize:22, fontWeight:800, outline:"none", boxSizing:"border-box", textAlign:"center", marginBottom:14 }} />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:18 }}>
                {[25000,50000,100000,200000].map(v=>(<button key={v} onClick={()=>setFloatInput(String(v))} style={{ padding:"9px 0", borderRadius:9, border:`1px solid ${OP_COLORS[floatEditOp]}30`, background:`${OP_COLORS[floatEditOp]}12`, color:OP_COLORS[floatEditOp], fontWeight:700, fontSize:11, cursor:"pointer" }}>{v/1000}k</button>))}
              </div>
              <button onClick={()=>{ if(!floatInput||isNaN(Number(floatInput))) return; saveAgentFloat(floatEditOp,floatInput); setFloatEditOp(null); setFloatInput(""); setShowFloatModal(false); }}
                style={{ width:"100%", padding:16, borderRadius:14, background:`linear-gradient(135deg,${OP_COLORS[floatEditOp]},${OP_COLORS[floatEditOp]}CC)`, border:"none", color:"#fff", fontWeight:900, fontSize:15, cursor:"pointer" }}>
                ✅ Enregistrer
              </button>
            </>
          )}
        </div>
      </div>)}

      {/* ══ MODAL MATIN ═════════════════════════════════════════════════ */}
      {showMorning && isAgent && (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
        <div style={{ background:T.card, borderRadius:22, padding:24, maxWidth:400, width:"100%", maxHeight:"92vh", overflowY:"auto", border:`1px solid ${T.border}` }}>
          <div style={{ textAlign:"center", marginBottom:22 }}>
            <div style={{ fontSize:34, marginBottom:8 }}>🌅</div>
            <div style={{ fontWeight:900, fontSize:20, color:T.text }}>Bonne journée, {agent.nom.split(" ")[0]} !</div>
            <div style={{ fontSize:13, color:T.sub, marginTop:6 }}>Entre tes fonds de départ</div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, color:"#00C896", marginBottom:6 }}>💵 ESPÈCES (commun 3 réseaux)</div>
            <input type="number" placeholder="Ex: 300000" value={morningInputs.cash} onChange={e=>setMorningInputs(p=>({...p,cash:e.target.value}))}
              style={{ width:"100%", background:T.input, border:"2px solid #00C89650", borderRadius:12, padding:"14px 16px", color:T.text, fontSize:16, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:16, marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, color:"#9B5FDE", marginBottom:14 }}>📱 SOLDES ÉLECTRONIQUES MOMO</div>
            {[["MTN","#FFB800"],["MOOV","#0066CC"],["Celtiis","#E63946"]].map(([op,col])=>(
              <div key={op} style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:800, color:col, marginBottom:6 }}>{op}</div>
                <input type="number" placeholder={`Solde ${op} du matin`} value={morningInputs[op]} onChange={e=>setMorningInputs(p=>({...p,[op]:e.target.value}))}
                  style={{ width:"100%", background:T.input, border:`2px solid ${col}50`, borderRadius:12, padding:"13px 16px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
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
            // ✅ Sauvegarder dans Supabase pour que le patron voie les données
            saveFloat({
              agent_id: agent.id,
              patron_id: agent.patron_id,
              date: todayStr(),
              cash: Number(morningInputs.cash)||0,
              float_mtn: nf.MTN,
              float_moov: nf.MOOV,
              float_celtiis: nf.Celtiis,
            });
            setShowMorning(false);
          }} style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", marginBottom:10 }}>
            ✅ Commencer la journée
          </button>
          <button onClick={()=>setShowMorning(false)} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>Passer — je remplirai plus tard</button>
        </div>
      </div>)}

    </div>
  </>);
}
