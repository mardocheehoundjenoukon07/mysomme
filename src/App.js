import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";

function H(patronId, agentId) {
  return {
    "apikey": SUPA_KEY,
    "Authorization": `Bearer ${SUPA_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...(patronId ? { "x-patron-id": patronId } : {}),
    ...(agentId  ? { "x-agent-id":  agentId  } : {}),
  };
}

// ─── OTP ──────────────────────────────────────────────────────────────────────
async function sendOTP(telephone) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPA_KEY}` },
      body: JSON.stringify({ telephone })
    });
    const data = await res.json();
    return res.ok ? { success: true } : { success: false, error: data.error || "Échec envoi SMS" };
  } catch { return { success: false, error: "Pas de connexion." }; }
}
async function verifyOTP(telephone, code) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPA_KEY}` },
      body: JSON.stringify({ telephone, code })
    });
    const data = await res.json();
    return res.ok ? { success: true } : { success: false, error: data.error || "Code incorrect" };
  } catch { return { success: false, error: "Pas de connexion." }; }
}

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const lsGet = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };

// ─── DATE ─────────────────────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function nowISO() {
  const d = new Date();
  const p = n => String(n).padStart(2,"0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = p(Math.floor(Math.abs(off)/60)), mm = p(Math.abs(off)%60);
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${hh}:${mm}`;
}

// ─── HASH PIN ─────────────────────────────────────────────────────────────────
async function hashPin(pin) {
  try {
    const buf = new TextEncoder().encode(pin);
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,"0")).join("");
  } catch { return pin; }
}

// ─── DÉTECTION OPÉRATEUR ──────────────────────────────────────────────────────
const PREFIXES_MTN     = ["42","46","50","51","52","53","54","56","57","59","61","62","66","67","69","90","91","96","97"];
const PREFIXES_MOOV    = ["45","55","58","60","63","64","65","68","94","95","98","99"];
const PREFIXES_CELTIIS = ["20","21","22","23","24","28","29","40","41","43","44","47","48","49","92","93"];
function detectOp(tel) {
  if (!tel || tel.length < 2) return null;
  const p = tel.slice(0,2);
  if (PREFIXES_MTN.includes(p))     return "MTN";
  if (PREFIXES_MOOV.includes(p))    return "MOOV";
  if (PREFIXES_CELTIIS.includes(p)) return "Celtiis";
  return null;
}

// ─── GRILLE COMMISSIONS RETRAIT ───────────────────────────────────────────────
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
  { min:500001,  max:1000000, MTN:5000, MOOV:5000, Celtiis:5000 },
];
function calcCom(op, montant) {
  const mt = Number(montant)||0;
  const t = GRILLE.find(t => mt>=t.min && mt<=t.max);
  return t ? (t[op]||0) : 0;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const OPS = ["MTN","MOOV","Celtiis"];
const OP_COLORS = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
const fF = n => Number(n||0).toLocaleString("fr-FR") + " F";
const PAYS = ["Bénin","Togo","Burkina Faso","Côte d'Ivoire","Sénégal"];

// ─── THÈMES ───────────────────────────────────────────────────────────────────
const DARK  = { bg:"#06080F", card:"#0C0F1A", border:"#181C2E", border2:"#1E2235", text:"#E8EAF0", sub:"#404560", faint:"#252840", hero:"#10131F", input:"#06080F", accent:"#00C896" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", accent:"#00C896" };

// ─── API SUPABASE ─────────────────────────────────────────────────────────────
async function fetchPatron(tel) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/patrons?telephone=eq.${tel}&select=*`, { headers: H(tel) });
    if (!r.ok) return null;
    const d = await r.json(); return d[0]||null;
  } catch { return null; }
}
async function savePatron(p) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/patrons`, { method:"POST", headers: H(), body: JSON.stringify(p) });
    if (r.ok) return { success:true, data:(await r.json())[0] };
    const err = await r.json().catch(()=>({}));
    return { success:false, error: err.message||err.details||`Erreur ${r.status}` };
  } catch(e) { return { success:false, error: e.message||"Connexion impossible" }; }
}
async function fetchAgents(patronId) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents?patron_id=eq.${patronId}&select=*&order=created_at.asc`, { headers: H(null, null) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchAgent(tel) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents?telephone=eq.${tel}&select=*`, { headers: H() });
    if (!r.ok) return null;
    const d = await r.json(); return d[0]||null;
  } catch { return null; }
}
async function saveAgent(a) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_agents`, { method:"POST", headers: H(), body: JSON.stringify(a) });
    return r.ok ? (await r.json())[0] : null;
  } catch { return null; }
}
async function generateInviteCode(patronId) {
  const code = Math.random().toString(36).substring(2,8).toUpperCase();
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/invitations`, {
      method:"POST", headers: H(),
      body: JSON.stringify({ code, patron_id: patronId })
    });
    return r.ok ? code : null;
  } catch { return null; }
}
async function fetchInviteCode(code) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/invitations?code=eq.${code}&used=eq.false&select=*`, { headers: H() });
    if (!r.ok) return null;
    const d = await r.json(); return d[0]||null;
  } catch { return null; }
}
async function markInviteUsed(code, agentId) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/invitations?code=eq.${code}`, {
      method:"PATCH", headers: H(), body: JSON.stringify({ used: true, used_by: agentId })
    });
  } catch {}
}
async function fetchTxs(agentId, dateStr) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?agent_id=eq.${agentId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`, { headers: H() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchAllFloatsForPatron(patronId, dateStr) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats?patron_id=eq.${patronId}&date=eq.${dateStr}&select=*`, { headers: H() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchAllTxsForPatron(patronId, dateStr) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?patron_id=eq.${patronId}&created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&order=created_at.desc`, { headers: H() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function saveTx(tx) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions`, { method:"POST", headers: H(), body: JSON.stringify(tx) });
    return r.ok ? (await r.json())[0] : null;
  } catch { return null; }
}
async function deleteTx(id) {
  try { await fetch(`${SUPA_URL}/rest/v1/cashpoint_transactions?id=eq.${id}`, { method:"DELETE", headers: H() }); } catch {}
}
async function fetchFloat(agentId, date) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats?agent_id=eq.${agentId}&date=eq.${date}&select=*`, { headers: H() });
    if (!r.ok) return null;
    const d = await r.json(); return d[0]||null;
  } catch { return null; }
}
async function saveFloat(f) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/cashpoint_floats`, {
      method:"POST",
      headers: { ...H(), "Prefer": "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(f)
    });
    return r.ok;
  } catch { return false; }
}

// ─── COMPOSANT PIN PAD ────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin, setPin] = useState("");
  const add = d => {
    if (pin.length >= 4) return;
    const p = pin + d; setPin(p);
    if (p.length === 4) setTimeout(() => { onSubmit(p); setPin(""); }, 140);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ fontSize:48, marginBottom:20 }}>🔐</div>
      <div style={{ fontWeight:900, fontSize:22, marginBottom:6, color:T.text, textAlign:"center" }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:32, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:16, marginBottom:32 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:18, height:18, borderRadius:"50%", background:pin.length>i?"#00C896":T.border2, border:`2px solid ${pin.length>i?"#00C896":T.border}`, transition:"all 0.15s" }} />
        ))}
      </div>
      {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"8px 20px", fontSize:12, fontWeight:700, marginBottom:20 }}>{error}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, width:"100%", maxWidth:270 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={() => d==="⌫" ? setPin(p=>p.slice(0,-1)) : d!==""?add(String(d)):null}
            style={{ height:60, borderRadius:14, border:`1px solid ${T.border}`, background:d===""?"transparent":T.card, color:T.text, fontSize:22, fontWeight:700, cursor:d===""?"default":"pointer" }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── COMPOSANT OTP ────────────────────────────────────────────────────────────
function OTPScreen({ telephone, onVerified, onBack, T }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [canResend, setCanResend] = useState(false);
  useEffect(() => { const t = setTimeout(()=>setCanResend(true), 30000); return ()=>clearTimeout(t); }, []);

  async function verify() {
    if (code.length !== 6) return;
    setLoading(true); setError("");
    const r = await verifyOTP(telephone, code);
    setLoading(false);
    if (r.success) onVerified();
    else setError(r.error);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:360 }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📱</div>
          <div style={{ fontWeight:900, fontSize:22, color:T.text, marginBottom:8 }}>Vérifie ton numéro</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>Code envoyé au<br/><strong style={{color:T.text}}>+229 {telephone}</strong></div>
        </div>
        <input type="tel" placeholder="_ _ _ _ _ _" maxLength={6} value={code}
          onChange={e=>{setCode(e.target.value.replace(/\D/g,"").slice(0,6));setError("");}}
          autoFocus
          style={{ width:"100%", background:T.input, border:`2px solid ${code.length===6?"#00C896":T.border}`, borderRadius:12, padding:"18px", color:T.text, fontSize:28, fontWeight:800, outline:"none", boxSizing:"border-box", textAlign:"center", letterSpacing:12, marginBottom:14 }} />
        {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
        <button onClick={verify} disabled={loading||code.length!==6}
          style={{ width:"100%", padding:16, borderRadius:12, background:code.length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:code.length===6?"#fff":T.sub, fontWeight:900, fontSize:15, cursor:code.length===6?"pointer":"not-allowed", marginBottom:14 }}>
          {loading?"⏳ Vérification...":"✅ Confirmer"}
        </button>
        <div style={{ textAlign:"center", fontSize:12, color:T.sub }}>
          {canResend ? <button onClick={async()=>{await sendOTP(telephone);setCanResend(false);setTimeout(()=>setCanResend(true),30000);}} style={{background:"none",border:"none",color:"#00C896",fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>Renvoyer le SMS</button>
          : "Tu pourras renvoyer dans 30 secondes"}
        </div>
        <button onClick={onBack} style={{ width:"100%", marginTop:16, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function CashPoint() {
  const [dark, setDark] = useState(true);
  const T = dark ? DARK : LIGHT;

  // ── Fix fond blanc ──────────────────────────────────────────────────────────
  useEffect(() => {
    const bg = dark ? "#06080F" : "#F0F2F8";
    document.documentElement.style.cssText = `margin:0!important;padding:0!important;background:${bg}!important;width:100%!important;`;
    document.body.style.cssText = `margin:0!important;padding:0!important;background:${bg}!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;`;
  }, [dark]);

  // Auth state
  const [userType, setUserType] = useState(null); // "patron" | "agent"
  const [patron, setPatron]     = useState(lsGet("cp_patron"));
  const [agent, setAgent]       = useState(lsGet("cp_agent"));
  const [locked, setLocked]     = useState(!!lsGet("cp_patron") || !!lsGet("cp_agent"));

  // UI state
  const [tab, setTab]           = useState("dashboard");
  const [loading, setLoading]   = useState(false);

  // Dashboard data
  const [agents, setAgents]         = useState([]);
  const [allTxs, setAllTxs]         = useState([]);
  const [allFloats, setAllFloats]   = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null); // agent detail view
  const [agentTxs, setAgentTxs]     = useState([]);
  const [agentFloat, setAgentFloat] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());

  // Modals
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState({});
  const [saving, setSaving]         = useState(false);
  const [inviteCode, setInviteCode] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [flash, setFlash]           = useState(null);
  const [showMorning, setShowMorning] = useState(false);
  const [morningForm, setMorningForm] = useState({ cash:"", mtn:"", moov:"", celtiis:"" });

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── CHARGEMENT DATA ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (patron && !locked) loadPatronData();
  }, [patron, locked, selectedDate]);

  useEffect(() => {
    if (agent && !locked) loadAgentData();
  }, [agent, locked, selectedDate]);

  async function loadPatronData() {
    setLoading(true);
    const ag = await fetchAgents(patron.id);
    setAgents(ag);
    const txs = await fetchAllTxsForPatron(patron.id, selectedDate);
    setAllTxs(txs);
    const fls = await fetchAllFloatsForPatron(patron.id, selectedDate);
    setAllFloats(fls);
    setLoading(false);
  }

  async function loadAgentData() {
    setLoading(true);
    const txs = await fetchTxs(agent.id, selectedDate);
    setAgentTxs(txs);
    const fl = await fetchFloat(agent.id, selectedDate);
    setAgentFloat(fl);
    if (!fl && selectedDate === todayStr()) setShowMorning(true);
    setLoading(false);
  }

  // ── DÉVERROUILLAGE PIN ───────────────────────────────────────────────────────
  async function handleUnlock(p) {
    const user = patron || agent;
    const pinHash = await hashPin(p);
    if (pinHash === user.pin) setLocked(false);
  }

  // ── AJOUTER TRANSACTION (AGENT) ──────────────────────────────────────────────
  async function addTx() {
    if (!form.operateur || !form.montant) return;
    setSaving(true);
    const com = modal === "retrait" ? calcCom(form.operateur, Number(form.montant)) : 0;
    const tx = {
      agent_id:   agent.id,
      patron_id:  agent.patron_id,
      type:       modal,
      operateur:  form.operateur,
      montant:    Number(form.montant),
      commission: com,
      telephone:  form.telephone ? `01${form.telephone}` : null,
      heure:      new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      created_at: nowISO()
    };
    const saved = await saveTx(tx);
    if (saved) setAgentTxs(p => [saved, ...p]);
    setSaving(false); setModal(null); setForm({});
    setFlash(modal); setTimeout(()=>setFlash(null), 2000);
  }

  // ── GÉNÉRER CODE INVITATION ──────────────────────────────────────────────────
  async function handleGenerateCode() {
    const code = await generateInviteCode(patron.id);
    setInviteCode(code);
  }

  // ── SAVE FLOAT MATIN ─────────────────────────────────────────────────────────
  async function handleSaveMorning() {
    await saveFloat({
      agent_id:     agent.id,
      patron_id:    agent.patron_id,
      date:         todayStr(),
      cash:         Number(morningForm.cash)||0,
      float_mtn:    Number(morningForm.mtn)||null,
      float_moov:   Number(morningForm.moov)||null,
      float_celtiis:Number(morningForm.celtiis)||null,
    });
    const fl = await fetchFloat(agent.id, todayStr());
    setAgentFloat(fl);
    setShowMorning(false);
  }

  // ── CALCULS DASHBOARD PATRON ─────────────────────────────────────────────────
  function getAgentStats(agentId) {
    const txs   = allTxs.filter(t => t.agent_id === agentId);
    const fl    = allFloats.find(f => f.agent_id === agentId) || null;
    const deps  = txs.filter(t=>t.type==="depot") .reduce((s,t)=>s+Number(t.montant),0);
    const rets  = txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    const frais = txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);

    // Cash actuel = cash départ + dépôts reçus - retraits donnés
    const cashDepart  = fl ? Number(fl.cash||0) : null;
    const cashActuel  = cashDepart !== null ? cashDepart + deps - rets : null;

    // Soldes MoMo actuels = solde départ - dépôts envoyés + retraits reçus
    const momoDepart  = fl ? (Number(fl.float_mtn||0) + Number(fl.float_moov||0) + Number(fl.float_celtiis||0)) : null;
    const mtnActuel   = fl ? Number(fl.float_mtn||0)     - txs.filter(t=>t.operateur==="MTN"    &&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0) + txs.filter(t=>t.operateur==="MTN"    &&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0) : null;
    const moovActuel  = fl ? Number(fl.float_moov||0)    - txs.filter(t=>t.operateur==="MOOV"   &&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0) + txs.filter(t=>t.operateur==="MOOV"   &&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0) : null;
    const celtiisActuel = fl ? Number(fl.float_celtiis||0) - txs.filter(t=>t.operateur==="Celtiis"&&t.type==="depot").reduce((s,t)=>s+Number(t.montant),0) + txs.filter(t=>t.operateur==="Celtiis"&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0) : null;
    const momoActuel  = (mtnActuel||0) + (moovActuel||0) + (celtiisActuel||0);

    // Point total = cash actuel + total MoMo actuel (sans frais)
    const pointTotal  = cashActuel !== null ? cashActuel + momoActuel : null;

    return {
      depots: deps, retraits: rets, fraisRetrait: frais,
      nbOps: txs.length, lastOp: txs[0]?.heure || null,
      cashDepart, cashActuel,
      mtnActuel, moovActuel, celtiisActuel, momoActuel,
      pointTotal, fl,
    };
  }

  // ── ÉCRANS AUTH ──────────────────────────────────────────────────────────────
  if (!patron && !agent) return <AuthScreen T={T} dark={dark} setDark={setDark} onPatronLogin={p=>{lsSet("cp_patron",p);setPatron(p);setLocked(false);setUserType("patron");}} onAgentLogin={a=>{lsSet("cp_agent",a);setAgent(a);setLocked(false);setUserType("agent");}} />;
  if (locked) return <PinPad title="Bon retour 👋" subtitle={`Content de te revoir, ${(patron||agent).nom.split(" ")[0]} !`} onSubmit={handleUnlock} T={T} />;

  const isPatron = !!patron;
  const isAgent  = !!agent;

  return (
    <div style={{ background:T.bg, minHeight:"100vh", color:T.text, fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}body{background:${T.bg}!important;}button{-webkit-tap-highlight-color:transparent;outline:none;}input{outline:none;}`}</style>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:flash==="depot"?"#00C896":"#4F8EF7", color:"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:9999, boxShadow:"0 4px 24px #0009" }}>
          ✅ {flash==="depot"?"Dépôt":"Retrait"} enregistré !
        </div>
      )}

      {/* HEADER */}
      <header style={{ background:T.card, padding:"14px 20px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#00C896,#00A5FF)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:16, color:"#fff" }}>C</div>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:T.text }}>CashPoint</div>
            <div style={{ fontSize:10, color:T.sub }}>{isPatron ? `👑 ${patron.nom_entreprise}` : `👷 ${agent.nom}`}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={()=>setDark(d=>!d)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:14, color:T.text }}>{dark?"☀️":"🌙"}</button>
        </div>
      </header>

      {/* CONTENU */}
      <main style={{ padding:"16px 16px 120px", maxWidth:520, margin:"0 auto" }}>

        {/* ══ DASHBOARD PATRON ══════════════════════════════════════ */}
        {isPatron && tab==="dashboard" && !selectedAgent && (
          <div>
            {/* ── HEADER ── */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:900, fontSize:20, color:T.text }}>📊 Tableau de bord</div>
                <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{todayStr()===selectedDate?"Aujourd'hui":"Données du "+new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</div>
              </div>
              <button onClick={loadPatronData} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 14px", color:T.sub, fontSize:12, cursor:"pointer" }}>🔄 Rafraîchir</button>
            </div>

            {/* ── RÉSUMÉ GLOBAL ── */}
            {(()=>{
              const totalCA      = allTxs.reduce((s,t)=>s+Number(t.montant),0);
              const totalFrais   = allTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
              const totalCashDep = allFloats.reduce((s,f)=>s+Number(f.cash||0),0);
              const totalOps     = allTxs.length;
              return (
                <div style={{ marginBottom:20 }}>
                  {/* CA + Frais */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                    <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${T.border}` }}>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>CHIFFRE D'AFFAIRES</div>
                      <div style={{ fontSize:22, fontWeight:900, color:"#00C896" }}>{fF(totalCA)}</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{totalOps} opérations</div>
                    </div>
                    <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${T.border}` }}>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>FRAIS DE RETRAIT</div>
                      <div style={{ fontSize:22, fontWeight:900, color:"#FFB800" }}>{fF(totalFrais)}</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>du jour</div>
                    </div>
                  </div>
                  {/* Cash total de départ */}
                  {totalCashDep > 0 && (
                    <div style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid #00C89630` }}>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:4, letterSpacing:1, fontWeight:700 }}>💵 CASH TOTAL DE DÉPART (tous agents)</div>
                      <div style={{ fontSize:20, fontWeight:900, color:"#00C896" }}>{fF(totalCashDep)}</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── AGENTS ── */}
            <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:12 }}>
              MES AGENTS — {agents.length} au total
            </div>

            {loading && <div style={{ textAlign:"center", color:T.sub, padding:32 }}>⏳ Chargement...</div>}

            {!loading && agents.length === 0 && (
              <div style={{ background:T.card, borderRadius:16, padding:32, textAlign:"center", border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:32, marginBottom:12 }}>👷</div>
                <div style={{ fontWeight:700, marginBottom:8 }}>Aucun agent encore</div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Génère un code d'invitation pour ajouter ton premier agent</div>
                <button onClick={()=>setTab("agents")} style={{ background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", borderRadius:12, padding:"12px 24px", color:"#fff", fontWeight:800, cursor:"pointer" }}>
                  ➕ Ajouter un agent
                </button>
              </div>
            )}

            {agents.map(ag => {
              const s = getAgentStats(ag.id);
              const actif = s.nbOps > 0;
              const cashColor = s.cashActuel === null ? T.sub : s.cashActuel < 0 ? "#E63946" : s.cashActuel/(s.cashDepart||1) < 0.2 ? "#FFB800" : "#00C896";
              return (
                <div key={ag.id}
                  onClick={()=>setSelectedAgent(ag)}
                  style={{ background:T.card, borderRadius:16, padding:16, marginBottom:12, border:`1px solid ${T.border}`, borderLeft:`3px solid ${actif?"#00C896":"#4A5060"}`, cursor:"pointer" }}>

                  {/* Nom + statut */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div>
                      <div style={{ fontWeight:800, fontSize:15 }}>👷 {ag.nom}</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{actif ? `🕐 Dernière op : ${s.lastOp}` : "Aucune opération aujourd'hui"}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ background:actif?"#00C89618":"#4A506020", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:actif?"#00C896":T.sub }}>
                        {actif ? "🟢 Actif" : "⚫ Inactif"}
                      </div>
                      <span style={{ color:T.sub, fontSize:16 }}>›</span>
                    </div>
                  </div>

                  {/* 2 lignes de chiffres */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:3, letterSpacing:0.5 }}>CA DU JOUR</div>
                      <div style={{ fontSize:15, fontWeight:900, color:"#00C896" }}>{fF(s.depots + s.retraits)}</div>
                    </div>
                    <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:T.sub, marginBottom:3, letterSpacing:0.5 }}>FRAIS DE RETRAIT</div>
                      <div style={{ fontSize:15, fontWeight:900, color:"#FFB800" }}>{fF(s.fraisRetrait)}</div>
                    </div>
                  </div>

                  {/* Cash restant + Point total */}
                  {s.cashActuel !== null && (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <div style={{ background:T.hero, borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, color:T.sub, marginBottom:3, letterSpacing:0.5 }}>💵 CASH EN SAC</div>
                        <div style={{ fontSize:15, fontWeight:900, color:cashColor }}>{fF(s.cashActuel)}</div>
                      </div>
                      <div style={{ background:"#00C89610", borderRadius:10, padding:"10px 12px", border:"1px solid #00C89625" }}>
                        <div style={{ fontSize:10, color:T.sub, marginBottom:3, letterSpacing:0.5 }}>📊 POINT TOTAL</div>
                        <div style={{ fontSize:15, fontWeight:900, color:"#00C896" }}>{fF(s.pointTotal)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ DETAIL AGENT (PATRON) ══════════════════════════════════ */}
        {isPatron && tab==="dashboard" && selectedAgent && (()=>{
          const ag = selectedAgent;
          const s  = getAgentStats(ag.id);
          const cashColor = s.cashActuel===null?T.sub:s.cashActuel<0?"#E63946":s.cashActuel/(s.cashDepart||1)<0.2?"#FFB800":"#00C896";
          const OP_COLORS_MAP = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
          const momoDetails = [
            { op:"MTN",     actuel:s.mtnActuel,     depart:s.fl?Number(s.fl.float_mtn||0):null },
            { op:"MOOV",    actuel:s.moovActuel,    depart:s.fl?Number(s.fl.float_moov||0):null },
            { op:"Celtiis", actuel:s.celtiisActuel, depart:s.fl?Number(s.fl.float_celtiis||0):null },
          ];
          return (
            <div>
              {/* Retour */}
              <button onClick={()=>setSelectedAgent(null)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 16px", color:T.text, fontSize:13, fontWeight:700, cursor:"pointer", marginBottom:20, display:"flex", alignItems:"center", gap:6 }}>
                ← Retour
              </button>

              {/* Nom agent */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div>
                  <div style={{ fontWeight:900, fontSize:20 }}>👷 {ag.nom}</div>
                  <div style={{ fontSize:12, color:T.sub, marginTop:3 }}>+229 {ag.telephone}</div>
                </div>
                <div style={{ background:s.nbOps>0?"#00C89618":"#4A506020", borderRadius:10, padding:"6px 14px", fontSize:12, fontWeight:800, color:s.nbOps>0?"#00C896":T.sub }}>
                  {s.nbOps>0?"🟢 Actif":"⚫ Inactif"}
                </div>
              </div>

              {/* 💵 Cash en sac */}
              <div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:12, border:`1px solid #00C89630` }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:12 }}>💵 ARGENT LIQUIDE (SAC)</div>
                {s.cashDepart === null ? (
                  <div style={{ color:T.faint, fontSize:13 }}>Cash de départ non renseigné</div>
                ) : (
                  <>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:11, color:T.sub }}>Départ</div>
                        <div style={{ fontSize:14, fontWeight:700, color:T.sub }}>{fF(s.cashDepart)}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:11, color:T.sub }}>Disponible maintenant</div>
                        <div style={{ fontSize:26, fontWeight:900, color:cashColor }}>{fF(s.cashActuel)}</div>
                      </div>
                    </div>
                    <div style={{ height:6, background:T.faint, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${Math.max(0,Math.min(100,s.cashActuel/(s.cashDepart||1)*100))}%`, background:cashColor, borderRadius:3 }} />
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:8 }}>
                      <div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89625", borderRadius:8, padding:"6px 10px", fontSize:11 }}>
                        <span style={{ color:T.sub }}>⬇️ Dépôts </span><span style={{ color:"#00C896", fontWeight:800 }}>+{fF(s.depots)}</span>
                      </div>
                      <div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394625", borderRadius:8, padding:"6px 10px", fontSize:11 }}>
                        <span style={{ color:T.sub }}>⬆️ Retraits </span><span style={{ color:"#E63946", fontWeight:800 }}>-{fF(s.retraits)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 📱 Comptes MoMo */}
              <div style={{ background:T.card, borderRadius:16, padding:18, marginBottom:12, border:`1px solid #7B2FBE30` }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:14 }}>📱 COMPTES MOMO</div>
                {momoDetails.map(({ op, actuel, depart }, i) => {
                  const col = OP_COLORS_MAP[op];
                  const pct = depart > 0 && actuel !== null ? Math.max(0, Math.min(100, actuel/depart*100)) : 0;
                  return (
                    <div key={op} style={{ marginBottom: i<2?14:0, paddingBottom:i<2?14:0, borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:30, height:30, borderRadius:8, background:`${col}18`, border:`1px solid ${col}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:900, color:col }}>{op}</div>
                          <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                        </div>
                        {actuel !== null
                          ? <div style={{ fontSize:16, fontWeight:900, color: actuel < 0 ? "#E63946" : actuel/(depart||1) < 0.15 ? "#FFB800" : "#00C896" }}>{fF(actuel)}</div>
                          : <div style={{ fontSize:12, color:T.faint }}>Non renseigné</div>
                        }
                      </div>
                      {depart !== null && depart > 0 && (
                        <div style={{ height:4, background:T.faint, borderRadius:2, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:2 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 📊 Point total */}
              <div style={{ background:"linear-gradient(135deg,#00C89615,#00A5FF10)", borderRadius:16, padding:18, marginBottom:12, border:"1px solid #00C89635" }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>📊 POINT TOTAL DU JOUR</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontSize:13, color:T.sub }}>Argent liquide</div>
                  <div style={{ fontSize:15, fontWeight:800, color:cashColor }}>{s.cashActuel!==null?fF(s.cashActuel):"—"}</div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontSize:13, color:T.sub }}>Total MoMo (MTN + MOOV + Celtiis)</div>
                  <div style={{ fontSize:15, fontWeight:800, color:"#9B5FDE" }}>{s.moovActuel!==null?fF(s.momoActuel):"—"}</div>
                </div>
                <div style={{ height:1, background:T.border, margin:"10px 0" }}/>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ fontSize:14, fontWeight:800 }}>TOTAL GÉNÉRAL</div>
                  <div style={{ fontSize:24, fontWeight:900, color:"#00C896" }}>{s.pointTotal!==null?fF(s.pointTotal):"—"}</div>
                </div>
              </div>

              {/* Bilan journée */}
              <div style={{ background:T.card, borderRadius:16, padding:18, border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:14 }}>📋 BILAN DE JOURNÉE</div>
                {[
                  ["CA total",         fF(s.depots+s.retraits), "#00C896"],
                  ["Dépôts",           `${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="depot").length} op · ${fF(s.depots)}`,  "#00C896"],
                  ["Retraits",         `${allTxs.filter(t=>t.agent_id===ag.id&&t.type==="retrait").length} op · ${fF(s.retraits)}`, "#4F8EF7"],
                  ["Frais de retrait", fF(s.fraisRetrait), "#FFB800"],
                ].map(([label, val, col]) => (
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ fontSize:13, color:T.sub }}>{label}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:col }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ══ GESTION AGENTS (PATRON) ════════════════════════════════ */}
        {isPatron && tab==="agents" && (
          <div>
            <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>👷 Mes agents ({agents.length}/10)</div>

            {/* Générer invitation */}
            <div style={{ background:T.card, borderRadius:16, padding:20, marginBottom:20, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>➕ Ajouter un agent</div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Génère un code unique que tu donnes à ton agent pour qu'il crée son compte.</div>
              {inviteCode ? (
                <div>
                  <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:12, padding:20, textAlign:"center", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:T.sub, marginBottom:6 }}>CODE D'INVITATION</div>
                    <div style={{ fontSize:36, fontWeight:900, color:"#00C896", letterSpacing:8 }}>{inviteCode}</div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:6 }}>Valable 7 jours · Usage unique</div>
                  </div>
                  <button onClick={()=>{navigator.clipboard?.writeText(inviteCode);}} style={{ width:"100%", padding:12, borderRadius:12, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:13, cursor:"pointer", marginBottom:8 }}>
                    📋 Copier le code
                  </button>
                  <button onClick={()=>setInviteCode(null)} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:12, cursor:"pointer" }}>
                    Générer un autre code
                  </button>
                </div>
              ) : (
                <button onClick={handleGenerateCode} disabled={agents.length>=10} style={{ width:"100%", padding:16, borderRadius:12, background:agents.length>=10?T.hero:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:agents.length>=10?T.sub:"#fff", fontWeight:800, fontSize:14, cursor:agents.length>=10?"not-allowed":"pointer" }}>
                  {agents.length>=10 ? "Maximum 10 agents atteint" : "🔑 Générer un code d'invitation"}
                </button>
              )}
            </div>

            {/* Liste agents */}
            {agents.map(ag => (
              <div key={ag.id} style={{ background:T.card, borderRadius:14, padding:16, marginBottom:10, border:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:700 }}>{ag.nom}</div>
                  <div style={{ fontSize:12, color:T.sub }}>+229 {ag.telephone}</div>
                </div>
                <div style={{ background:"#00C89618", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:"#00C896" }}>Actif</div>
              </div>
            ))}
          </div>
        )}

        {/* ══ ACCUEIL AGENT ════════════════════════════════════════ */}
        {isAgent && tab==="accueil" && (
          <div>
            <div style={{ fontWeight:900, fontSize:20, marginBottom:6 }}>Bonjour, {agent.nom.split(" ")[0]} 👋</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Aujourd'hui · {new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>

            {/* Float du matin */}
            {agentFloat && (
              <div style={{ background:T.card, borderRadius:14, padding:16, marginBottom:16, border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, marginBottom:10 }}>SOLDES DE DÉPART</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                  <div style={{ background:T.hero, borderRadius:10, padding:10 }}>
                    <div style={{ fontSize:10, color:T.sub }}>💵 CASH</div>
                    <div style={{ fontWeight:800, color:"#00C896" }}>{fF(agentFloat.cash)}</div>
                  </div>
                  {["mtn","moov","celtiis"].map(op => agentFloat[`float_${op}`] !== null && (
                    <div key={op} style={{ background:T.hero, borderRadius:10, padding:10 }}>
                      <div style={{ fontSize:10, color:OP_COLORS[op.charAt(0).toUpperCase()+op.slice(1)] || OP_COLORS.MTN }}>{op.toUpperCase()}</div>
                      <div style={{ fontWeight:800 }}>{fF(agentFloat[`float_${op}`])}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats du jour */}
            {(() => {
              const depots   = agentTxs.filter(t=>t.type==="depot").reduce((s,t)=>s+Number(t.montant),0);
              const retraits = agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
              const coms     = agentTxs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.commission),0);
              return (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:20 }}>
                  <div style={{ background:T.card, borderRadius:12, padding:14, border:`1px solid ${T.border}`, textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.sub }}>DÉPÔTS</div>
                    <div style={{ fontSize:16, fontWeight:900, color:"#00C896" }}>{agentTxs.filter(t=>t.type==="depot").length}</div>
                    <div style={{ fontSize:11, color:T.sub }}>{fF(depots)}</div>
                  </div>
                  <div style={{ background:T.card, borderRadius:12, padding:14, border:`1px solid ${T.border}`, textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.sub }}>RETRAITS</div>
                    <div style={{ fontSize:16, fontWeight:900, color:"#4F8EF7" }}>{agentTxs.filter(t=>t.type==="retrait").length}</div>
                    <div style={{ fontSize:11, color:T.sub }}>{fF(retraits)}</div>
                  </div>
                  <div style={{ background:T.card, borderRadius:12, padding:14, border:`1px solid ${T.border}`, textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.sub }}>COMMISSIONS</div>
                    <div style={{ fontSize:16, fontWeight:900, color:"#FFB800" }}>{fF(coms)}</div>
                    <div style={{ fontSize:10, color:T.sub }}>retraits</div>
                  </div>
                </div>
              );
            })()}

            {/* Historique */}
            <div style={{ background:T.card, borderRadius:14, padding:16, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>Opérations du jour</div>
              {agentTxs.length===0 && <div style={{ textAlign:"center", color:T.sub, padding:"24px 0", fontSize:13 }}>Aucune opération · Appuie sur ⬇️ ou ⬆️</div>}
              {agentTxs.map((t,i) => (
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:i<agentTxs.length-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:t.type==="depot"?"#00C89618":"#4F8EF718", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
                    {t.type==="depot"?"⬇️":"⬆️"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{t.type==="depot"?"Dépôt":"Retrait"} <span style={{color:OP_COLORS[t.operateur]}}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub }}>{t.telephone||"—"} · {t.heure}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:900, color:t.type==="depot"?"#00C896":"#4F8EF7" }}>{fF(t.montant)}</div>
                    {t.commission>0 && <div style={{ fontSize:11, color:"#FFB800" }}>+{fF(t.commission)}</div>}
                  </div>
                  <button onClick={()=>setConfirmDel(t.id)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", padding:"0 4px" }}>🗑️</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ PROFIL ═══════════════════════════════════════════════ */}
        {tab==="profil" && (
          <div>
            <div style={{ fontWeight:900, fontSize:20, marginBottom:20 }}>👤 Profil</div>
            <div style={{ background:T.card, borderRadius:16, padding:20, marginBottom:14, border:`1px solid ${T.border}` }}>
              {isPatron && <>
                <div style={{ fontSize:11, color:T.sub, marginBottom:12, fontWeight:700 }}>COMPTE PATRON</div>
                {[["👑 Nom",patron.nom],["📞 Téléphone",patron.telephone],["🏢 Entreprise",patron.nom_entreprise],["📋 RC",patron.registre_commerce],["🌍 Pays",patron.pays]].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ fontSize:13, color:T.sub }}>{l}</span>
                    <span style={{ fontSize:13, fontWeight:700 }}>{v}</span>
                  </div>
                ))}
              </>}
              {isAgent && <>
                <div style={{ fontSize:11, color:T.sub, marginBottom:12, fontWeight:700 }}>COMPTE AGENT</div>
                {[["👷 Nom",agent.nom],["📞 Téléphone",agent.telephone]].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ fontSize:13, color:T.sub }}>{l}</span>
                    <span style={{ fontSize:13, fontWeight:700 }}>{v}</span>
                  </div>
                ))}
              </>}
            </div>
            <button onClick={()=>{ lsDel("cp_patron"); lsDel("cp_agent"); setPatron(null); setAgent(null); setLocked(false); }}
              style={{ width:"100%", padding:16, borderRadius:14, background:"#E6394618", border:"2px solid #E6394640", color:"#E63946", fontWeight:800, fontSize:15, cursor:"pointer" }}>
              🔓 Se déconnecter
            </button>
          </div>
        )}
      </main>

      {/* ══ FABs AGENT ══════════════════════════════════════════════ */}
      {isAgent && tab==="accueil" && (
        <div style={{ position:"fixed", bottom:90, right:16, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
          <button onClick={()=>{setModal("retrait");setForm({});}}
            style={{ height:48, paddingLeft:16, paddingRight:18, borderRadius:24, background:"#4F8EF7", border:"none", color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 4px 18px #4F8EF760", display:"flex", alignItems:"center", gap:8 }}>
            <span>⬆️</span> Retrait
          </button>
          <button onClick={()=>{setModal("depot");setForm({});}}
            style={{ height:54, paddingLeft:18, paddingRight:20, borderRadius:27, background:"linear-gradient(135deg,#00C896,#009E78)", border:"none", color:"#fff", fontSize:14, fontWeight:900, cursor:"pointer", boxShadow:"0 6px 24px #00C89660", display:"flex", alignItems:"center", gap:8 }}>
            <span>⬇️</span> Dépôt
          </button>
        </div>
      )}

      {/* ══ BOTTOM NAV ══════════════════════════════════════════════ */}
      <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.card, borderTop:`1px solid ${T.border}`, zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-around", padding:"8px 0 12px", maxWidth:520, margin:"0 auto" }}>
          {isPatron && [["dashboard","📊","Dashboard"],["agents","👷","Agents"],["profil","👤","Profil"]].map(([key,icon,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.sub, fontSize:10, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"0 16px" }}>
              <span style={{ fontSize:22 }}>{icon}</span>{label}
              {tab===key && <div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
            </button>
          ))}
          {isAgent && [["accueil","🏠","Accueil"],["profil","👤","Profil"]].map(([key,icon,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.sub, fontSize:10, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"0 20px" }}>
              <span style={{ fontSize:22 }}>{icon}</span>{label}
              {tab===key && <div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
            </button>
          ))}
        </div>
      </nav>

      {/* ══ MODAL OPÉRATION AGENT ═══════════════════════════════════ */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:"100%", background:T.card, borderRadius:"22px 22px 0 0", padding:"16px 18px 48px", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />
            <div style={{ fontWeight:900, fontSize:18, marginBottom:18 }}>{modal==="depot"?"⬇️ Nouveau Dépôt":"⬆️ Nouveau Retrait"}</div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>MONTANT (FCFA)</div>
              <input type="number" placeholder="Ex : 5000" value={form.montant||""} onChange={e=>setForm(f=>({...f,montant:e.target.value}))}
                style={{ ...inp, fontSize:22, fontWeight:800, textAlign:"center" }} />
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>NUMÉRO CLIENT (optionnel)</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 10px", color:T.text, fontSize:13, fontWeight:800 }}>🇧🇯 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone||""}
                  onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,8); const op=detectOp(v); setForm(f=>({...f,telephone:v,operateur:op||f.operateur})); }}
                  style={{ ...inp, flex:1, border:`2px solid ${form.operateur?OP_COLORS[form.operateur]:T.border}` }} />
              </div>
            </div>

            <div style={{ marginBottom:22 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>RÉSEAU {form.operateur?"— 🔍 Détecté":"— Sélectionne"}</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPS.map(op => (
                  <button key={op} onClick={()=>setForm(f=>({...f,operateur:op}))}
                    style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?`${OP_COLORS[op]}20`:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                    {op}
                    {form.operateur===op && <div style={{fontSize:8,marginTop:2,color:OP_COLORS[op]}}>✓</div>}
                  </button>
                ))}
              </div>
            </div>

            {modal==="retrait" && form.montant && form.operateur && (
              <div style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between", marginBottom:16 }}>
                <span style={{ fontSize:12, color:T.sub }}>💰 Commission</span>
                <span style={{ fontWeight:900, color:"#00C896" }}>{fF(calcCom(form.operateur, Number(form.montant)))}</span>
              </div>
            )}

            <button onClick={addTx} disabled={saving || !form.operateur || !form.montant}
              style={{ width:"100%", padding:17, borderRadius:14, background:(!form.operateur||!form.montant)?T.hero:modal==="depot"?"#00C896":"#4F8EF7", border:"none", color:(!form.operateur||!form.montant)?T.sub:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
              {saving?"⏳ Sauvegarde…":"✅ Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL MATIN AGENT ═══════════════════════════════════════ */}
      {showMorning && (
        <div style={{ position:"fixed", inset:0, background:"#000E", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:16 }}>
          <div style={{ background:T.card, borderRadius:20, padding:24, width:"100%", maxWidth:400 }}>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>🌅</div>
              <div style={{ fontWeight:900, fontSize:18, color:T.text }}>Bonne journée, {agent.nom.split(" ")[0]} !</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:4 }}>Entre tes fonds de départ</div>
            </div>
            {[["cash","💵 Cash liquide","300000"],["mtn","📱 Float MTN","150000"],["moov","📱 Float MOOV","100000"],["celtiis","📱 Float Celtiis","50000"]].map(([k,label,ph])=>(
              <div key={k} style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:6, fontWeight:700 }}>{label}</div>
                <input type="number" placeholder={`Ex: ${ph}`} value={morningForm[k]} onChange={e=>setMorningForm(f=>({...f,[k]:e.target.value}))}
                  style={{ ...inp, fontSize:16, fontWeight:700 }} />
              </div>
            ))}
            <button onClick={handleSaveMorning} style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:15, cursor:"pointer", marginTop:8 }}>
              ✅ Commencer la journée
            </button>
            <button onClick={()=>setShowMorning(false)} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer", marginTop:8 }}>
              Passer — je remplirai plus tard
            </button>
          </div>
        </div>
      )}

      {/* ══ CONFIRM SUPPRESSION TX ══════════════════════════════════ */}
      {confirmDel && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
          <div style={{ background:T.card, borderRadius:20, padding:28, width:"100%", maxWidth:320, textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🗑️</div>
            <div style={{ fontWeight:900, fontSize:16, marginBottom:8 }}>Supprimer cette opération ?</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:24 }}>Cette action est irréversible.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirmDel(null)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={async()=>{ await deleteTx(confirmDel); setAgentTxs(p=>p.filter(t=>t.id!==confirmDel)); setConfirmDel(null); }} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ÉCRAN AUTH ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function AuthScreen({ T, dark, setDark, onPatronLogin, onAgentLogin }) {
  const [mode, setMode]   = useState("choose"); // choose | patron-register | patron-login | agent-register | agent-login
  const [step, setStep]   = useState(1);
  const [form, setForm]   = useState({ nom:"", telephone:"", entreprise:"", rc:"", pays:"Bénin", pin:"", code:"" });
  const [pin1, setPin1]   = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── PATRON INSCRIPTION ───────────────────────────────────────────
  async function handlePatronRegister() {
    if (!form.nom.trim()) { setError("Entre ton nom complet"); return; }
    if (!form.telephone || form.telephone.length !== 8) { setError("Entre les 8 chiffres de ton numéro"); return; }
    if (!form.entreprise.trim()) { setError("Entre le nom de ton entreprise"); return; }
    if (!form.rc.trim()) { setError("Entre ton numéro de registre de commerce"); return; }
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const existing = await fetchPatron(tel);
    if (existing) { setLoading(false); setError("Ce numéro a déjà un compte. Connecte-toi."); return; }
    const r = await sendOTP(tel);
    setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep(2);
  }

  async function handlePatronOTP() {
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const r = await verifyOTP(tel, form.otpCode);
    setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep(3);
  }

  async function handlePatronPinCreate(p) { setPin1(p); setStep(4); }

  async function handlePatronPinConfirm(p) {
    if (p !== pin1) { setError("Les codes PIN ne correspondent pas."); setStep(3); return; }
    setLoading(true);
    const pinHash = await hashPin(p);
    const tel = "01" + form.telephone;
    const patron = { telephone: tel, nom: form.nom.trim(), nom_entreprise: form.entreprise.trim(), registre_commerce: form.rc.trim(), pays: form.pays, pin: pinHash, phone_verified: true };
    const result = await savePatron(patron);
    setLoading(false);
    if (!result.success) { setError(`❌ ${result.error}`); setStep(3); return; }
    lsSet("cp_patron", { ...result.data, pin: pinHash });
    onPatronLogin({ ...result.data, pin: pinHash });
  }

  // ── PATRON CONNEXION ─────────────────────────────────────────────
  async function handlePatronLogin() {
    if (!form.telephone || form.telephone.length !== 8) { setError("Entre les 8 chiffres de ton numéro"); return; }
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const patron = await fetchPatron(tel);
    setLoading(false);
    if (!patron) { setError("Numéro introuvable. Crée un compte."); return; }
    lsSet("cp_patron", patron);
    setStep("patron-pin-login");
    setForm(f => ({...f, _patron: patron}));
  }

  async function handlePatronPinLogin(p) {
    const patron = form._patron || lsGet("cp_patron");
    const pinHash = await hashPin(p);
    if (pinHash === patron.pin) { onPatronLogin({ ...patron, pin: pinHash }); }
    else setError("Code PIN incorrect.");
  }

  // ── AGENT INSCRIPTION ────────────────────────────────────────────
  async function handleAgentRegister() {
    if (!form.code.trim()) { setError("Entre le code d'invitation"); return; }
    setLoading(true); setError("");
    const invite = await fetchInviteCode(form.code.trim().toUpperCase());
    setLoading(false);
    if (!invite) { setError("Code invalide ou expiré. Demande un nouveau code à ton patron."); return; }
    setForm(f => ({...f, _invite: invite}));
    setStep("agent-form");
  }

  async function handleAgentForm() {
    if (!form.nom.trim()) { setError("Entre ton nom complet"); return; }
    if (!form.telephone || form.telephone.length !== 8) { setError("Entre les 8 chiffres de ton numéro"); return; }
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const existing = await fetchAgent(tel);
    if (existing) { setLoading(false); setError("Ce numéro a déjà un compte."); return; }
    const r = await sendOTP(tel);
    setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep("agent-otp");
  }

  async function handleAgentOTP() {
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const r = await verifyOTP(tel, form.otpCode);
    setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setStep("agent-pin-create");
  }

  async function handleAgentPinCreate(p) { setPin1(p); setStep("agent-pin-confirm"); }

  async function handleAgentPinConfirm(p) {
    if (p !== pin1) { setError("Les codes PIN ne correspondent pas."); setStep("agent-pin-create"); return; }
    setLoading(true);
    const pinHash = await hashPin(p);
    const tel = "01" + form.telephone;
    const agentData = { telephone: tel, nom: form.nom.trim(), patron_id: form._invite.patron_id, pin: pinHash, phone_verified: true };
    const saved = await saveAgent(agentData);
    if (saved) await markInviteUsed(form.code.trim().toUpperCase(), saved.id);
    setLoading(false);
    if (!saved) { setError("Erreur. Réessaie."); return; }
    lsSet("cp_agent", { ...saved, pin: pinHash });
    onAgentLogin({ ...saved, pin: pinHash });
  }

  // ── AGENT CONNEXION ──────────────────────────────────────────────
  async function handleAgentLogin() {
    if (!form.telephone || form.telephone.length !== 8) { setError("Entre les 8 chiffres"); return; }
    const tel = "01" + form.telephone;
    setLoading(true); setError("");
    const ag = await fetchAgent(tel);
    setLoading(false);
    if (!ag) { setError("Numéro introuvable."); return; }
    lsSet("cp_agent", ag);
    setStep("agent-pin-login");
    setForm(f => ({...f, _agent: ag}));
  }

  async function handleAgentPinLogin(p) {
    const ag = form._agent || lsGet("cp_agent");
    const pinHash = await hashPin(p);
    if (pinHash === ag.pin) onAgentLogin({ ...ag, pin: pinHash });
    else setError("Code PIN incorrect.");
  }

  // ── ÉCRANS PIN ───────────────────────────────────────────────────
  if (step===3)                    return <PinPad title="Crée ton PIN 🔐" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handlePatronPinCreate} T={T} />;
  if (step===4)                    return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePatronPinConfirm} T={T} error={error} />;
  if (step==="patron-pin-login")   return <PinPad title="Bon retour 👋" subtitle="Entre ton code PIN" onSubmit={handlePatronPinLogin} T={T} error={error} />;
  if (step==="agent-pin-create")   return <PinPad title="Crée ton PIN 🔐" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handleAgentPinCreate} T={T} />;
  if (step==="agent-pin-confirm")  return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handleAgentPinConfirm} T={T} error={error} />;
  if (step==="agent-pin-login")    return <PinPad title="Bon retour 👋" subtitle="Entre ton code PIN" onSubmit={handleAgentPinLogin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:64, height:64, borderRadius:18, background:"linear-gradient(135deg,#00C896,#00A5FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, fontWeight:900, color:"#fff", margin:"0 auto 14px" }}>C</div>
          <div style={{ fontWeight:900, fontSize:28, color:T.text }}>CashPoint</div>
          <div style={{ fontSize:13, color:T.sub }}>Gestion POS pour les pros 🇧🇯</div>
        </div>

        {/* Choix initial */}
        {mode==="choose" && (
          <div>
            <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, textAlign:"center", marginBottom:16 }}>JE SUIS...</div>
            <button onClick={()=>{setMode("patron");setStep(1);setError("");}}
              style={{ width:"100%", padding:20, borderRadius:16, background:T.card, border:`2px solid #00C896`, color:T.text, fontWeight:800, fontSize:16, cursor:"pointer", marginBottom:12, display:"flex", alignItems:"center", gap:14 }}>
              <span style={{ fontSize:32 }}>👑</span>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontWeight:900 }}>Patron / Boss POS</div>
                <div style={{ fontSize:12, color:T.sub, fontWeight:400 }}>Je gère des agents et plusieurs points</div>
              </div>
            </button>
            <button onClick={()=>{setMode("agent");setStep("agent-code");setError("");}}
              style={{ width:"100%", padding:20, borderRadius:16, background:T.card, border:`2px solid #00A5FF`, color:T.text, fontWeight:800, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
              <span style={{ fontSize:32 }}>👷</span>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontWeight:900 }}>Agent / Staff</div>
                <div style={{ fontSize:12, color:T.sub, fontWeight:400 }}>J'ai un code d'invitation de mon patron</div>
              </div>
            </button>
            <button onClick={()=>setDark(d=>!d)} style={{ width:"100%", marginTop:20, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>
              {dark?"☀️ Mode clair":"🌙 Mode sombre"}
            </button>
          </div>
        )}

        {/* ═══ PATRON INSCRIPTION ═══ */}
        {mode==="patron" && step===1 && (
          <div>
            <div style={{ display:"flex", gap:8, background:T.hero, borderRadius:13, padding:4, marginBottom:24, border:`1px solid ${T.border}` }}>
              <button onClick={()=>{setMode("patron");setStep(1);}} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"linear-gradient(135deg,#00C896,#00A5FF)", color:"#fff", fontWeight:800, fontSize:13, cursor:"pointer" }}>Nouveau compte</button>
              <button onClick={()=>{setMode("patron-login");setStep("patron-login-form");}} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:"transparent", color:T.sub, fontWeight:700, fontSize:13, cursor:"pointer" }}>Se connecter</button>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NOM COMPLET</div>
              <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>NOM DE TON ENTREPRISE / POINT POS</div>
              <input type="text" placeholder="Ex : Point Cash Fidjrossè" value={form.entreprise} onChange={e=>setForm(f=>({...f,entreprise:e.target.value}))} style={inp} />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>NUMÉRO REGISTRE DE COMMERCE</div>
              <input type="text" placeholder="Ex : RB/COT/24/B/1234" value={form.rc} onChange={e=>setForm(f=>({...f,rc:e.target.value}))} style={inp} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>PAYS</div>
              <select value={form.pays} onChange={e=>setForm(f=>({...f,pays:e.target.value}))} style={{ ...inp, cursor:"pointer" }}>
                {PAYS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"10px 14px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
            <button onClick={handlePatronRegister} disabled={loading}
              style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", opacity:loading?0.7:1 }}>
              {loading?"⏳ Envoi du SMS...":"Recevoir mon code SMS →"}
            </button>
            <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
          </div>
        )}

        {/* OTP PATRON INSCRIPTION */}
        {mode==="patron" && step===2 && (
          <div>
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📱</div>
              <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Vérifie ton numéro</div>
              <div style={{ fontSize:13, color:T.sub }}>Code envoyé au <strong style={{color:T.text}}>+229 01{form.telephone}</strong></div>
            </div>
            <input type="tel" placeholder="_ _ _ _ _ _" maxLength={6} value={form.otpCode||""}
              onChange={e=>setForm(f=>({...f,otpCode:e.target.value.replace(/\D/g,"").slice(0,6)}))}
              autoFocus
              style={{ ...inp, fontSize:28, fontWeight:800, textAlign:"center", letterSpacing:12, marginBottom:14, border:`2px solid ${(form.otpCode||"").length===6?"#00C896":T.border}` }} />
            {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
            <button onClick={handlePatronOTP} disabled={loading||(form.otpCode||"").length!==6}
              style={{ width:"100%", padding:16, borderRadius:12, background:(form.otpCode||"").length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:(form.otpCode||"").length===6?"#fff":T.sub, fontWeight:900, fontSize:15, cursor:"pointer" }}>
              {loading?"⏳...":"✅ Confirmer"}
            </button>
            <button onClick={()=>setStep(1)} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
          </div>
        )}

        {/* ═══ PATRON CONNEXION ═══ */}
        {mode==="patron-login" && step==="patron-login-form" && (
          <div>
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
            <button onClick={handlePatronLogin} disabled={loading}
              style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
              {loading?"⏳...":"Continuer →"}
            </button>
            <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
          </div>
        )}

        {/* ═══ AGENT — CODE INVITATION ═══ */}
        {mode==="agent" && step==="agent-code" && (
          <div>
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <div style={{ fontSize:40, marginBottom:10 }}>🔑</div>
              <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Code d'invitation</div>
              <div style={{ fontSize:13, color:T.sub }}>Demande le code à ton patron pour rejoindre son équipe</div>
            </div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>CODE D'INVITATION (6 caractères)</div>
              <input type="text" placeholder="Ex : AB12CD" maxLength={6} value={form.code}
                onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))}
                autoFocus
                style={{ ...inp, fontSize:24, fontWeight:800, textAlign:"center", letterSpacing:8 }} />
            </div>
            {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
            <button onClick={handleAgentRegister} disabled={loading||form.code.length!==6}
              style={{ width:"100%", padding:17, borderRadius:14, background:form.code.length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:form.code.length===6?"#fff":T.sub, fontWeight:900, fontSize:16, cursor:"pointer", marginBottom:10 }}>
              {loading?"⏳ Vérification...":"Valider le code →"}
            </button>
            <div style={{ textAlign:"center", marginBottom:10 }}>
              <span style={{ fontSize:12, color:T.sub }}>Déjà un compte ? </span>
              <button onClick={()=>{setMode("agent-login");setStep("agent-login-form");}} style={{ background:"none", border:"none", color:"#00C896", fontSize:12, fontWeight:700, cursor:"pointer" }}>Se connecter</button>
            </div>
            <button onClick={()=>setMode("choose")} style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
          </div>
        )}

        {/* AGENT FORMULAIRE */}
        {mode==="agent" && step==="agent-form" && (
          <div>
            <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:12, padding:"12px 16px", marginBottom:20, fontSize:12, color:"#00C896", fontWeight:700, textAlign:"center" }}>
              ✅ Code valide ! Complète ton profil
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NOM COMPLET</div>
              <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700 }}>TON NUMÉRO</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ ...inp, width:"auto", flexShrink:0, padding:"14px 12px", fontWeight:800, fontSize:13 }}>🇧🇯 01</div>
                <input type="tel" placeholder="XX XX XX XX" maxLength={8} value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"").slice(0,8)}))} style={{...inp,flex:1}} />
              </div>
            </div>
            {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14 }}>{error}</div>}
            <button onClick={handleAgentForm} disabled={loading}
              style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
              {loading?"⏳ Envoi SMS...":"Recevoir mon code SMS →"}
            </button>
          </div>
        )}

        {/* AGENT OTP */}
        {mode==="agent" && step==="agent-otp" && (
          <div>
            <div style={{ textAlign:"center", marginBottom:28 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📱</div>
              <div style={{ fontWeight:900, fontSize:20, color:T.text, marginBottom:6 }}>Vérifie ton numéro</div>
              <div style={{ fontSize:13, color:T.sub }}>Code envoyé au <strong style={{color:T.text}}>+229 01{form.telephone}</strong></div>
            </div>
            <input type="tel" placeholder="_ _ _ _ _ _" maxLength={6} value={form.otpCode||""}
              onChange={e=>setForm(f=>({...f,otpCode:e.target.value.replace(/\D/g,"").slice(0,6)}))}
              autoFocus
              style={{ ...inp, fontSize:28, fontWeight:800, textAlign:"center", letterSpacing:12, marginBottom:14, border:`2px solid ${(form.otpCode||"").length===6?"#00C896":T.border}` }} />
            {error && <div style={{ background:"#E6394618", color:"#E63946", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700, marginBottom:14, textAlign:"center" }}>{error}</div>}
            <button onClick={handleAgentOTP} disabled={loading||(form.otpCode||"").length!==6}
              style={{ width:"100%", padding:16, borderRadius:12, background:(form.otpCode||"").length===6?"linear-gradient(135deg,#00C896,#00A5FF)":T.hero, border:"none", color:(form.otpCode||"").length===6?"#fff":T.sub, fontWeight:900, fontSize:15, cursor:"pointer" }}>
              {loading?"⏳...":"✅ Confirmer"}
            </button>
          </div>
        )}

        {/* ═══ AGENT CONNEXION ═══ */}
        {mode==="agent-login" && step==="agent-login-form" && (
          <div>
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
            <button onClick={handleAgentLogin} disabled={loading}
              style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer" }}>
              {loading?"⏳...":"Continuer →"}
            </button>
            <button onClick={()=>setMode("choose")} style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>← Retour</button>
          </div>
        )}

        {error && mode!=="patron" && mode!=="agent" && <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:14, fontWeight:700, background:"#E6394612", border:"1px solid #E6394630", borderRadius:10, padding:"10px 14px" }}>{error}</div>}
      </div>
    </div>
  );
}
