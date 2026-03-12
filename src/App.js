import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";
// Headers de base (sans agent)
const H = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };

// Headers avec identité agent — requis par le RLS Supabase
function HA(agentId) {
  return {
    ...H,
    "x-agent-id": agentId || ""
  };
}

// ─── CACHE LOCAL ──────────────────────────────────────────────────────────────
function lsGet(k)    { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function lsDel(k)    { try { localStorage.removeItem(k); } catch {} }

const txKey    = (date, uid) => `ms_txs_${uid}_${date}`;
const pendKey  = uid          => `ms_pend_${uid}`;
const floatKey = (date, uid) => `ms_float_${uid}_${date}`;

// ─── DATE LOCALE BÉNIN (UTC+1) ───────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function nowISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2,"0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = pad(Math.floor(Math.abs(off)/60)), mm = pad(Math.abs(off)%60);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

// ─── SÉCURITÉ : HASH PIN SHA-256 ─────────────────────────────────────────────
async function hashPin(pin) {
  try {
    const msgBuffer = new TextEncoder().encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2,"0")).join("");
  } catch {
    // Fallback si crypto.subtle non disponible
    return pin;
  }
}

// ─── API SUPABASE ─────────────────────────────────────────────────────────────
async function fetchTxsByDate(dateStr, userId) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&user_id=eq.${userId}&order=created_at.desc`, { headers: HA(userId) });
    if (res.ok) { const data = await res.json(); lsSet(txKey(dateStr, userId), data); return data; }
  } catch {}
  return lsGet(txKey(dateStr, userId)) || [];
}
async function saveTxRemote(tx) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions`, { method:"POST", headers:HA(tx.user_id), body:JSON.stringify(tx) });
    if (res.ok) return (await res.json())[0];
    console.error("Supabase error:", res.status, await res.text());
  } catch(e) { console.error(e); }
  return null;
}
async function deleteTx(id, userId) {
  try { await fetch(`${SUPA_URL}/rest/v1/transactions?id=eq.${id}`, { method:"DELETE", headers:HA(userId) }); } catch {}
}
async function fetchActiveDays(year, month, userId) {
  try {
    const from = `${year}-${String(month).padStart(2,"0")}-01`;
    const to   = `${year}-${String(month).padStart(2,"0")}-31`;
    const res  = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${from}T00:00:00+01:00&created_at=lte.${to}T23:59:59+01:00&user_id=eq.${userId}&select=created_at`, { headers:HA(userId) });
    if (!res.ok) return [];
    return [...new Set((await res.json()).map(t => t.created_at.slice(0,10)))];
  } catch { return []; }
}
async function saveAgent(agent) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents`, { method:"POST", headers:H, body:JSON.stringify(agent) });
    return res.ok ? (await res.json())[0] : null;
  } catch { return null; }
}
async function fetchAgent(telephone) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents?telephone=eq.${telephone}&select=*`, { headers:H });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}
async function updateAgent(telephone, fields) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents?telephone=eq.${telephone}`, {
      method:"PATCH", headers:HA(telephone), body:JSON.stringify(fields)
    });
    return res.ok;
  } catch { return false; }
}
async function flushPending(userId) {
  const pending = lsGet(pendKey(userId));
  if (!pending?.length) return [];
  const synced = [];
  for (const tx of pending) { const s = await saveTxRemote(tx); if (s) synced.push(tx.localId); }
  if (synced.length > 0) lsSet(pendKey(userId), pending.filter(t => !synced.includes(t.localId)));
  return synced;
}

// ─── OTP EMAIL VIA SUPABASE AUTH ──────────────────────────────────────────────
async function sendOTP(email) {
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/otp`, {
      method:"POST",
      headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true })
    });
    return res.ok;
  } catch { return false; }
}
async function verifyOTP(email, token) {
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/verify`, {
      method:"POST",
      headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type:"email", email, token })
    });
    return res.ok;
  } catch { return false; }
}

// ─── PARRAINAGE ───────────────────────────────────────────────────────────────
function getReferralLink(telephone) {
  return `https://monpoint.site?ref=${telephone}`;
}
function getRefFromURL() {
  try { return new URLSearchParams(window.location.search).get("ref") || null; }
  catch { return null; }
}
async function crediterParrain(telephoneParrain) {
  // Récupérer le parrain
  const parrain = await fetchAgent(telephoneParrain);
  if (!parrain) return;
  // Si parrain déjà étendu à 30j → ne pas re-créditer
  if (parrain.trial_extended) return;
  // Ajouter 16 jours et marquer comme étendu
  await updateAgent(telephoneParrain, {
    trial_days: (parrain.trial_days || 14) + 16,
    trial_extended: true,
    referral_count: (parrain.referral_count || 0) + 1
  });
}

// ─── TRIAL & ABONNEMENT ───────────────────────────────────────────────────────
function getTrialInfo(agent) {
  if (!agent) return { status:"expired", daysLeft:0 };
  const now = new Date();

  // Abonnement actif payant ?
  if (agent.subscription_status === "active" && agent.subscription_expires_at) {
    const exp = new Date(agent.subscription_expires_at);
    if (exp > now) {
      return { status:"subscribed", daysLeft: Math.ceil((exp-now)/(1000*60*60*24)) };
    }
  }

  // Période d'essai — limiter trial_days à 30 max pour éviter la triche
  const start     = new Date(agent.trial_start || agent.created_at);
  const rawDays   = Number(agent.trial_days) || 14;
  const totalDays = Math.min(rawDays, 30); // MAX 30 jours — impossible de tricher
  const elapsed   = Math.floor((now - start) / (1000*60*60*24));
  const daysLeft  = totalDays - elapsed;

  if (daysLeft > 0) return { status:"trial", daysLeft };
  return { status:"expired", daysLeft:0 };
}

async function activerAbonnement(telephone, fedapayId) {
  const exp = new Date();
  exp.setDate(exp.getDate() + 30);
  await updateAgent(telephone, {
    subscription_status: "active",
    subscription_expires_at: exp.toISOString()
  });
  // Sauvegarder dans la table abonnements
  try {
    await fetch(`${SUPA_URL}/rest/v1/abonnements`, {
      method:"POST", headers:HA(telephone),
      body:JSON.stringify({ agent_telephone:telephone, montant:1999, fedapay_id:fedapayId, statut:"paid", expire_at:exp.toISOString() })
    });
  } catch {}
}

// ─── GRILLE TARIFAIRE RETRAIT ─────────────────────────────────────────────────
const GRILLE_RETRAIT = [
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
function calcComRetrait(op, montant) {
  const mt = Number(montant)||0;
  const t  = GRILLE_RETRAIT.find(t => mt>=t.min && mt<=t.max);
  return t ? (t[op]||0) : 0;
}
function calcCom(type, op, montant) { return type==="retrait" ? calcComRetrait(op,montant) : 0; }
function getTranche(montant) { const mt=Number(montant)||0; return GRILLE_RETRAIT.find(t=>mt>=t.min&&mt<=t.max)||null; }

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const OPERATORS  = ["MTN","MOOV","Celtiis"];
const OP_COLORS  = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
const OP_BG_D    = { MTN:"#FFB80018", MOOV:"#0066CC18", Celtiis:"#E6394618" };
const OP_BG_L    = { MTN:"#FFB80028", MOOV:"#0066CC20", Celtiis:"#E6394620" };
const TYPE_COLOR = { depot:"#00C896", retrait:"#4F8EF7", forfait:"#9B5FDE" };
const TYPE_ICON  = { depot:"⬇️", retrait:"⬆️", forfait:"📦" };
const TYPE_LABEL = { depot:"Dépôt", retrait:"Retrait", forfait:"Forfait" };
const JOURS      = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR    = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const fF = n => Number(n||0).toLocaleString("fr-FR") + " F";

function getSalutation(nom) {
  const h = new Date().getHours();
  const g = h>=5&&h<12?"Bonjour":h>=12&&h<18?"Bon après-midi":"Bonsoir";
  return `${g}, ${(nom||"").split(" ")[0]} 👋`;
}

// ─── THÈMES ───────────────────────────────────────────────────────────────────
const DARK  = { bg:"#080A11", card:"#0F1118", border:"#1C1F2E", border2:"#22263A", text:"#E8EAF0", sub:"#4A5060", faint:"#2E3140", hero:"#151826", input:"#080A11", nav:"#0F1118", sidebar:"#0C0E17" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", nav:"#FFFFFF", sidebar:"#EAECF5" };

// ─── HOOK RESPONSIVE ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window!=="undefined"?window.innerWidth:375);
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "ms-reset";
    style.textContent = `
      *,*::before,*::after{box-sizing:border-box!important;margin:0;padding:0;}
      html,body{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;overflow-x:hidden!important;background:#080A11!important;}
      #root,[id^="react"],body>div{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;}
      button{-webkit-tap-highlight-color:transparent;outline:none;}
      input{-webkit-appearance:none;outline:none;}
    `;
    if (!document.getElementById("ms-reset")) document.head.appendChild(style);
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── COMPOSANT PIN ────────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error, blocked }) {
  const [pin, setPin] = useState("");
  const add = d => {
    if (blocked) return;
    if (pin.length >= 4) return;
    const p = pin + d; setPin(p);
    if (p.length === 4) setTimeout(() => { onSubmit(p); setPin(""); }, 140);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <svg width="54" height="54" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:22,filter:"drop-shadow(0 6px 24px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_pin)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_pin" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:6, textAlign:"center", color:T.text }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:36, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:18, marginBottom:36 }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:20, height:20, borderRadius:"50%", background:pin.length>i?"#00C896":T.border2, border:`2px solid ${pin.length>i?"#00C896":T.border}`, boxShadow:pin.length>i?"0 0 10px #00C89660":"none", transition:"all 0.15s" }} />
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

// ─── COMPOSANT INSCRIPTION / CONNEXION ───────────────────────────────────────
function Inscription({ onDone, T }) {
  const [mode,    setMode]    = useState("register");
  const [step,    setStep]    = useState(1); // 1=form, 2=otp, 3=pin, 4=confirm-pin
  const [form,    setForm]    = useState({ nom:"", telephone:"", email:"", reseau:"MTN" });
  const [otp,     setOtp]     = useState("");
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent,       setOtpSent]       = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [loginBlocked,  setLoginBlocked]  = useState(false);
  const w = useWindowWidth();

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── INSCRIPTION : envoi OTP ──
  async function handleRegisterStep1() {
    if (!form.nom||!form.telephone||!form.email) { setError("Remplis tous les champs"); return; }
    if (!form.email.includes("@")) { setError("Email invalide"); return; }
    setLoading(true); setError("");
    // Vérifier si numéro déjà existant
    const existing = await fetchAgent(form.telephone);
    if (existing) { setError("Ce numéro a déjà un compte. Connecte-toi."); setLoading(false); return; }
    // Envoyer OTP email
    const sent = await sendOTP(form.email);
    setLoading(false);
    if (!sent) { setError("Erreur d'envoi email. Vérifie ton adresse."); return; }
    setOtpSent(true); setStep(2);
  }

  // ── INSCRIPTION : vérification OTP ──
  async function handleVerifyOTP() {
    if (otp.length < 6) { setError("Le code fait 6 chiffres"); return; }
    setLoading(true); setError("");
    const ok = await verifyOTP(form.email, otp);
    setLoading(false);
    if (!ok) { setError("Code incorrect ou expiré. Réessaie."); return; }
    setStep(3); // PIN creation
  }

  // ── INSCRIPTION : création PIN ──
  function handlePinCreate(p) { setPin(p); setStep(4); }

  // ── INSCRIPTION : confirmation PIN → sauvegarder ──
  async function handlePinConfirm(p) {
    if (p !== pin) { setError("Les codes PIN ne correspondent pas."); setStep(3); setPin(""); return; }
    setLoading(true);
    const refCode = getRefFromURL();
    const pinHash = await hashPin(p);
    const agent = {
      nom: form.nom, telephone: form.telephone, email: form.email,
      reseau: form.reseau, pin: pinHash,
      referral_code: form.telephone,
      referred_by: refCode || null,
      referral_count: 0,
      trial_days: 14,
      trial_extended: false,
      subscription_status: "trial",
      created_at: nowISO(), trial_start: nowISO()
    };
    const saved = await saveAgent(agent);
    if (refCode) await crediterParrain(refCode);
    // Recharger depuis Supabase pour avoir les vraies données
    const fresh = await fetchAgent(agent.telephone);
    const trusted = fresh ? { ...fresh, pin: pinHash } : { ...(saved||agent), pin: pinHash };
    lsSet("ms_agent", trusted);
    onDone(trusted);
  }

  // ── CONNEXION ──
  async function handleLogin() {
    if (!form.telephone) { setError("Entre ton numéro"); return; }
    setLoading(true); setError("");
    const agent = await fetchAgent(form.telephone);
    setLoading(false);
    if (!agent) { setError("Numéro introuvable. Crée un compte."); return; }
    lsSet("ms_agent", agent);
    setStep(10);
  }
  async function handlePinLogin(p) {
    if (loginBlocked) {
      setError("🔒 Trop de tentatives. Réessaie dans 5 minutes.");
      return;
    }
    const agent = lsGet("ms_agent");
    const pinHash = await hashPin(p);
    if (pinHash === agent?.pin) {
      onDone(agent);
      setLoginAttempts(0);
    } else {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      if (newAttempts >= 3) {
        setLoginBlocked(true);
        setError("🔒 3 tentatives échouées — bloqué 5 minutes.");
        setTimeout(() => {
          setLoginBlocked(false);
          setLoginAttempts(0);
          setError("");
        }, 5 * 60 * 1000);
      } else {
        setError(`Code PIN incorrect. ${3 - newAttempts} tentative${3-newAttempts>1?"s":""} restante${3-newAttempts>1?"s":""}.`);
      }
    }
  }

  // ── Écrans PIN ──
  if (step===3) return <PinPad title="Crée ton PIN" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handlePinCreate} T={T} />;
  if (step===4) return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePinConfirm} T={T} error={error} />;
  if (step===10) return <PinPad title="Connexion 👋" subtitle="Entre ton code PIN" onSubmit={handlePinLogin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:w>=640?40:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:30 }}>
          <svg width="58" height="58" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:14,filter:"drop-shadow(0 6px 26px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_ins)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_ins" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
          <div style={{ fontWeight:900, fontSize:28, marginBottom:4, color:T.text }}>Mon Point</div>
          <div style={{ fontSize:13, color:T.sub, textAlign:"center" }}>
            {mode==="register" ? "Ton cahier MoMo numérique 🇧🇯" : "Reconnecte-toi à ton espace"}
          </div>
        </div>

        {/* Toggle */}
        <div style={{ display:"flex", background:T.hero, borderRadius:13, padding:4, marginBottom:26, border:`1px solid ${T.border}` }}>
          {[["register","Nouveau compte"],["login","Se connecter"]].map(([m,label])=>(
            <button key={m} onClick={()=>{setMode(m);setStep(1);setError("");setOtp("");}}
              style={{ flex:1, padding:"11px 0", borderRadius:10, border:"none", background:mode===m?"linear-gradient(135deg,#00C896,#00A5FF)":"transparent", color:mode===m?"#fff":T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ═══ FORMULAIRE INSCRIPTION ═══ */}
        {mode==="register" && step===1 && (<>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NOM COMPLET</div>
            <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO WHATSAPP</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
            </div>
          </div>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON EMAIL (pour recevoir le code OTP)</div>
            <input type="email" placeholder="Ex : koffi@gmail.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON RÉSEAU PRINCIPAL</div>
            <div style={{ display:"flex", gap:8 }}>
              {OPERATORS.map(op=>(
                <button key={op} onClick={()=>setForm(f=>({...f,reseau:op}))}
                  style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.reseau===op?OP_COLORS[op]:T.border}`, background:form.reseau===op?OP_BG_D[op]:"transparent", color:form.reseau===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                  {op}
                </button>
              ))}
            </div>
          </div>
          <div style={{ background:"#00C89612", border:"1px solid #00C89630", borderRadius:12, padding:"11px 16px", marginBottom:20, fontSize:12, color:"#00C896", textAlign:"center" }}>
            🎁 <strong>14 jours gratuits</strong> — aucune carte bancaire requise
          </div>
          {getRefFromURL() && (
            <div style={{ background:"#FFB80012", border:"1px solid #FFB80030", borderRadius:12, padding:"11px 16px", marginBottom:16, fontSize:12, color:"#FFB800", textAlign:"center" }}>
              🎉 Tu as été invité par un ami — profite de ton essai gratuit !
            </div>
          )}
          <button onClick={handleRegisterStep1} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Envoi du code...":"Commencer — Recevoir mon code →"}
          </button>
        </>)}

        {/* ═══ VÉRIFICATION OTP ═══ */}
        {mode==="register" && step===2 && (<>
          <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:14, padding:"16px 18px", marginBottom:22, textAlign:"center" }}>
            <div style={{ fontSize:20, marginBottom:8 }}>📧</div>
            <div style={{ fontWeight:800, fontSize:14, color:T.text, marginBottom:4 }}>Code envoyé à {form.email}</div>
            <div style={{ fontSize:12, color:T.sub }}>Vérifie ta boîte mail (et les spams) — valable 10 minutes</div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>ENTRE LE CODE À 6 CHIFFRES</div>
            <input
              type="number" placeholder="123456" value={otp} onChange={e=>setOtp(e.target.value.slice(0,6))}
              style={{ ...inp, fontSize:28, fontWeight:900, textAlign:"center", letterSpacing:8 }}
            />
          </div>
          <button onClick={handleVerifyOTP} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, marginBottom:12 }}>
            {loading?"⏳ Vérification...":"Valider le code ✓"}
          </button>
          <button onClick={()=>{setStep(1);setOtp("");setError("");}}
            style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>
            ← Modifier mon email
          </button>
        </>)}

        {/* ═══ FORMULAIRE CONNEXION ═══ */}
        {mode==="login" && step===1 && (<>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO DE TÉLÉPHONE</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Vérification...":"Continuer →"}
          </button>
        </>)}

        {error && <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:14, fontWeight:700, background:"#E6394612", border:"1px solid #E6394630", borderRadius:10, padding:"10px 14px" }}>{error}</div>}
      </div>
    </div>
  );
}

// ─── COMPOSANT MUR DE PAIEMENT ────────────────────────────────────────────────
const FEDAPAY_PAGE = "https://me.fedapay.com/46syFfak";

function PaymentWall({ agent, T, onPaid, onBack }) {
  const [checking, setChecking] = useState(false);

  // Quand l'agent revient sur l'app après paiement, on vérifie dans Supabase
  useEffect(() => {
    const onFocus = async () => {
      setChecking(true);
      // Recharger les données agent depuis Supabase
      const fresh = await fetchAgent(agent.telephone);
      if (fresh && fresh.subscription_status === "active") {
        lsSet("ms_agent", fresh);
        onPaid(fresh);
      }
      setChecking(false);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [agent]);

  function ouvrirPaiement() {
    // Ouvrir la page FedaPay dans un nouvel onglet
    window.open(FEDAPAY_PAGE, "_blank");
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:T.bg, padding:24 }}>
      <div style={{ width:"100%", maxWidth:380, textAlign:"center" }}>

        {onBack && (
          <div style={{ width:"100%", marginBottom:16, textAlign:"left" }}>
            <button onClick={onBack} style={{ background:"transparent", border:"none", color:T.sub, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              ← Retour
            </button>
          </div>
        )}

        <svg width="64" height="64" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{margin:"0 auto 20px",display:"block",filter:"drop-shadow(0 8px 30px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_pay)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_pay" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>

        <div style={{ background:"#E6394612", border:"2px solid #E6394640", borderRadius:18, padding:"22px 20px", marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⏰</div>
          <div style={{ fontWeight:900, fontSize:20, color:"#E63946", marginBottom:8 }}>Période d'essai terminée</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>
            Tes données sont en sécurité.<br/>Abonne-toi pour continuer à utiliser Mon Point.
          </div>
        </div>

        <div style={{ background:`linear-gradient(135deg,${T.hero},${T.card})`, border:"2px solid #00C89640", borderRadius:18, padding:"22px 20px", marginBottom:22 }}>
          <div style={{ fontSize:11, color:T.sub, marginBottom:6, letterSpacing:1, fontWeight:700 }}>ABONNEMENT MENSUEL</div>
          <div style={{ fontSize:46, fontWeight:900, color:"#00C896", letterSpacing:-2, marginBottom:4 }}>1 999 F</div>
          <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>par mois · 30 jours d'accès complet</div>
          {["✅ Tous tes retraits et dépôts","✅ Statistiques et historique complet","✅ Calcul automatique des commissions","✅ Rapport WhatsApp"].map(f=>(
            <div key={f} style={{ fontSize:13, color:T.text, textAlign:"left", marginBottom:6 }}>{f}</div>
          ))}
        </div>

        <button onClick={ouvrirPaiement}
          style={{ width:"100%", padding:18, borderRadius:16, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:17, cursor:"pointer", boxShadow:"0 6px 24px #00C89640", marginBottom:12 }}>
          💳 Payer 1 999 F et continuer →
        </button>

        {checking
          ? <div style={{ fontSize:13, color:"#00C896", fontWeight:700, padding:"12px 0" }}>⏳ Vérification du paiement...</div>
          : <button onClick={async () => {
              setChecking(true);
              const fresh = await fetchAgent(agent.telephone);
              if (fresh && fresh.subscription_status === "active") {
                lsSet("ms_agent", fresh);
                onPaid(fresh);
              } else {
                alert("Paiement non encore confirmé. Réessaie dans quelques secondes.");
              }
              setChecking(false);
            }}
            style={{ width:"100%", padding:13, borderRadius:13, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer", marginBottom:16 }}>
            🔄 J'ai déjà payé — Vérifier mon accès
          </button>
        }

        <div style={{ fontSize:11, color:T.sub, lineHeight:1.6 }}>
          Paiement sécurisé via FedaPay 🔒<br/>MTN MoMo · MOOV Money · Celtiis Cash
        </div>

        <div style={{ marginTop:20, background:"#FFB80010", border:"1px solid #FFB80030", borderRadius:14, padding:"14px 16px" }}>
          <div style={{ fontSize:12, color:"#FFB800", fontWeight:700, marginBottom:6 }}>💡 Pas encore prêt à payer ?</div>
          <div style={{ fontSize:11, color:T.sub, marginBottom:10 }}>Invite 1 ami avec ton lien → gagne <strong style={{color:"#FFB800"}}>+16 jours gratuits</strong> avant de payer.</div>
          <button onClick={()=>{ navigator.clipboard?.writeText(`https://monpoint.site?ref=${agent.telephone}`); alert("Lien copié !"); }}
            style={{ width:"100%", padding:"9px 0", borderRadius:10, background:"#FFB80020", border:"1px solid #FFB80050", color:"#FFB800", fontWeight:700, fontSize:12, cursor:"pointer" }}>
            📋 Copier mon lien de parrainage
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── SEO — BALISES META POUR GOOGLE ──────────────────────────────────────────
function injectSEO() {
  // Titre
  document.title = "Mon Point — Cahier numérique pour agents Mobile Money au Bénin";

  // Meta description
  let desc = document.querySelector('meta[name="description"]');
  if (!desc) { desc = document.createElement("meta"); desc.name = "description"; document.head.appendChild(desc); }
  desc.content = "Mon Point est l'app de gestion pour agents MoMo au Bénin. Enregistrez vos dépôts et retraits MTN, MOOV et Celtiis. Calcul automatique des commissions. Essai gratuit 14 jours.";

  // Keywords
  let kw = document.querySelector('meta[name="keywords"]');
  if (!kw) { kw = document.createElement("meta"); kw.name = "keywords"; document.head.appendChild(kw); }
  kw.content = "agent mobile money bénin, cahier momo bénin, gestion dépôt retrait, MTN MoMo, MOOV Money, Celtiis, application agent momo, mon point, monpoint.site";

  // Open Graph (WhatsApp / Facebook preview)
  const og = {
    "og:title":       "Mon Point — Cahier numérique MoMo Bénin",
    "og:description": "Gère tes dépôts et retraits MoMo facilement. Calcul automatique des commissions. Essai gratuit 14 jours.",
    "og:url":         "https://monpoint.site",
    "og:type":        "website",
    "og:image":       "https://monpoint.site/og-image.png",
  };
  Object.entries(og).forEach(([prop, content]) => {
    let tag = document.querySelector(`meta[property="${prop}"]`);
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute("property", prop); document.head.appendChild(tag); }
    tag.content = content;
  });

  // Canonical URL
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
  canonical.href = "https://monpoint.site";
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function MonPoint() {
  const [dark,          setDark]          = useState(true);
  const [agent,         setAgent]         = useState(null);
  const [locked,        setLocked]        = useState(false);
  const [pinErr,        setPinErr]        = useState("");
  const [pinAttempts,   setPinAttempts]   = useState(0);
  const [pinBlocked,    setPinBlocked]    = useState(false);
  const [pinBlockTime,  setPinBlockTime]  = useState(null);
  const [tab,           setTab]           = useState("accueil");
  const [modal,         setModal]         = useState(null);
  const [form,          setForm]          = useState({});
  const [txs,           setTxs]           = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [flash,         setFlash]         = useState(null);
  const [confirm,       setConfirm]       = useState(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [selectedDate,  setSelectedDate]  = useState(todayStr());
  const [calMonth,      setCalMonth]      = useState(new Date().getMonth()+1);
  const [calYear,       setCalYear]       = useState(new Date().getFullYear());
  const [activeDays,    setActiveDays]    = useState([]);
  const [showCal,       setShowCal]       = useState(false);
  const [pendingCount,  setPendingCount]  = useState(0);
  const [showPaywall,   setShowPaywall]   = useState(false);
  const [floats,        setFloats]        = useState({ MTN:null, MOOV:null, Celtiis:null });
  const [showFloatModal,setShowFloatModal]= useState(false);
  const [floatEditOp,   setFloatEditOp]  = useState(null);
  const [floatInput,    setFloatInput]   = useState("");

  const w       = useWindowWidth();
  const mobile  = w < 640;
  const tablet  = w >= 640 && w < 1024;
  const desktop = w >= 1024;
  const T       = dark ? DARK : LIGHT;
  const OP_BG   = dark ? OP_BG_D : OP_BG_L;
  const isToday = selectedDate === todayStr();

  const trialInfo = agent ? getTrialInfo(agent) : null;

  useEffect(() => { document.body.style.background = dark?"#080A11":"#F0F2F8"; }, [dark]);

  useEffect(() => {
    const saved = lsGet("ms_agent");

    // Détecter retour depuis FedaPay après paiement
    const params   = new URLSearchParams(window.location.search);
    const txStatus = params.get("status") || params.get("transaction_status");
    const txId     = params.get("transaction_id") || params.get("id") || "fedapay";
    const isPaid   = ["approved","completed","successful"].includes(txStatus);

    if (saved) {
      setAgent(saved);
      if (isPaid) {
        // Paiement confirmé — activer abonnement automatiquement
        activerAbonnement(saved.telephone, txId).then(() => {
          fetchAgent(saved.telephone).then(fresh => {
            if (fresh) {
              const trusted = { ...fresh, pin: saved.pin };
              lsSet("ms_agent", trusted);
              setAgent(trusted);
              setShowPaywall(false);
            }
          });
        });
        window.history.replaceState({}, "", window.location.pathname);
        setLocked(false);
      } else {
        setLocked(true);
        fetchAgent(saved.telephone).then(fresh => {
          if (fresh) {
            const trusted = { ...fresh, pin: saved.pin };
            lsSet("ms_agent", trusted);
            setAgent(trusted);
          }
        });
        const cached = lsGet(`ms_txs_${todayStr()}`);
        if (cached) setTxs(cached);
      }
    }
  }, []);

  // ── SEO Meta Tags ────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = "Mon Point — Cahier numérique pour agents Mobile Money au Bénin";
    const setMeta = (name, content, prop) => {
      const attr = prop ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("description", "Mon Point remplace le cahier papier des agents MoMo au Bénin. Enregistrez vos dépôts, retraits et commissions facilement. Essai gratuit 14 jours.");
    setMeta("keywords", "agent mobile money bénin, cahier numérique momo, gestion dépôt retrait momo, MTN momo bénin, application agent momo, mon point");
    setMeta("author", "Mon Point");
    setMeta("og:title", "Mon Point — Cahier numérique agents MoMo Bénin", null, true);
    setMeta("og:description", "Remplacez votre cahier papier. Gérez vos opérations MoMo facilement.", null, true);
    setMeta("og:url", "https://monpoint.site", null, true);
    setMeta("og:type", "website", null, true);
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", "Mon Point — Agents MoMo Bénin");
    setMeta("twitter:description", "Le cahier numérique des agents Mobile Money au Bénin.");
    // Canonical
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = "https://monpoint.site";

    // Favicon SVG — logo M avec point
    const faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
      <defs>
        <linearGradient id="fg" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#00C896"/>
          <stop offset="50%" stop-color="#00A5FF"/>
          <stop offset="100%" stop-color="#7B2FBE"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="48" height="48" rx="14" fill="url(#fg)"/>
      <path d="M11 37 L11 17 L26 29 L41 17 L41 37" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="26" cy="41" r="3.5" fill="white" opacity="0.95"/>
    </svg>`;

    const faviconUrl = "data:image/svg+xml," + encodeURIComponent(faviconSVG);

    // Supprimer les anciens favicons
    document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());

    // Ajouter le nouveau favicon
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.href = faviconUrl;
    document.head.appendChild(favicon);

    // Apple touch icon
    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    appleIcon.href = faviconUrl;
    document.head.appendChild(appleIcon);

    // Titre de l'onglet
    document.title = "Mon Point 💚";
  }, []);

  // ── Détection minuit — heure Bénin (UTC+1) ─────────────────────────────────
  useEffect(() => {
    if (!agent) return;
    let lastDay = todayStr();
    const interval = setInterval(() => {
      const currentDay = todayStr();
      if (currentDay !== lastDay) {
        lastDay = currentDay;
        setSelectedDate(currentDay);
        setTxs([]);
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [agent]);

  // Protection bouton retour
  useEffect(() => {
    window.history.pushState({ ms:true }, "");
    const onPop = () => {
      window.history.pushState({ ms:true }, "");
      setModal(null); setShowCal(false); setConfirm(null); setConfirmLogout(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (agent) {
      const pend = lsGet(pendKey(agent.telephone));
      setPendingCount(pend ? pend.length : 0);
    }
  }, [agent, txs]);

  useEffect(() => {
    if (!agent) return;
    const trySync = async () => {
      const synced = await flushPending(agent.telephone);
      if (synced.length > 0) { setPendingCount(0); loadTxs(selectedDate); }
    };
    window.addEventListener("online", trySync);
    trySync();
    return () => window.removeEventListener("online", trySync);
  }, [agent]);

  async function handleUnlock(pin) {
    // Vérifier si bloqué
    if (pinBlocked) {
      const now = Date.now();
      const diff = Math.ceil((pinBlockTime + 5*60*1000 - now) / 60000);
      setPinErr(`🔒 Compte bloqué. Réessaie dans ${diff} minute${diff>1?"s":""}.`);
      return;
    }
    const pinHash = await hashPin(pin);
    if (pinHash === agent.pin) {
      // Toujours recharger depuis Supabase — jamais faire confiance au localStorage
      fetchAgent(agent.telephone).then(fresh => {
        if (fresh) {
          // Garder seulement le PIN hashé du cache local (pas dans Supabase)
          const trusted = { ...fresh, pin: agent.pin };
          lsSet("ms_agent", trusted);
          setAgent(trusted);
        }
      });
      setLocked(false); setPinErr(""); setPinAttempts(0);
    } else {
      const newAttempts = pinAttempts + 1;
      setPinAttempts(newAttempts);
      if (newAttempts >= 3) {
        setPinBlocked(true);
        setPinBlockTime(Date.now());
        setPinErr("🔒 3 tentatives échouées — compte bloqué 5 minutes.");
        // Débloquer automatiquement après 5 minutes
        setTimeout(() => {
          setPinBlocked(false);
          setPinAttempts(0);
          setPinErr("");
        }, 5 * 60 * 1000);
      } else {
        setPinErr(`Code PIN incorrect. ${3 - newAttempts} tentative${3-newAttempts>1?"s":""} restante${3-newAttempts>1?"s":""}.`);
      }
    }
  }

  function handleLogout() {
    lsDel("ms_agent");
    setAgent(null); setLocked(false); setTxs([]); setTab("accueil"); setConfirmLogout(false);
  }

  const loadTxs = useCallback(async (date) => {
    if (!agent) return;
    const cached = lsGet(txKey(date, agent.telephone)) || [];
    if (cached.length > 0) { setTxs(cached); setLoading(false); }
    else setLoading(true);
    const fresh = await fetchTxsByDate(date, agent.telephone);
    setTxs(fresh.length > 0 ? fresh : cached);
    setLoading(false);
  }, [agent]);

  useEffect(() => { if (agent && !locked) loadTxs(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) loadFloats(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) fetchActiveDays(calYear, calMonth, agent.telephone).then(setActiveDays); }, [calMonth, calYear, agent, locked]);

  const sum      = f => txs.filter(f).reduce((s,t) => s+Number(t.montant),    0);
  const com      = f => txs.filter(f).reduce((s,t) => s+Number(t.commission), 0);
  const totalCA  = sum(()=>true);
  const totalCom = com(()=>true);

  async function addTx() {
    if (!form.operateur || !form.montant) return;
    setSaving(true);
    const localId = Date.now();
    const tx = {
      type:modal, operateur:form.operateur, montant:Number(form.montant),
      commission:calcCom(modal, form.operateur, Number(form.montant)),
      client:form.client||"Client", telephone:form.telephone||null,
      forfait:null, heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      user_id:agent.telephone, localId, created_at:nowISO()
    };
    const optimistic = { ...tx, id:localId };
    setTxs(p=>[optimistic,...p]);
    const saved = await saveTxRemote(tx);
    if (saved) { setTxs(p=>p.map(t=>t.id===localId?saved:t)); }
    else {
      const pend = lsGet(pendKey(agent.telephone))||[];
      lsSet(pendKey(agent.telephone), [...pend, tx]);
      setPendingCount(c=>c+1);
    }
    const cached = lsGet(txKey(selectedDate, agent.telephone))||[];
    lsSet(txKey(selectedDate, agent.telephone), [saved||optimistic, ...cached]);
    setSaving(false); setModal(null); setForm({});
    setFlash(modal); setTimeout(()=>setFlash(null), 2200);
    setTimeout(()=>loadTxs(selectedDate), 1200);
  }

  async function removeTx(id) {
    await deleteTx(id, agent.telephone);
    const updated = txs.filter(t=>t.id!==id);
    setTxs(updated);
    lsSet(txKey(selectedDate, agent.telephone), updated);
    setConfirm(null);
  }

  // ── FLOAT (UNITÉS) ──────────────────────────────────────────────────────────
  function loadFloats(date) {
    const stored = lsGet(floatKey(date, agent.telephone));
    setFloats(stored || { MTN:null, MOOV:null, Celtiis:null });
  }

  function saveFloat(op, solde) {
    const updated = { ...floats, [op]: Number(solde) };
    setFloats(updated);
    lsSet(floatKey(selectedDate, agent.telephone), updated);
  }

  function calcFloatActuel(op) {
    if (floats[op] === null || floats[op] === undefined) return null;
    const depots   = txs.filter(t=>t.operateur===op&&t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
    const retraits = txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    // Dépôt → agent envoie unités → float baisse
    // Retrait → agent reçoit unités → float monte
    return floats[op] - depots + retraits;
  }

  function getFloatColor(actuel, depart) {
    if (actuel === null || depart === null || depart === 0) return "#4A5060";
    const pct = actuel / depart;
    if (actuel < 0)   return "#E63946";
    if (pct < 0.15)   return "#E63946";
    if (pct < 0.35)   return "#FFB800";
    return "#00C896";
  }

  function getFloatLabel(actuel, depart) {
    if (actuel === null) return null;
    if (actuel < 0)     return "⚠️ Dépassé";
    const pct = depart > 0 ? actuel / depart : 1;
    if (pct < 0.15)     return "🔴 Critique";
    if (pct < 0.35)     return "🟡 Faible";
    return "🟢 OK";
  }

  function shareReport() {
    const dateLabel = new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    const forfaitsVendus = txs.filter(t=>t.type==="forfait");
    const internetCount = txs.filter(t=>t.type==="forfait"&&t.forfait==="internet").length;
    const appelCount    = txs.filter(t=>t.type==="forfait"&&t.forfait==="appel").length;
    const creditCount   = txs.filter(t=>t.type==="forfait"&&t.forfait==="simple").length;
    const forfaitLine   = forfaitsVendus.length > 0 ? `\n📦 Forfaits : ${forfaitsVendus.length} | 🌐 Internet: ${internetCount} | 📞 Appel: ${appelCount} | 📱 Simple: ${creditCount}\n💵 Total forfaits : ${fF(sum(t=>t.type==="forfait"))}` : "";
    const floatLines = OPERATORS.map(op => {
      const actuel = calcFloatActuel(op);
      if (actuel === null) return null;
      return `💼 Solde ${op} : ${fF(actuel)}`;
    }).filter(Boolean).join("\n");
    const text = `📊 *Point du jour — Mon Point*\n📅 ${dateLabel}\n👤 Agent : ${agent.nom}\n\n⬇️ Dépôts : ${fF(sum(t=>t.type==="depot"))}\n⬆️ Retraits : ${fF(sum(t=>t.type==="retrait"))}${forfaitLine}\n\n💰 *CA Total : ${fF(totalCA)}*\n✅ *Commission : ${fF(totalCom)}*${floatLines?"\n\n"+floatLines:""}\n\n_Généré par Mon Point_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  function getDaysInMonth(y,m) { return new Date(y,m,0).getDate(); }
  function getFirstDay(y,m)    { return new Date(y,m-1,1).getDay(); }
  function formatDateLabel(str) {
    if (str===todayStr()) return "Aujourd'hui";
    return new Date(str).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  }

  // ── Gardes ──────────────────────────────────────────────────────────────────
  if (!agent) return <Inscription onDone={a=>{setAgent(a);setLocked(false);}} T={T} />;
  if (locked) return <PinPad title="Bon retour 👋" subtitle={`Content de te revoir, ${agent.nom.split(" ")[0]} !`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  // ── Vérification trial ───────────────────────────────────────────────────────
  if (trialInfo?.status === "expired" || showPaywall) {
    return <PaymentWall agent={agent} T={T} onPaid={a=>{setAgent(a);lsSet("ms_agent",a);setShowPaywall(false);}} onBack={trialInfo?.status!=="expired"?()=>setShowPaywall(false):null} />;
  }

  const NAV_ITEMS = [
    ["accueil","🏠","Accueil"],
    ["stats","📊","Statistiques"],
    ["historique","🗂️","Historique"],
    ["profil","👤","Profil"],
  ];

  const modalWrap = desktop
    ? { position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:24 }
    : { position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:200 };
  const modalBox = desktop
    ? { background:T.card, borderRadius:20, padding:"26px 28px 30px", width:"100%", maxWidth:460, border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" }
    : { width:"100%", background:T.card, borderRadius:"22px 22px 0 0", padding:"16px 18px 48px", border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" };

  const contentPad = desktop?"24px 32px 48px":tablet?"20px 24px 140px":"16px 14px 140px";
  const mainLeft   = desktop ? 240 : 0;

  // ── Couleur bannière trial ───────────────────────────────────────────────────
  const trialColor  = trialInfo?.daysLeft <= 3 ? "#E63946" : trialInfo?.daysLeft <= 7 ? "#FFB800" : "#00C896";
  const trialBg     = trialInfo?.daysLeft <= 3 ? "#E6394612" : trialInfo?.daysLeft <= 7 ? "#FFB80012" : "#00C89612";

  return (<>
    <style>{`
      *,*::before,*::after{box-sizing:border-box!important;}
      html{margin:0!important;padding:0!important;background:${T.bg}!important;}
      body{margin:0!important;padding:0!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;background:${T.bg}!important;}
      #root,[data-reactroot],body>div{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;}
      button{-webkit-tap-highlight-color:transparent!important;}
    `}</style>

    <div style={{ background:T.bg, minHeight:"100vh", width:"100vw", maxWidth:"100%", margin:0, padding:0, color:T.text, fontFamily:"'Segoe UI',system-ui,sans-serif", position:"relative", overflowX:"hidden" }}>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash]||"#9B5FDE", color:"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:9999, boxShadow:"0 4px 24px #0009", whiteSpace:"nowrap" }}>
          ✅ {TYPE_LABEL[flash]||"Forfait"} enregistré !
        </div>
      )}


      {/* BADGE PENDING */}
      {pendingCount > 0 && (
        <div style={{ position:"fixed", bottom:mobile?80:88, left:12, background:"#FFB800", color:"#000", borderRadius:20, padding:"5px 11px", fontWeight:800, fontSize:11, zIndex:999, boxShadow:"0 2px 10px #FFB80060", pointerEvents:"none" }}>
          ⚡ {pendingCount} en attente
        </div>
      )}

      {/* ══ SIDEBAR DESKTOP ═════════════════════════════════════════════ */}
      {desktop && (
        <aside style={{ position:"fixed", top:0, left:0, width:240, height:"100vh", background:T.sidebar, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"22px 20px 20px", borderBottom:`1px solid ${T.border}` }}>
            <svg width="42" height="42" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_sb)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_sb" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:15 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>Agent mobile money 🇧🇯</div>
            </div>
          </div>

          {/* Bannière trial desktop */}
          {trialInfo?.status === "trial" && (
            <div style={{ margin:"12px 14px 0", background:trialBg, border:`1px solid ${trialColor}40`, borderRadius:11, padding:"10px 14px" }}>
              <div style={{ fontSize:11, color:trialColor, fontWeight:800 }}>
                ⏳ {trialInfo.daysLeft} jour{trialInfo.daysLeft>1?"s":""} d'essai restant{trialInfo.daysLeft>1?"s":""}
              </div>
              {!agent.trial_extended && (
                <div style={{ fontSize:10, color:T.sub, marginTop:3 }}>Invite 1 ami → +16 jours gratuits</div>
              )}
            </div>
          )}

          <div style={{ margin:"12px 14px 6px", background:T.card, borderRadius:13, padding:"12px 14px", border:`1px solid ${T.border}` }}>
            <div style={{ fontSize:11, color:T.sub }}>Connecté en tant que</div>
            <div style={{ fontWeight:800, fontSize:14 }}>{agent.nom}</div>
            <div style={{ fontSize:11, color:OP_COLORS[agent.reseau]||"#00C896", marginTop:2, fontWeight:700 }}>{agent.reseau} · +229 {agent.telephone}</div>
          </div>

          <nav style={{ flex:1, padding:"10px 12px" }}>
            {NAV_ITEMS.map(([key,icon,label])=>(
              <button key={key} onClick={()=>setTab(key)}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 14px", borderRadius:11, border:"none", background:tab===key?"#00C89618":"transparent", color:tab===key?"#00C896":T.sub, fontWeight:tab===key?800:500, fontSize:14, cursor:"pointer", marginBottom:4, textAlign:"left" }}>
                <span style={{ fontSize:18 }}>{icon}</span>{label}
                {tab===key && <div style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#00C896" }} />}
              </button>
            ))}
            {isToday && (
              <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, marginBottom:10, paddingLeft:4, letterSpacing:1 }}>NOUVELLE OPÉRATION</div>
                {[["depot","⬇️ Nouveau Dépôt","#00C896"],["retrait","⬆️ Nouveau Retrait","#4F8EF7"]].map(([type,label,color])=>(
                  <button key={type} onClick={()=>{setModal(type);setForm({});}}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:11, border:`1px solid ${color}40`, background:`${color}18`, color, fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:8 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </nav>

          <div style={{ padding:"14px 12px", borderTop:`1px solid ${T.border}` }}>
            <button onClick={()=>setConfirmLogout(true)}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"11px 14px", borderRadius:10, border:"none", background:"#E6394610", color:"#E63946", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              <span>🔓</span> Déconnexion
            </button>
          </div>
        </aside>
      )}

      {/* ══ HEADER MOBILE/TABLETTE ══════════════════════════════════════ */}
      {!desktop && (
        <header style={{ background:T.card, padding:tablet?"14px 22px":"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50, width:"100%" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad2)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad2" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:16 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Badge trial mobile */}
            {trialInfo?.status === "trial" && (
              <div style={{ background:trialBg, color:trialColor, borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:800, border:`1px solid ${trialColor}30` }}>
                ⏳ {trialInfo.daysLeft}j
              </div>
            )}
            {pendingCount > 0 && <div style={{ background:"#FFB80018", color:"#FFB800", borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:700 }}>⚡{pendingCount}</div>}
            <button onClick={()=>setShowCal(true)} style={{ background:dark?"#1C1F2E":"#E4E8F5", border:"none", borderRadius:10, padding:"8px 10px", cursor:"pointer", fontSize:18, lineHeight:1 }}>📅</button>
          </div>
        </header>
      )}

      {/* Salutation mobile */}
      {!desktop && tab==="accueil" && (
        <div style={{ padding:tablet?"20px 22px 0":"18px 16px 0" }}>
          <div style={{ fontWeight:900, fontSize:tablet?22:20, color:T.text }}>{getSalutation(agent.nom)}</div>
          <div style={{ fontSize:12, color:T.sub, marginTop:3 }}>
            {isToday?"Voici ton tableau de bord du jour":`Données du ${new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}`}
          </div>
        </div>
      )}

      {/* ══ HEADER DESKTOP ══════════════════════════════════════════════ */}
      {desktop && (
        <header style={{ position:"fixed", top:0, left:240, right:0, background:T.card, borderBottom:`1px solid ${T.border}`, padding:"14px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", zIndex:50 }}>
          <div>
            {tab==="accueil"
              ? <div style={{ fontWeight:900, fontSize:18 }}>{getSalutation(agent.nom)}</div>
              : <div style={{ fontWeight:900, fontSize:17 }}>{NAV_ITEMS.find(n=>n[0]===tab)?.[1]} {NAV_ITEMS.find(n=>n[0]===tab)?.[2]}</div>
            }
            <div style={{ fontSize:11, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
          </div>
          <button onClick={()=>setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:10, padding:"9px 16px", cursor:"pointer", fontSize:14, color:T.text, fontWeight:600, display:"flex", alignItems:"center", gap:7 }}>
            📅 Changer de date
          </button>
        </header>
      )}

      {/* ══ CONTENU ════════════════════════════════════════════════════ */}
      <main style={{ marginLeft:mainLeft, paddingTop:desktop?62:0, minHeight:"100vh" }}>
        <div style={{ maxWidth:desktop?860:tablet?720:"100%", margin:"0 auto", padding:contentPad }}>

          {/* Bannière trial mobile */}
          {trialInfo?.status === "trial" && !desktop && (
            <div style={{ background:trialBg, border:`1px solid ${trialColor}40`, borderRadius:12, padding:"10px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:trialColor }}>
                  ⏳ {trialInfo.daysLeft} jour{trialInfo.daysLeft>1?"s":""} d'essai restant{trialInfo.daysLeft>1?"s":""}
                </div>
                {!agent.trial_extended && <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Invite 1 ami pour +16 jours gratuits</div>}
              </div>
              {trialInfo.daysLeft <= 5 && (
                <button onClick={()=>setTab("profil")} style={{ background:trialColor, border:"none", borderRadius:9, padding:"7px 14px", color:"#fff", fontSize:11, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>
                  Voir offre
                </button>
              )}
            </div>
          )}

          {/* Bandeau date passée */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", borderRadius:12, padding:"10px 16px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          {/* ══ ACCUEIL ══ */}
          {tab==="accueil" && (<>

            {/* ══ CARTE SOLDE DE DÉPART ══ */}
            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #7B2FBE30` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>💼 Solde de départ</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Tes unités disponibles ce jour</div>
                </div>
                {isToday && (
                  <button onClick={()=>{setFloatEditOp(null);setFloatInput("");setShowFloatModal(true);}}
                    style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:9, padding:"6px 14px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>
                    ✏️ Modifier
                  </button>
                )}
              </div>

              {OPERATORS.map((op, i) => {
                const actuel = calcFloatActuel(op);
                const depart = floats[op];
                const color  = getFloatColor(actuel, depart);
                const label  = getFloatLabel(actuel, depart);
                const depots   = txs.filter(t=>t.operateur===op&&t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
                const retraits = txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
                const pct = depart > 0 && actuel !== null ? Math.max(0, Math.min(100, (actuel / depart) * 100)) : 0;
                return (
                  <div key={op} style={{ marginBottom: i < 2 ? 14 : 0, paddingBottom: i < 2 ? 14 : 0, borderBottom: i < 2 ? `1px solid ${T.border}` : "none" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: depart !== null ? 8 : 0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:34, height:34, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                          {depart !== null
                            ? <div style={{ fontSize:10, color:T.sub }}>Départ : {fF(depart)}</div>
                            : <div style={{ fontSize:10, color:T.faint }}>Non défini</div>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {actuel !== null ? (
                          <>
                            <div style={{ fontSize:17, fontWeight:900, color }}>{fF(actuel)}</div>
                            <div style={{ fontSize:10, fontWeight:700, color, marginTop:1 }}>{label}</div>
                          </>
                        ) : (
                          <button onClick={()=>{setFloatEditOp(op);setFloatInput("");setShowFloatModal(true);}}
                            style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:8, padding:"6px 12px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>
                            + Définir
                          </button>
                        )}
                      </div>
                    </div>
                    {depart !== null && actuel !== null && (
                      <div style={{ marginBottom:6 }}>
                        <div style={{ height:5, background:T.faint, borderRadius:3, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3, transition:"width 0.4s ease" }} />
                        </div>
                      </div>
                    )}
                    {depart !== null && (depots > 0 || retraits > 0) && (
                      <div style={{ display:"flex", gap:6, marginTop:4 }}>
                        {depots > 0 && <div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬇️ </span><span style={{ color:"#E63946", fontWeight:700 }}>-{fF(depots)}</span></div>}
                        {retraits > 0 && <div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬆️ </span><span style={{ color:"#00C896", fontWeight:700 }}>+{fF(retraits)}</span></div>}
                      </div>
                    )}
                    {actuel !== null && actuel < 5000 && actuel >= 0 && (
                      <div style={{ marginTop:6, background:"#E6394612", border:"1px solid #E6394635", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:700 }}>⚠️ Solde {op} bas — recharge tes unités !</div>
                    )}
                    {actuel !== null && actuel < 0 && (
                      <div style={{ marginTop:6, background:"#E6394620", border:"1px solid #E6394650", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:800 }}>🚨 Solde {op} dépassé de {fF(Math.abs(actuel))} !</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ══ VENTE UNITÉS — 3 TAPS ══ */}
            {isToday && (
            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #9B5FDE30` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>📦 Vente d'unités</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Enregistre en 3 taps</div>
                </div>
                <div style={{ fontSize:11, color:"#9B5FDE", fontWeight:700 }}>{txs.filter(t=>t.type==="forfait").length} vendu{txs.filter(t=>t.type==="forfait").length>1?"s":""}</div>
              </div>

              {/* Étape 1 — Type de forfait */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>1 — TYPE</div>
                <div style={{ display:"flex", gap:8 }}>
                  {[["internet","🌐","Internet"],["appel","📞","Appel"],["simple","📱","Simple"]].map(([k,ico,lbl])=>(
                    <button key={k} onClick={()=>setForm(f=>({...f, forfaitType:f.forfaitType===k?null:k, forfaitPrix:null}))}
                      style={{ flex:1, padding:"10px 4px", borderRadius:11, border:`2px solid ${form.forfaitType===k?"#9B5FDE":T.border}`, background:form.forfaitType===k?"#9B5FDE18":"transparent", color:form.forfaitType===k?"#9B5FDE":T.sub, fontWeight:800, fontSize:12, cursor:"pointer", textAlign:"center" }}>
                      <div style={{ fontSize:16 }}>{ico}</div>
                      <div style={{ marginTop:2 }}>{lbl}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Étape 2 — Opérateur */}
              {form.forfaitType && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>2 — RÉSEAU</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {OPERATORS.map(op=>(
                      <button key={op} onClick={()=>setForm(f=>({...f, forfaitOp:f.forfaitOp===op?null:op, forfaitPrix:null}))}
                        style={{ flex:1, padding:"10px 0", borderRadius:11, border:`2px solid ${form.forfaitOp===op?OP_COLORS[op]:T.border}`, background:form.forfaitOp===op?OP_BG[op]:"transparent", color:form.forfaitOp===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                        {op}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Étape 3 — Prix */}
              {form.forfaitType && form.forfaitOp && (()=>{
                const GRILLES = {
                  MTN: {
                    internet:[100,300,500,1000,2000,3500,6000,15100,20000,25000,30000,50000,75000,100000],
                    appel:   [100,150,200,300,500,1000,1500,2500,5000],
                    credit:  [100,200,500,1000,2000,5000,10000],
                  },
                  MOOV: {
                    internet:[200,500,1000,2000,4500,8000,15000,15500,20000,50000],
                    appel:   [100,200,500,1000,2500,5000],
                    credit:  [100,200,500,1000,2000,5000],
                  },
                  Celtiis: {
                    internet:[1000,3000,5000,10000,20000],
                    appel:   [100,150,200,500,1500,3000,5000,10000],
                    credit:  [200,500,1000,2000,5000],
                  },
                };
                const prix = GRILLES[form.forfaitOp]?.[form.forfaitType] || [];
                return (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>3 — MONTANT</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {prix.map(p=>(
                        <button key={p} onClick={()=>setForm(f=>({...f, forfaitPrix:p}))}
                          style={{ padding:"7px 12px", borderRadius:9, border:`2px solid ${form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.border}`, background:form.forfaitPrix===p?OP_BG[form.forfaitOp]:"transparent", color:form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.sub, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                          {p>=1000?(p/1000)+"k":p} F
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Bouton enregistrer forfait */}
              {form.forfaitType && form.forfaitOp && form.forfaitPrix && (
                <button onClick={async ()=>{
                  setSaving(true);
                  const localId = Date.now();
                  const typeLabels = {internet:"🌐 Internet",appel:"📞 Appel",credit:"📱 Simple"};
                  const tx = {
                    type:"forfait", operateur:form.forfaitOp,
                    montant:Number(form.forfaitPrix), commission:0,
                    client:typeLabels[form.forfaitType]||"Forfait",
                    telephone:null, forfait:form.forfaitType,
                    heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
                    user_id:agent.telephone, localId, created_at:nowISO()
                  };
                  const optimistic = {...tx, id:localId};
                  setTxs(p=>[optimistic,...p]);
                  const saved = await saveTxRemote(tx);
                  if(saved){setTxs(p=>p.map(t=>t.id===localId?saved:t));}
                  else{const pend=lsGet(pendKey(agent.telephone))||[];lsSet(pendKey(agent.telephone),[...pend,tx]);setPendingCount(c=>c+1);}
                  const cached=lsGet(txKey(selectedDate,agent.telephone))||[];
                  lsSet(txKey(selectedDate,agent.telephone),[saved||optimistic,...cached]);
                  setSaving(false); setForm({}); setFlash("forfait"); setTimeout(()=>setFlash(null),2200);
                  setTimeout(()=>loadTxs(selectedDate),1200);
                }} disabled={saving}
                  style={{ width:"100%", padding:14, borderRadius:12, background:saving?"#1A1D2E":"linear-gradient(135deg,#9B5FDE,#7B2FBE)", border:"none", color:saving?T.sub:"#fff", fontWeight:900, fontSize:14, cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {saving?"⏳ Sauvegarde…":`✅ Enregistrer — ${form.forfaitOp} ${form.forfaitType} ${fF(form.forfaitPrix)}`}
                </button>
              )}
            </div>
            )}

            <button onClick={shareReport} style={{ width:"100%", padding:16, borderRadius:16, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>📤</span> Envoyer le point du jour sur WhatsApp
            </button>

            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid ${T.border}` }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:16 }}>Par opérateur</div>
              {OPERATORS.map((op,i)=>{
                const o = txs.filter(t=>t.operateur===op);
                return (
                  <div key={op} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                    <div style={{ width:36, height:36, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                      <div style={{ fontSize:11, color:T.sub }}>{o.length} opération{o.length>1?"s":""}</div>
                    </div>
                    <div style={{ fontWeight:900, color:OP_COLORS[op], fontSize:15 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</div>
                  </div>
                );
              })}
            </div>

           

            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:16 }}>Dernières opérations</div>
              {loading && <div style={{ textAlign:"center", color:T.faint, padding:"24px 0", fontSize:13 }}>⏳ Chargement…</div>}
              {!loading && txs.length===0 && <div style={{ textAlign:"center", color:T.faint, padding:"32px 0", fontSize:13 }}>{isToday?"Aucune opération · Appuie sur ⬇️ ou ⬆️":"Aucune opération ce jour"}</div>}
              {txs.slice(0,6).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:i<Math.min(txs.length,8)-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ width:38, height:38, borderRadius:11, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                    <div style={{ fontSize:11, color:T.sub }}>{t.heure||""}</div>
                  </div>
                  {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:15, flexShrink:0, padding:"0 4px" }}>🗑️</button>}
                </div>
              ))}
            </div>
          </>)}

          {/* ══ STATS ══ */}
          {tab==="stats" && (
            <div>
              <div style={{ fontWeight:900, fontSize:desktop?20:18, marginBottom:20 }}>📊 Statistiques</div>
              t { useState, useEffect, useCallback } from "react";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";
// Headers de base (sans agent)
const H = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };

// Headers avec identité agent — requis par le RLS Supabase
function HA(agentId) {
  return {
    ...H,
    "x-agent-id": agentId || ""
  };
}

// ─── CACHE LOCAL ──────────────────────────────────────────────────────────────
function lsGet(k)    { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function lsDel(k)    { try { localStorage.removeItem(k); } catch {} }

const txKey    = (date, uid) => `ms_txs_${uid}_${date}`;
const pendKey  = uid          => `ms_pend_${uid}`;
const floatKey = (date, uid) => `ms_float_${uid}_${date}`;

// ─── DATE LOCALE BÉNIN (UTC+1) ───────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function nowISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2,"0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = pad(Math.floor(Math.abs(off)/60)), mm = pad(Math.abs(off)%60);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

// ─── SÉCURITÉ : HASH PIN SHA-256 ─────────────────────────────────────────────
async function hashPin(pin) {
  try {
    const msgBuffer = new TextEncoder().encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2,"0")).join("");
  } catch {
    // Fallback si crypto.subtle non disponible
    return pin;
  }
}

// ─── API SUPABASE ─────────────────────────────────────────────────────────────
async function fetchTxsByDate(dateStr, userId) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${dateStr}T00:00:00+01:00&created_at=lte.${dateStr}T23:59:59+01:00&user_id=eq.${userId}&order=created_at.desc`, { headers: HA(userId) });
    if (res.ok) { const data = await res.json(); lsSet(txKey(dateStr, userId), data); return data; }
  } catch {}
  return lsGet(txKey(dateStr, userId)) || [];
}
async function saveTxRemote(tx) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions`, { method:"POST", headers:HA(tx.user_id), body:JSON.stringify(tx) });
    if (res.ok) return (await res.json())[0];
    console.error("Supabase error:", res.status, await res.text());
  } catch(e) { console.error(e); }
  return null;
}
async function deleteTx(id, userId) {
  try { await fetch(`${SUPA_URL}/rest/v1/transactions?id=eq.${id}`, { method:"DELETE", headers:HA(userId) }); } catch {}
}
async function fetchActiveDays(year, month, userId) {
  try {
    const from = `${year}-${String(month).padStart(2,"0")}-01`;
    const to   = `${year}-${String(month).padStart(2,"0")}-31`;
    const res  = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${from}T00:00:00+01:00&created_at=lte.${to}T23:59:59+01:00&user_id=eq.${userId}&select=created_at`, { headers:HA(userId) });
    if (!res.ok) return [];
    return [...new Set((await res.json()).map(t => t.created_at.slice(0,10)))];
  } catch { return []; }
}
async function saveAgent(agent) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents`, { method:"POST", headers:H, body:JSON.stringify(agent) });
    return res.ok ? (await res.json())[0] : null;
  } catch { return null; }
}
async function fetchAgent(telephone) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents?telephone=eq.${telephone}&select=*`, { headers:H });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}
async function updateAgent(telephone, fields) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents?telephone=eq.${telephone}`, {
      method:"PATCH", headers:HA(telephone), body:JSON.stringify(fields)
    });
    return res.ok;
  } catch { return false; }
}
async function flushPending(userId) {
  const pending = lsGet(pendKey(userId));
  if (!pending?.length) return [];
  const synced = [];
  for (const tx of pending) { const s = await saveTxRemote(tx); if (s) synced.push(tx.localId); }
  if (synced.length > 0) lsSet(pendKey(userId), pending.filter(t => !synced.includes(t.localId)));
  return synced;
}

// ─── OTP EMAIL VIA SUPABASE AUTH ──────────────────────────────────────────────
async function sendOTP(email) {
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/otp`, {
      method:"POST",
      headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true })
    });
    return res.ok;
  } catch { return false; }
}
async function verifyOTP(email, token) {
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/verify`, {
      method:"POST",
      headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type:"email", email, token })
    });
    return res.ok;
  } catch { return false; }
}

// ─── PARRAINAGE ───────────────────────────────────────────────────────────────
function getReferralLink(telephone) {
  return `https://monpoint.site?ref=${telephone}`;
}
function getRefFromURL() {
  try { return new URLSearchParams(window.location.search).get("ref") || null; }
  catch { return null; }
}
async function crediterParrain(telephoneParrain) {
  // Récupérer le parrain
  const parrain = await fetchAgent(telephoneParrain);
  if (!parrain) return;
  // Si parrain déjà étendu à 30j → ne pas re-créditer
  if (parrain.trial_extended) return;
  // Ajouter 16 jours et marquer comme étendu
  await updateAgent(telephoneParrain, {
    trial_days: (parrain.trial_days || 14) + 16,
    trial_extended: true,
    referral_count: (parrain.referral_count || 0) + 1
  });
}

// ─── TRIAL & ABONNEMENT ───────────────────────────────────────────────────────
function getTrialInfo(agent) {
  if (!agent) return { status:"expired", daysLeft:0 };
  const now = new Date();

  // Abonnement actif payant ?
  if (agent.subscription_status === "active" && agent.subscription_expires_at) {
    const exp = new Date(agent.subscription_expires_at);
    if (exp > now) {
      return { status:"subscribed", daysLeft: Math.ceil((exp-now)/(1000*60*60*24)) };
    }
  }

  // Période d'essai — limiter trial_days à 30 max pour éviter la triche
  const start     = new Date(agent.trial_start || agent.created_at);
  const rawDays   = Number(agent.trial_days) || 14;
  const totalDays = Math.min(rawDays, 30); // MAX 30 jours — impossible de tricher
  const elapsed   = Math.floor((now - start) / (1000*60*60*24));
  const daysLeft  = totalDays - elapsed;

  if (daysLeft > 0) return { status:"trial", daysLeft };
  return { status:"expired", daysLeft:0 };
}

async function activerAbonnement(telephone, fedapayId) {
  const exp = new Date();
  exp.setDate(exp.getDate() + 30);
  await updateAgent(telephone, {
    subscription_status: "active",
    subscription_expires_at: exp.toISOString()
  });
  // Sauvegarder dans la table abonnements
  try {
    await fetch(`${SUPA_URL}/rest/v1/abonnements`, {
      method:"POST", headers:HA(telephone),
      body:JSON.stringify({ agent_telephone:telephone, montant:1999, fedapay_id:fedapayId, statut:"paid", expire_at:exp.toISOString() })
    });
  } catch {}
}

// ─── GRILLE TARIFAIRE RETRAIT ─────────────────────────────────────────────────
const GRILLE_RETRAIT = [
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
function calcComRetrait(op, montant) {
  const mt = Number(montant)||0;
  const t  = GRILLE_RETRAIT.find(t => mt>=t.min && mt<=t.max);
  return t ? (t[op]||0) : 0;
}
function calcCom(type, op, montant) { return type==="retrait" ? calcComRetrait(op,montant) : 0; }
function getTranche(montant) { const mt=Number(montant)||0; return GRILLE_RETRAIT.find(t=>mt>=t.min&&mt<=t.max)||null; }

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const OPERATORS  = ["MTN","MOOV","Celtiis"];
const OP_COLORS  = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
const OP_BG_D    = { MTN:"#FFB80018", MOOV:"#0066CC18", Celtiis:"#E6394618" };
const OP_BG_L    = { MTN:"#FFB80028", MOOV:"#0066CC20", Celtiis:"#E6394620" };
const TYPE_COLOR = { depot:"#00C896", retrait:"#4F8EF7", forfait:"#9B5FDE" };
const TYPE_ICON  = { depot:"⬇️", retrait:"⬆️", forfait:"📦" };
const TYPE_LABEL = { depot:"Dépôt", retrait:"Retrait", forfait:"Forfait" };
const JOURS      = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR    = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const fF = n => Number(n||0).toLocaleString("fr-FR") + " F";

function getSalutation(nom) {
  const h = new Date().getHours();
  const g = h>=5&&h<12?"Bonjour":h>=12&&h<18?"Bon après-midi":"Bonsoir";
  return `${g}, ${(nom||"").split(" ")[0]} 👋`;
}

// ─── THÈMES ───────────────────────────────────────────────────────────────────
const DARK  = { bg:"#080A11", card:"#0F1118", border:"#1C1F2E", border2:"#22263A", text:"#E8EAF0", sub:"#4A5060", faint:"#2E3140", hero:"#151826", input:"#080A11", nav:"#0F1118", sidebar:"#0C0E17" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", nav:"#FFFFFF", sidebar:"#EAECF5" };

// ─── HOOK RESPONSIVE ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window!=="undefined"?window.innerWidth:375);
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "ms-reset";
    style.textContent = `
      *,*::before,*::after{box-sizing:border-box!important;margin:0;padding:0;}
      html,body{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;overflow-x:hidden!important;background:#080A11!important;}
      #root,[id^="react"],body>div{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;}
      button{-webkit-tap-highlight-color:transparent;outline:none;}
      input{-webkit-appearance:none;outline:none;}
    `;
    if (!document.getElementById("ms-reset")) document.head.appendChild(style);
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── COMPOSANT PIN ────────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error, blocked }) {
  const [pin, setPin] = useState("");
  const add = d => {
    if (blocked) return;
    if (pin.length >= 4) return;
    const p = pin + d; setPin(p);
    if (p.length === 4) setTimeout(() => { onSubmit(p); setPin(""); }, 140);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <svg width="54" height="54" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:22,filter:"drop-shadow(0 6px 24px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_pin)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_pin" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:6, textAlign:"center", color:T.text }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:36, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:18, marginBottom:36 }}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{ width:20, height:20, borderRadius:"50%", background:pin.length>i?"#00C896":T.border2, border:`2px solid ${pin.length>i?"#00C896":T.border}`, boxShadow:pin.length>i?"0 0 10px #00C89660":"none", transition:"all 0.15s" }} />
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

// ─── COMPOSANT INSCRIPTION / CONNEXION ───────────────────────────────────────
function Inscription({ onDone, T }) {
  const [mode,    setMode]    = useState("register");
  const [step,    setStep]    = useState(1); // 1=form, 2=otp, 3=pin, 4=confirm-pin
  const [form,    setForm]    = useState({ nom:"", telephone:"", email:"", reseau:"MTN" });
  const [otp,     setOtp]     = useState("");
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent,       setOtpSent]       = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [loginBlocked,  setLoginBlocked]  = useState(false);
  const w = useWindowWidth();

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── INSCRIPTION : envoi OTP ──
  async function handleRegisterStep1() {
    if (!form.nom||!form.telephone||!form.email) { setError("Remplis tous les champs"); return; }
    if (!form.email.includes("@")) { setError("Email invalide"); return; }
    setLoading(true); setError("");
    // Vérifier si numéro déjà existant
    const existing = await fetchAgent(form.telephone);
    if (existing) { setError("Ce numéro a déjà un compte. Connecte-toi."); setLoading(false); return; }
    // Envoyer OTP email
    const sent = await sendOTP(form.email);
    setLoading(false);
    if (!sent) { setError("Erreur d'envoi email. Vérifie ton adresse."); return; }
    setOtpSent(true); setStep(2);
  }

  // ── INSCRIPTION : vérification OTP ──
  async function handleVerifyOTP() {
    if (otp.length < 6) { setError("Le code fait 6 chiffres"); return; }
    setLoading(true); setError("");
    const ok = await verifyOTP(form.email, otp);
    setLoading(false);
    if (!ok) { setError("Code incorrect ou expiré. Réessaie."); return; }
    setStep(3); // PIN creation
  }

  // ── INSCRIPTION : création PIN ──
  function handlePinCreate(p) { setPin(p); setStep(4); }

  // ── INSCRIPTION : confirmation PIN → sauvegarder ──
  async function handlePinConfirm(p) {
    if (p !== pin) { setError("Les codes PIN ne correspondent pas."); setStep(3); setPin(""); return; }
    setLoading(true);
    const refCode = getRefFromURL();
    const pinHash = await hashPin(p);
    const agent = {
      nom: form.nom, telephone: form.telephone, email: form.email,
      reseau: form.reseau, pin: pinHash,
      referral_code: form.telephone,
      referred_by: refCode || null,
      referral_count: 0,
      trial_days: 14,
      trial_extended: false,
      subscription_status: "trial",
      created_at: nowISO(), trial_start: nowISO()
    };
    const saved = await saveAgent(agent);
    if (refCode) await crediterParrain(refCode);
    // Recharger depuis Supabase pour avoir les vraies données
    const fresh = await fetchAgent(agent.telephone);
    const trusted = fresh ? { ...fresh, pin: pinHash } : { ...(saved||agent), pin: pinHash };
    lsSet("ms_agent", trusted);
    onDone(trusted);
  }

  // ── CONNEXION ──
  async function handleLogin() {
    if (!form.telephone) { setError("Entre ton numéro"); return; }
    setLoading(true); setError("");
    const agent = await fetchAgent(form.telephone);
    setLoading(false);
    if (!agent) { setError("Numéro introuvable. Crée un compte."); return; }
    lsSet("ms_agent", agent);
    setStep(10);
  }
  async function handlePinLogin(p) {
    if (loginBlocked) {
      setError("🔒 Trop de tentatives. Réessaie dans 5 minutes.");
      return;
    }
    const agent = lsGet("ms_agent");
    const pinHash = await hashPin(p);
    if (pinHash === agent?.pin) {
      onDone(agent);
      setLoginAttempts(0);
    } else {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      if (newAttempts >= 3) {
        setLoginBlocked(true);
        setError("🔒 3 tentatives échouées — bloqué 5 minutes.");
        setTimeout(() => {
          setLoginBlocked(false);
          setLoginAttempts(0);
          setError("");
        }, 5 * 60 * 1000);
      } else {
        setError(`Code PIN incorrect. ${3 - newAttempts} tentative${3-newAttempts>1?"s":""} restante${3-newAttempts>1?"s":""}.`);
      }
    }
  }

  // ── Écrans PIN ──
  if (step===3) return <PinPad title="Crée ton PIN" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handlePinCreate} T={T} />;
  if (step===4) return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePinConfirm} T={T} error={error} />;
  if (step===10) return <PinPad title="Connexion 👋" subtitle="Entre ton code PIN" onSubmit={handlePinLogin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:w>=640?40:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:30 }}>
          <svg width="58" height="58" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:14,filter:"drop-shadow(0 6px 26px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_ins)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_ins" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
          <div style={{ fontWeight:900, fontSize:28, marginBottom:4, color:T.text }}>Mon Point</div>
          <div style={{ fontSize:13, color:T.sub, textAlign:"center" }}>
            {mode==="register" ? "Ton cahier MoMo numérique 🇧🇯" : "Reconnecte-toi à ton espace"}
          </div>
        </div>

        {/* Toggle */}
        <div style={{ display:"flex", background:T.hero, borderRadius:13, padding:4, marginBottom:26, border:`1px solid ${T.border}` }}>
          {[["register","Nouveau compte"],["login","Se connecter"]].map(([m,label])=>(
            <button key={m} onClick={()=>{setMode(m);setStep(1);setError("");setOtp("");}}
              style={{ flex:1, padding:"11px 0", borderRadius:10, border:"none", background:mode===m?"linear-gradient(135deg,#00C896,#00A5FF)":"transparent", color:mode===m?"#fff":T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ═══ FORMULAIRE INSCRIPTION ═══ */}
        {mode==="register" && step===1 && (<>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NOM COMPLET</div>
            <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO WHATSAPP</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
            </div>
          </div>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON EMAIL (pour recevoir le code OTP)</div>
            <input type="email" placeholder="Ex : koffi@gmail.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON RÉSEAU PRINCIPAL</div>
            <div style={{ display:"flex", gap:8 }}>
              {OPERATORS.map(op=>(
                <button key={op} onClick={()=>setForm(f=>({...f,reseau:op}))}
                  style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.reseau===op?OP_COLORS[op]:T.border}`, background:form.reseau===op?OP_BG_D[op]:"transparent", color:form.reseau===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                  {op}
                </button>
              ))}
            </div>
          </div>
          <div style={{ background:"#00C89612", border:"1px solid #00C89630", borderRadius:12, padding:"11px 16px", marginBottom:20, fontSize:12, color:"#00C896", textAlign:"center" }}>
            🎁 <strong>14 jours gratuits</strong> — aucune carte bancaire requise
          </div>
          {getRefFromURL() && (
            <div style={{ background:"#FFB80012", border:"1px solid #FFB80030", borderRadius:12, padding:"11px 16px", marginBottom:16, fontSize:12, color:"#FFB800", textAlign:"center" }}>
              🎉 Tu as été invité par un ami — profite de ton essai gratuit !
            </div>
          )}
          <button onClick={handleRegisterStep1} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Envoi du code...":"Commencer — Recevoir mon code →"}
          </button>
        </>)}

        {/* ═══ VÉRIFICATION OTP ═══ */}
        {mode==="register" && step===2 && (<>
          <div style={{ background:"#00C89615", border:"1px solid #00C89640", borderRadius:14, padding:"16px 18px", marginBottom:22, textAlign:"center" }}>
            <div style={{ fontSize:20, marginBottom:8 }}>📧</div>
            <div style={{ fontWeight:800, fontSize:14, color:T.text, marginBottom:4 }}>Code envoyé à {form.email}</div>
            <div style={{ fontSize:12, color:T.sub }}>Vérifie ta boîte mail (et les spams) — valable 10 minutes</div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>ENTRE LE CODE À 6 CHIFFRES</div>
            <input
              type="number" placeholder="123456" value={otp} onChange={e=>setOtp(e.target.value.slice(0,6))}
              style={{ ...inp, fontSize:28, fontWeight:900, textAlign:"center", letterSpacing:8 }}
            />
          </div>
          <button onClick={handleVerifyOTP} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, marginBottom:12 }}>
            {loading?"⏳ Vérification...":"Valider le code ✓"}
          </button>
          <button onClick={()=>{setStep(1);setOtp("");setError("");}}
            style={{ width:"100%", padding:12, borderRadius:12, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer" }}>
            ← Modifier mon email
          </button>
        </>)}

        {/* ═══ FORMULAIRE CONNEXION ═══ */}
        {mode==="login" && step===1 && (<>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO DE TÉLÉPHONE</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Vérification...":"Continuer →"}
          </button>
        </>)}

        {error && <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:14, fontWeight:700, background:"#E6394612", border:"1px solid #E6394630", borderRadius:10, padding:"10px 14px" }}>{error}</div>}
      </div>
    </div>
  );
}

// ─── COMPOSANT MUR DE PAIEMENT ────────────────────────────────────────────────
const FEDAPAY_PAGE = "https://me.fedapay.com/46syFfak";

function PaymentWall({ agent, T, onPaid, onBack }) {
  const [checking, setChecking] = useState(false);

  // Quand l'agent revient sur l'app après paiement, on vérifie dans Supabase
  useEffect(() => {
    const onFocus = async () => {
      setChecking(true);
      // Recharger les données agent depuis Supabase
      const fresh = await fetchAgent(agent.telephone);
      if (fresh && fresh.subscription_status === "active") {
        lsSet("ms_agent", fresh);
        onPaid(fresh);
      }
      setChecking(false);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [agent]);

  function ouvrirPaiement() {
    // Ouvrir la page FedaPay dans un nouvel onglet
    window.open(FEDAPAY_PAGE, "_blank");
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:T.bg, padding:24 }}>
      <div style={{ width:"100%", maxWidth:380, textAlign:"center" }}>

        {onBack && (
          <div style={{ width:"100%", marginBottom:16, textAlign:"left" }}>
            <button onClick={onBack} style={{ background:"transparent", border:"none", color:T.sub, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              ← Retour
            </button>
          </div>
        )}

        <svg width="64" height="64" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{margin:"0 auto 20px",display:"block",filter:"drop-shadow(0 8px 30px #00C89640)"}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_pay)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_pay" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>

        <div style={{ background:"#E6394612", border:"2px solid #E6394640", borderRadius:18, padding:"22px 20px", marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⏰</div>
          <div style={{ fontWeight:900, fontSize:20, color:"#E63946", marginBottom:8 }}>Période d'essai terminée</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>
            Tes données sont en sécurité.<br/>Abonne-toi pour continuer à utiliser Mon Point.
          </div>
        </div>

        <div style={{ background:`linear-gradient(135deg,${T.hero},${T.card})`, border:"2px solid #00C89640", borderRadius:18, padding:"22px 20px", marginBottom:22 }}>
          <div style={{ fontSize:11, color:T.sub, marginBottom:6, letterSpacing:1, fontWeight:700 }}>ABONNEMENT MENSUEL</div>
          <div style={{ fontSize:46, fontWeight:900, color:"#00C896", letterSpacing:-2, marginBottom:4 }}>1 999 F</div>
          <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>par mois · 30 jours d'accès complet</div>
          {["✅ Tous tes retraits et dépôts","✅ Statistiques et historique complet","✅ Calcul automatique des commissions","✅ Rapport WhatsApp"].map(f=>(
            <div key={f} style={{ fontSize:13, color:T.text, textAlign:"left", marginBottom:6 }}>{f}</div>
          ))}
        </div>

        <button onClick={ouvrirPaiement}
          style={{ width:"100%", padding:18, borderRadius:16, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:17, cursor:"pointer", boxShadow:"0 6px 24px #00C89640", marginBottom:12 }}>
          💳 Payer 1 999 F et continuer →
        </button>

        {checking
          ? <div style={{ fontSize:13, color:"#00C896", fontWeight:700, padding:"12px 0" }}>⏳ Vérification du paiement...</div>
          : <button onClick={async () => {
              setChecking(true);
              const fresh = await fetchAgent(agent.telephone);
              if (fresh && fresh.subscription_status === "active") {
                lsSet("ms_agent", fresh);
                onPaid(fresh);
              } else {
                alert("Paiement non encore confirmé. Réessaie dans quelques secondes.");
              }
              setChecking(false);
            }}
            style={{ width:"100%", padding:13, borderRadius:13, background:"transparent", border:`1px solid ${T.border}`, color:T.sub, fontSize:13, cursor:"pointer", marginBottom:16 }}>
            🔄 J'ai déjà payé — Vérifier mon accès
          </button>
        }

        <div style={{ fontSize:11, color:T.sub, lineHeight:1.6 }}>
          Paiement sécurisé via FedaPay 🔒<br/>MTN MoMo · MOOV Money · Celtiis Cash
        </div>

        <div style={{ marginTop:20, background:"#FFB80010", border:"1px solid #FFB80030", borderRadius:14, padding:"14px 16px" }}>
          <div style={{ fontSize:12, color:"#FFB800", fontWeight:700, marginBottom:6 }}>💡 Pas encore prêt à payer ?</div>
          <div style={{ fontSize:11, color:T.sub, marginBottom:10 }}>Invite 1 ami avec ton lien → gagne <strong style={{color:"#FFB800"}}>+16 jours gratuits</strong> avant de payer.</div>
          <button onClick={()=>{ navigator.clipboard?.writeText(`https://monpoint.site?ref=${agent.telephone}`); alert("Lien copié !"); }}
            style={{ width:"100%", padding:"9px 0", borderRadius:10, background:"#FFB80020", border:"1px solid #FFB80050", color:"#FFB800", fontWeight:700, fontSize:12, cursor:"pointer" }}>
            📋 Copier mon lien de parrainage
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── SEO — BALISES META POUR GOOGLE ──────────────────────────────────────────
function injectSEO() {
  // Titre
  document.title = "Mon Point — Cahier numérique pour agents Mobile Money au Bénin";

  // Meta description
  let desc = document.querySelector('meta[name="description"]');
  if (!desc) { desc = document.createElement("meta"); desc.name = "description"; document.head.appendChild(desc); }
  desc.content = "Mon Point est l'app de gestion pour agents MoMo au Bénin. Enregistrez vos dépôts et retraits MTN, MOOV et Celtiis. Calcul automatique des commissions. Essai gratuit 14 jours.";

  // Keywords
  let kw = document.querySelector('meta[name="keywords"]');
  if (!kw) { kw = document.createElement("meta"); kw.name = "keywords"; document.head.appendChild(kw); }
  kw.content = "agent mobile money bénin, cahier momo bénin, gestion dépôt retrait, MTN MoMo, MOOV Money, Celtiis, application agent momo, mon point, monpoint.site";

  // Open Graph (WhatsApp / Facebook preview)
  const og = {
    "og:title":       "Mon Point — Cahier numérique MoMo Bénin",
    "og:description": "Gère tes dépôts et retraits MoMo facilement. Calcul automatique des commissions. Essai gratuit 14 jours.",
    "og:url":         "https://monpoint.site",
    "og:type":        "website",
    "og:image":       "https://monpoint.site/og-image.png",
  };
  Object.entries(og).forEach(([prop, content]) => {
    let tag = document.querySelector(`meta[property="${prop}"]`);
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute("property", prop); document.head.appendChild(tag); }
    tag.content = content;
  });

  // Canonical URL
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
  canonical.href = "https://monpoint.site";
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function MonPoint() {
  const [dark,          setDark]          = useState(true);
  const [agent,         setAgent]         = useState(null);
  const [locked,        setLocked]        = useState(false);
  const [pinErr,        setPinErr]        = useState("");
  const [pinAttempts,   setPinAttempts]   = useState(0);
  const [pinBlocked,    setPinBlocked]    = useState(false);
  const [pinBlockTime,  setPinBlockTime]  = useState(null);
  const [tab,           setTab]           = useState("accueil");
  const [modal,         setModal]         = useState(null);
  const [form,          setForm]          = useState({});
  const [txs,           setTxs]           = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [flash,         setFlash]         = useState(null);
  const [confirm,       setConfirm]       = useState(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [selectedDate,  setSelectedDate]  = useState(todayStr());
  const [calMonth,      setCalMonth]      = useState(new Date().getMonth()+1);
  const [calYear,       setCalYear]       = useState(new Date().getFullYear());
  const [activeDays,    setActiveDays]    = useState([]);
  const [showCal,       setShowCal]       = useState(false);
  const [pendingCount,  setPendingCount]  = useState(0);
  const [showPaywall,   setShowPaywall]   = useState(false);
  const [floats,        setFloats]        = useState({ MTN:null, MOOV:null, Celtiis:null });
  const [showFloatModal,setShowFloatModal]= useState(false);
  const [floatEditOp,   setFloatEditOp]  = useState(null);
  const [floatInput,    setFloatInput]   = useState("");

  const w       = useWindowWidth();
  const mobile  = w < 640;
  const tablet  = w >= 640 && w < 1024;
  const desktop = w >= 1024;
  const T       = dark ? DARK : LIGHT;
  const OP_BG   = dark ? OP_BG_D : OP_BG_L;
  const isToday = selectedDate === todayStr();

  const trialInfo = agent ? getTrialInfo(agent) : null;

  useEffect(() => { document.body.style.background = dark?"#080A11":"#F0F2F8"; }, [dark]);

  useEffect(() => {
    const saved = lsGet("ms_agent");

    // Détecter retour depuis FedaPay après paiement
    const params   = new URLSearchParams(window.location.search);
    const txStatus = params.get("status") || params.get("transaction_status");
    const txId     = params.get("transaction_id") || params.get("id") || "fedapay";
    const isPaid   = ["approved","completed","successful"].includes(txStatus);

    if (saved) {
      setAgent(saved);
      if (isPaid) {
        // Paiement confirmé — activer abonnement automatiquement
        activerAbonnement(saved.telephone, txId).then(() => {
          fetchAgent(saved.telephone).then(fresh => {
            if (fresh) {
              const trusted = { ...fresh, pin: saved.pin };
              lsSet("ms_agent", trusted);
              setAgent(trusted);
              setShowPaywall(false);
            }
          });
        });
        window.history.replaceState({}, "", window.location.pathname);
        setLocked(false);
      } else {
        setLocked(true);
        fetchAgent(saved.telephone).then(fresh => {
          if (fresh) {
            const trusted = { ...fresh, pin: saved.pin };
            lsSet("ms_agent", trusted);
            setAgent(trusted);
          }
        });
        const cached = lsGet(`ms_txs_${todayStr()}`);
        if (cached) setTxs(cached);
      }
    }
  }, []);

  // ── SEO Meta Tags ────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = "Mon Point — Cahier numérique pour agents Mobile Money au Bénin";
    const setMeta = (name, content, prop) => {
      const attr = prop ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("description", "Mon Point remplace le cahier papier des agents MoMo au Bénin. Enregistrez vos dépôts, retraits et commissions facilement. Essai gratuit 14 jours.");
    setMeta("keywords", "agent mobile money bénin, cahier numérique momo, gestion dépôt retrait momo, MTN momo bénin, application agent momo, mon point");
    setMeta("author", "Mon Point");
    setMeta("og:title", "Mon Point — Cahier numérique agents MoMo Bénin", null, true);
    setMeta("og:description", "Remplacez votre cahier papier. Gérez vos opérations MoMo facilement.", null, true);
    setMeta("og:url", "https://monpoint.site", null, true);
    setMeta("og:type", "website", null, true);
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", "Mon Point — Agents MoMo Bénin");
    setMeta("twitter:description", "Le cahier numérique des agents Mobile Money au Bénin.");
    // Canonical
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = "https://monpoint.site";

    // Favicon SVG — logo M avec point
    const faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
      <defs>
        <linearGradient id="fg" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#00C896"/>
          <stop offset="50%" stop-color="#00A5FF"/>
          <stop offset="100%" stop-color="#7B2FBE"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="48" height="48" rx="14" fill="url(#fg)"/>
      <path d="M11 37 L11 17 L26 29 L41 17 L41 37" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="26" cy="41" r="3.5" fill="white" opacity="0.95"/>
    </svg>`;

    const faviconUrl = "data:image/svg+xml," + encodeURIComponent(faviconSVG);

    // Supprimer les anciens favicons
    document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());

    // Ajouter le nouveau favicon
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.href = faviconUrl;
    document.head.appendChild(favicon);

    // Apple touch icon
    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    appleIcon.href = faviconUrl;
    document.head.appendChild(appleIcon);

    // Titre de l'onglet
    document.title = "Mon Point 💚";
  }, []);

  // ── Détection minuit — heure Bénin (UTC+1) ─────────────────────────────────
  useEffect(() => {
    if (!agent) return;
    let lastDay = todayStr();
    const interval = setInterval(() => {
      const currentDay = todayStr();
      if (currentDay !== lastDay) {
        lastDay = currentDay;
        setSelectedDate(currentDay);
        setTxs([]);
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [agent]);

  // Protection bouton retour
  useEffect(() => {
    window.history.pushState({ ms:true }, "");
    const onPop = () => {
      window.history.pushState({ ms:true }, "");
      setModal(null); setShowCal(false); setConfirm(null); setConfirmLogout(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (agent) {
      const pend = lsGet(pendKey(agent.telephone));
      setPendingCount(pend ? pend.length : 0);
    }
  }, [agent, txs]);

  useEffect(() => {
    if (!agent) return;
    const trySync = async () => {
      const synced = await flushPending(agent.telephone);
      if (synced.length > 0) { setPendingCount(0); loadTxs(selectedDate); }
    };
    window.addEventListener("online", trySync);
    trySync();
    return () => window.removeEventListener("online", trySync);
  }, [agent]);

  async function handleUnlock(pin) {
    // Vérifier si bloqué
    if (pinBlocked) {
      const now = Date.now();
      const diff = Math.ceil((pinBlockTime + 5*60*1000 - now) / 60000);
      setPinErr(`🔒 Compte bloqué. Réessaie dans ${diff} minute${diff>1?"s":""}.`);
      return;
    }
    const pinHash = await hashPin(pin);
    if (pinHash === agent.pin) {
      // Toujours recharger depuis Supabase — jamais faire confiance au localStorage
      fetchAgent(agent.telephone).then(fresh => {
        if (fresh) {
          // Garder seulement le PIN hashé du cache local (pas dans Supabase)
          const trusted = { ...fresh, pin: agent.pin };
          lsSet("ms_agent", trusted);
          setAgent(trusted);
        }
      });
      setLocked(false); setPinErr(""); setPinAttempts(0);
    } else {
      const newAttempts = pinAttempts + 1;
      setPinAttempts(newAttempts);
      if (newAttempts >= 3) {
        setPinBlocked(true);
        setPinBlockTime(Date.now());
        setPinErr("🔒 3 tentatives échouées — compte bloqué 5 minutes.");
        // Débloquer automatiquement après 5 minutes
        setTimeout(() => {
          setPinBlocked(false);
          setPinAttempts(0);
          setPinErr("");
        }, 5 * 60 * 1000);
      } else {
        setPinErr(`Code PIN incorrect. ${3 - newAttempts} tentative${3-newAttempts>1?"s":""} restante${3-newAttempts>1?"s":""}.`);
      }
    }
  }

  function handleLogout() {
    lsDel("ms_agent");
    setAgent(null); setLocked(false); setTxs([]); setTab("accueil"); setConfirmLogout(false);
  }

  const loadTxs = useCallback(async (date) => {
    if (!agent) return;
    const cached = lsGet(txKey(date, agent.telephone)) || [];
    if (cached.length > 0) { setTxs(cached); setLoading(false); }
    else setLoading(true);
    const fresh = await fetchTxsByDate(date, agent.telephone);
    setTxs(fresh.length > 0 ? fresh : cached);
    setLoading(false);
  }, [agent]);

  useEffect(() => { if (agent && !locked) loadTxs(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) loadFloats(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) fetchActiveDays(calYear, calMonth, agent.telephone).then(setActiveDays); }, [calMonth, calYear, agent, locked]);

  const sum      = f => txs.filter(f).reduce((s,t) => s+Number(t.montant),    0);
  const com      = f => txs.filter(f).reduce((s,t) => s+Number(t.commission), 0);
  const totalCA  = sum(()=>true);
  const totalCom = com(()=>true);

  async function addTx() {
    if (!form.operateur || !form.montant) return;
    setSaving(true);
    const localId = Date.now();
    const tx = {
      type:modal, operateur:form.operateur, montant:Number(form.montant),
      commission:calcCom(modal, form.operateur, Number(form.montant)),
      client:form.client||"Client", telephone:form.telephone||null,
      forfait:null, heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      user_id:agent.telephone, localId, created_at:nowISO()
    };
    const optimistic = { ...tx, id:localId };
    setTxs(p=>[optimistic,...p]);
    const saved = await saveTxRemote(tx);
    if (saved) { setTxs(p=>p.map(t=>t.id===localId?saved:t)); }
    else {
      const pend = lsGet(pendKey(agent.telephone))||[];
      lsSet(pendKey(agent.telephone), [...pend, tx]);
      setPendingCount(c=>c+1);
    }
    const cached = lsGet(txKey(selectedDate, agent.telephone))||[];
    lsSet(txKey(selectedDate, agent.telephone), [saved||optimistic, ...cached]);
    setSaving(false); setModal(null); setForm({});
    setFlash(modal); setTimeout(()=>setFlash(null), 2200);
    setTimeout(()=>loadTxs(selectedDate), 1200);
  }

  async function removeTx(id) {
    await deleteTx(id, agent.telephone);
    const updated = txs.filter(t=>t.id!==id);
    setTxs(updated);
    lsSet(txKey(selectedDate, agent.telephone), updated);
    setConfirm(null);
  }

  // ── FLOAT (UNITÉS) ──────────────────────────────────────────────────────────
  function loadFloats(date) {
    const stored = lsGet(floatKey(date, agent.telephone));
    setFloats(stored || { MTN:null, MOOV:null, Celtiis:null });
  }

  function saveFloat(op, solde) {
    const updated = { ...floats, [op]: Number(solde) };
    setFloats(updated);
    lsSet(floatKey(selectedDate, agent.telephone), updated);
  }

  function calcFloatActuel(op) {
    if (floats[op] === null || floats[op] === undefined) return null;
    const depots   = txs.filter(t=>t.operateur===op&&t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
    const retraits = txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
    // Dépôt → agent envoie unités → float baisse
    // Retrait → agent reçoit unités → float monte
    return floats[op] - depots + retraits;
  }

  function getFloatColor(actuel, depart) {
    if (actuel === null || depart === null || depart === 0) return "#4A5060";
    const pct = actuel / depart;
    if (actuel < 0)   return "#E63946";
    if (pct < 0.15)   return "#E63946";
    if (pct < 0.35)   return "#FFB800";
    return "#00C896";
  }

  function getFloatLabel(actuel, depart) {
    if (actuel === null) return null;
    if (actuel < 0)     return "⚠️ Dépassé";
    const pct = depart > 0 ? actuel / depart : 1;
    if (pct < 0.15)     return "🔴 Critique";
    if (pct < 0.35)     return "🟡 Faible";
    return "🟢 OK";
  }

  function shareReport() {
    const dateLabel = new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    const forfaitsVendus = txs.filter(t=>t.type==="forfait");
    const internetCount = txs.filter(t=>t.type==="forfait"&&t.forfait==="internet").length;
    const appelCount    = txs.filter(t=>t.type==="forfait"&&t.forfait==="appel").length;
    const creditCount   = txs.filter(t=>t.type==="forfait"&&t.forfait==="simple").length;
    const forfaitLine   = forfaitsVendus.length > 0 ? `\n📦 Forfaits : ${forfaitsVendus.length} | 🌐 Internet: ${internetCount} | 📞 Appel: ${appelCount} | 📱 Simple: ${creditCount}\n💵 Total forfaits : ${fF(sum(t=>t.type==="forfait"))}` : "";
    const floatLines = OPERATORS.map(op => {
      const actuel = calcFloatActuel(op);
      if (actuel === null) return null;
      return `💼 Solde ${op} : ${fF(actuel)}`;
    }).filter(Boolean).join("\n");
    const text = `📊 *Point du jour — Mon Point*\n📅 ${dateLabel}\n👤 Agent : ${agent.nom}\n\n⬇️ Dépôts : ${fF(sum(t=>t.type==="depot"))}\n⬆️ Retraits : ${fF(sum(t=>t.type==="retrait"))}${forfaitLine}\n\n💰 *CA Total : ${fF(totalCA)}*\n✅ *Commission : ${fF(totalCom)}*${floatLines?"\n\n"+floatLines:""}\n\n_Généré par Mon Point_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  function getDaysInMonth(y,m) { return new Date(y,m,0).getDate(); }
  function getFirstDay(y,m)    { return new Date(y,m-1,1).getDay(); }
  function formatDateLabel(str) {
    if (str===todayStr()) return "Aujourd'hui";
    return new Date(str).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  }

  // ── Gardes ──────────────────────────────────────────────────────────────────
  if (!agent) return <Inscription onDone={a=>{setAgent(a);setLocked(false);}} T={T} />;
  if (locked) return <PinPad title="Bon retour 👋" subtitle={`Content de te revoir, ${agent.nom.split(" ")[0]} !`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  // ── Vérification trial ───────────────────────────────────────────────────────
  if (trialInfo?.status === "expired" || showPaywall) {
    return <PaymentWall agent={agent} T={T} onPaid={a=>{setAgent(a);lsSet("ms_agent",a);setShowPaywall(false);}} onBack={trialInfo?.status!=="expired"?()=>setShowPaywall(false):null} />;
  }

  const NAV_ITEMS = [
    ["accueil","🏠","Accueil"],
    ["stats","📊","Statistiques"],
    ["historique","🗂️","Historique"],
    ["profil","👤","Profil"],
  ];

  const modalWrap = desktop
    ? { position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:24 }
    : { position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"flex-end", zIndex:200 };
  const modalBox = desktop
    ? { background:T.card, borderRadius:20, padding:"26px 28px 30px", width:"100%", maxWidth:460, border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" }
    : { width:"100%", background:T.card, borderRadius:"22px 22px 0 0", padding:"16px 18px 48px", border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" };

  const contentPad = desktop?"24px 32px 48px":tablet?"20px 24px 140px":"16px 14px 140px";
  const mainLeft   = desktop ? 240 : 0;

  // ── Couleur bannière trial ───────────────────────────────────────────────────
  const trialColor  = trialInfo?.daysLeft <= 3 ? "#E63946" : trialInfo?.daysLeft <= 7 ? "#FFB800" : "#00C896";
  const trialBg     = trialInfo?.daysLeft <= 3 ? "#E6394612" : trialInfo?.daysLeft <= 7 ? "#FFB80012" : "#00C89612";

  return (<>
    <style>{`
      *,*::before,*::after{box-sizing:border-box!important;}
      html{margin:0!important;padding:0!important;background:${T.bg}!important;}
      body{margin:0!important;padding:0!important;width:100vw!important;max-width:100%!important;overflow-x:hidden!important;background:${T.bg}!important;}
      #root,[data-reactroot],body>div{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;}
      button{-webkit-tap-highlight-color:transparent!important;}
    `}</style>

    <div style={{ background:T.bg, minHeight:"100vh", width:"100vw", maxWidth:"100%", margin:0, padding:0, color:T.text, fontFamily:"'Segoe UI',system-ui,sans-serif", position:"relative", overflowX:"hidden" }}>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash]||"#9B5FDE", color:"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:9999, boxShadow:"0 4px 24px #0009", whiteSpace:"nowrap" }}>
          ✅ {TYPE_LABEL[flash]||"Forfait"} enregistré !
        </div>
      )}


      {/* BADGE PENDING */}
      {pendingCount > 0 && (
        <div style={{ position:"fixed", bottom:mobile?80:88, left:12, background:"#FFB800", color:"#000", borderRadius:20, padding:"5px 11px", fontWeight:800, fontSize:11, zIndex:999, boxShadow:"0 2px 10px #FFB80060", pointerEvents:"none" }}>
          ⚡ {pendingCount} en attente
        </div>
      )}

      {/* ══ SIDEBAR DESKTOP ═════════════════════════════════════════════ */}
      {desktop && (
        <aside style={{ position:"fixed", top:0, left:0, width:240, height:"100vh", background:T.sidebar, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"22px 20px 20px", borderBottom:`1px solid ${T.border}` }}>
            <svg width="42" height="42" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_sb)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_sb" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:15 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>Agent mobile money 🇧🇯</div>
            </div>
          </div>

          {/* Bannière trial desktop */}
          {trialInfo?.status === "trial" && (
            <div style={{ margin:"12px 14px 0", background:trialBg, border:`1px solid ${trialColor}40`, borderRadius:11, padding:"10px 14px" }}>
              <div style={{ fontSize:11, color:trialColor, fontWeight:800 }}>
                ⏳ {trialInfo.daysLeft} jour{trialInfo.daysLeft>1?"s":""} d'essai restant{trialInfo.daysLeft>1?"s":""}
              </div>
              {!agent.trial_extended && (
                <div style={{ fontSize:10, color:T.sub, marginTop:3 }}>Invite 1 ami → +16 jours gratuits</div>
              )}
            </div>
          )}

          <div style={{ margin:"12px 14px 6px", background:T.card, borderRadius:13, padding:"12px 14px", border:`1px solid ${T.border}` }}>
            <div style={{ fontSize:11, color:T.sub }}>Connecté en tant que</div>
            <div style={{ fontWeight:800, fontSize:14 }}>{agent.nom}</div>
            <div style={{ fontSize:11, color:OP_COLORS[agent.reseau]||"#00C896", marginTop:2, fontWeight:700 }}>{agent.reseau} · +229 {agent.telephone}</div>
          </div>

          <nav style={{ flex:1, padding:"10px 12px" }}>
            {NAV_ITEMS.map(([key,icon,label])=>(
              <button key={key} onClick={()=>setTab(key)}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 14px", borderRadius:11, border:"none", background:tab===key?"#00C89618":"transparent", color:tab===key?"#00C896":T.sub, fontWeight:tab===key?800:500, fontSize:14, cursor:"pointer", marginBottom:4, textAlign:"left" }}>
                <span style={{ fontSize:18 }}>{icon}</span>{label}
                {tab===key && <div style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#00C896" }} />}
              </button>
            ))}
            {isToday && (
              <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, marginBottom:10, paddingLeft:4, letterSpacing:1 }}>NOUVELLE OPÉRATION</div>
                {[["depot","⬇️ Nouveau Dépôt","#00C896"],["retrait","⬆️ Nouveau Retrait","#4F8EF7"]].map(([type,label,color])=>(
                  <button key={type} onClick={()=>{setModal(type);setForm({});}}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:11, border:`1px solid ${color}40`, background:`${color}18`, color, fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:8 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </nav>

          <div style={{ padding:"14px 12px", borderTop:`1px solid ${T.border}` }}>
            <button onClick={()=>setConfirmLogout(true)}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"11px 14px", borderRadius:10, border:"none", background:"#E6394610", color:"#E63946", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              <span>🔓</span> Déconnexion
            </button>
          </div>
        </aside>
      )}

      {/* ══ HEADER MOBILE/TABLETTE ══════════════════════════════════════ */}
      {!desktop && (
        <header style={{ background:T.card, padding:tablet?"14px 22px":"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50, width:"100%" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad2)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad2" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00C896"/>
      <stop offset="50%" stop-color="#00A5FF"/>
      <stop offset="100%" stop-color="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:16 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Badge trial mobile */}
            {trialInfo?.status === "trial" && (
              <div style={{ background:trialBg, color:trialColor, borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:800, border:`1px solid ${trialColor}30` }}>
                ⏳ {trialInfo.daysLeft}j
              </div>
            )}
            {pendingCount > 0 && <div style={{ background:"#FFB80018", color:"#FFB800", borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:700 }}>⚡{pendingCount}</div>}
            <button onClick={()=>setShowCal(true)} style={{ background:dark?"#1C1F2E":"#E4E8F5", border:"none", borderRadius:10, padding:"8px 10px", cursor:"pointer", fontSize:18, lineHeight:1 }}>📅</button>
          </div>
        </header>
      )}

      {/* Salutation mobile */}
      {!desktop && tab==="accueil" && (
        <div style={{ padding:tablet?"20px 22px 0":"18px 16px 0" }}>
          <div style={{ fontWeight:900, fontSize:tablet?22:20, color:T.text }}>{getSalutation(agent.nom)}</div>
          <div style={{ fontSize:12, color:T.sub, marginTop:3 }}>
            {isToday?"Voici ton tableau de bord du jour":`Données du ${new Date(selectedDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}`}
          </div>
        </div>
      )}

      {/* ══ HEADER DESKTOP ══════════════════════════════════════════════ */}
      {desktop && (
        <header style={{ position:"fixed", top:0, left:240, right:0, background:T.card, borderBottom:`1px solid ${T.border}`, padding:"14px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", zIndex:50 }}>
          <div>
            {tab==="accueil"
              ? <div style={{ fontWeight:900, fontSize:18 }}>{getSalutation(agent.nom)}</div>
              : <div style={{ fontWeight:900, fontSize:17 }}>{NAV_ITEMS.find(n=>n[0]===tab)?.[1]} {NAV_ITEMS.find(n=>n[0]===tab)?.[2]}</div>
            }
            <div style={{ fontSize:11, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
          </div>
          <button onClick={()=>setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:10, padding:"9px 16px", cursor:"pointer", fontSize:14, color:T.text, fontWeight:600, display:"flex", alignItems:"center", gap:7 }}>
            📅 Changer de date
          </button>
        </header>
      )}

      {/* ══ CONTENU ════════════════════════════════════════════════════ */}
      <main style={{ marginLeft:mainLeft, paddingTop:desktop?62:0, minHeight:"100vh" }}>
        <div style={{ maxWidth:desktop?860:tablet?720:"100%", margin:"0 auto", padding:contentPad }}>

          {/* Bannière trial mobile */}
          {trialInfo?.status === "trial" && !desktop && (
            <div style={{ background:trialBg, border:`1px solid ${trialColor}40`, borderRadius:12, padding:"10px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:trialColor }}>
                  ⏳ {trialInfo.daysLeft} jour{trialInfo.daysLeft>1?"s":""} d'essai restant{trialInfo.daysLeft>1?"s":""}
                </div>
                {!agent.trial_extended && <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Invite 1 ami pour +16 jours gratuits</div>}
              </div>
              {trialInfo.daysLeft <= 5 && (
                <button onClick={()=>setTab("profil")} style={{ background:trialColor, border:"none", borderRadius:9, padding:"7px 14px", color:"#fff", fontSize:11, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>
                  Voir offre
                </button>
              )}
            </div>
          )}

          {/* Bandeau date passée */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", borderRadius:12, padding:"10px 16px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          {/* ══ ACCUEIL ══ */}
          {tab==="accueil" && (<>

            {/* ══ CARTE SOLDE DE DÉPART ══ */}
            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #7B2FBE30` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>💼 Solde de départ</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Tes unités disponibles ce jour</div>
                </div>
                {isToday && (
                  <button onClick={()=>{setFloatEditOp(null);setFloatInput("");setShowFloatModal(true);}}
                    style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:9, padding:"6px 14px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>
                    ✏️ Modifier
                  </button>
                )}
              </div>

              {OPERATORS.map((op, i) => {
                const actuel = calcFloatActuel(op);
                const depart = floats[op];
                const color  = getFloatColor(actuel, depart);
                const label  = getFloatLabel(actuel, depart);
                const depots   = txs.filter(t=>t.operateur===op&&t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
                const retraits = txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
                const pct = depart > 0 && actuel !== null ? Math.max(0, Math.min(100, (actuel / depart) * 100)) : 0;
                return (
                  <div key={op} style={{ marginBottom: i < 2 ? 14 : 0, paddingBottom: i < 2 ? 14 : 0, borderBottom: i < 2 ? `1px solid ${T.border}` : "none" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: depart !== null ? 8 : 0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:34, height:34, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                          {depart !== null
                            ? <div style={{ fontSize:10, color:T.sub }}>Départ : {fF(depart)}</div>
                            : <div style={{ fontSize:10, color:T.faint }}>Non défini</div>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {actuel !== null ? (
                          <>
                            <div style={{ fontSize:17, fontWeight:900, color }}>{fF(actuel)}</div>
                            <div style={{ fontSize:10, fontWeight:700, color, marginTop:1 }}>{label}</div>
                          </>
                        ) : (
                          <button onClick={()=>{setFloatEditOp(op);setFloatInput("");setShowFloatModal(true);}}
                            style={{ background:"#7B2FBE18", border:"1px solid #7B2FBE40", borderRadius:8, padding:"6px 12px", color:"#9B5FDE", fontSize:11, fontWeight:800, cursor:"pointer" }}>
                            + Définir
                          </button>
                        )}
                      </div>
                    </div>
                    {depart !== null && actuel !== null && (
                      <div style={{ marginBottom:6 }}>
                        <div style={{ height:5, background:T.faint, borderRadius:3, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3, transition:"width 0.4s ease" }} />
                        </div>
                      </div>
                    )}
                    {depart !== null && (depots > 0 || retraits > 0) && (
                      <div style={{ display:"flex", gap:6, marginTop:4 }}>
                        {depots > 0 && <div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬇️ </span><span style={{ color:"#E63946", fontWeight:700 }}>-{fF(depots)}</span></div>}
                        {retraits > 0 && <div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89620", borderRadius:7, padding:"4px 8px", fontSize:10 }}><span style={{ color:T.sub }}>⬆️ </span><span style={{ color:"#00C896", fontWeight:700 }}>+{fF(retraits)}</span></div>}
                      </div>
                    )}
                    {actuel !== null && actuel < 5000 && actuel >= 0 && (
                      <div style={{ marginTop:6, background:"#E6394612", border:"1px solid #E6394635", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:700 }}>⚠️ Solde {op} bas — recharge tes unités !</div>
                    )}
                    {actuel !== null && actuel < 0 && (
                      <div style={{ marginTop:6, background:"#E6394620", border:"1px solid #E6394650", borderRadius:7, padding:"5px 10px", fontSize:10, color:"#E63946", fontWeight:800 }}>🚨 Solde {op} dépassé de {fF(Math.abs(actuel))} !</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ══ VENTE UNITÉS — 3 TAPS ══ */}
            {isToday && (
            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #9B5FDE30` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>📦 Vente d'unités</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Enregistre en 3 taps</div>
                </div>
                <div style={{ fontSize:11, color:"#9B5FDE", fontWeight:700 }}>{txs.filter(t=>t.type==="forfait").length} vendu{txs.filter(t=>t.type==="forfait").length>1?"s":""}</div>
              </div>

              {/* Étape 1 — Type de forfait */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>1 — TYPE</div>
                <div style={{ display:"flex", gap:8 }}>
                  {[["internet","🌐","Internet"],["appel","📞","Appel"],["simple","📱","Simple"]].map(([k,ico,lbl])=>(
                    <button key={k} onClick={()=>setForm(f=>({...f, forfaitType:f.forfaitType===k?null:k, forfaitPrix:null}))}
                      style={{ flex:1, padding:"10px 4px", borderRadius:11, border:`2px solid ${form.forfaitType===k?"#9B5FDE":T.border}`, background:form.forfaitType===k?"#9B5FDE18":"transparent", color:form.forfaitType===k?"#9B5FDE":T.sub, fontWeight:800, fontSize:12, cursor:"pointer", textAlign:"center" }}>
                      <div style={{ fontSize:16 }}>{ico}</div>
                      <div style={{ marginTop:2 }}>{lbl}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Étape 2 — Opérateur */}
              {form.forfaitType && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>2 — RÉSEAU</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {OPERATORS.map(op=>(
                      <button key={op} onClick={()=>setForm(f=>({...f, forfaitOp:f.forfaitOp===op?null:op, forfaitPrix:null}))}
                        style={{ flex:1, padding:"10px 0", borderRadius:11, border:`2px solid ${form.forfaitOp===op?OP_COLORS[op]:T.border}`, background:form.forfaitOp===op?OP_BG[op]:"transparent", color:form.forfaitOp===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                        {op}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Étape 3 — Prix */}
              {form.forfaitType && form.forfaitOp && (()=>{
                const GRILLES = {
                  MTN: {
                    internet:[100,300,500,1000,2000,3500,6000,15100,20000,25000,30000,50000,75000,100000],
                    appel:   [100,150,200,300,500,1000,1500,2500,5000],
                    credit:  [100,200,500,1000,2000,5000,10000],
                  },
                  MOOV: {
                    internet:[200,500,1000,2000,4500,8000,15000,15500,20000,50000],
                    appel:   [100,200,500,1000,2500,5000],
                    credit:  [100,200,500,1000,2000,5000],
                  },
                  Celtiis: {
                    internet:[1000,3000,5000,10000,20000],
                    appel:   [100,150,200,500,1500,3000,5000,10000],
                    credit:  [200,500,1000,2000,5000],
                  },
                };
                const prix = GRILLES[form.forfaitOp]?.[form.forfaitType] || [];
                return (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>3 — MONTANT</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {prix.map(p=>(
                        <button key={p} onClick={()=>setForm(f=>({...f, forfaitPrix:p}))}
                          style={{ padding:"7px 12px", borderRadius:9, border:`2px solid ${form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.border}`, background:form.forfaitPrix===p?OP_BG[form.forfaitOp]:"transparent", color:form.forfaitPrix===p?OP_COLORS[form.forfaitOp]:T.sub, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                          {p>=1000?(p/1000)+"k":p} F
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Bouton enregistrer forfait */}
              {form.forfaitType && form.forfaitOp && form.forfaitPrix && (
                <button onClick={async ()=>{
                  setSaving(true);
                  const localId = Date.now();
                  const typeLabels = {internet:"🌐 Internet",appel:"📞 Appel",credit:"📱 Simple"};
                  const tx = {
                    type:"forfait", operateur:form.forfaitOp,
                    montant:Number(form.forfaitPrix), commission:0,
                    client:typeLabels[form.forfaitType]||"Forfait",
                    telephone:null, forfait:form.forfaitType,
                    heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
                    user_id:agent.telephone, localId, created_at:nowISO()
                  };
                  const optimistic = {...tx, id:localId};
                  setTxs(p=>[optimistic,...p]);
                  const saved = await saveTxRemote(tx);
                  if(saved){setTxs(p=>p.map(t=>t.id===localId?saved:t));}
                  else{const pend=lsGet(pendKey(agent.telephone))||[];lsSet(pendKey(agent.telephone),[...pend,tx]);setPendingCount(c=>c+1);}
                  const cached=lsGet(txKey(selectedDate,agent.telephone))||[];
                  lsSet(txKey(selectedDate,agent.telephone),[saved||optimistic,...cached]);
                  setSaving(false); setForm({}); setFlash("forfait"); setTimeout(()=>setFlash(null),2200);
                  setTimeout(()=>loadTxs(selectedDate),1200);
                }} disabled={saving}
                  style={{ width:"100%", padding:14, borderRadius:12, background:saving?"#1A1D2E":"linear-gradient(135deg,#9B5FDE,#7B2FBE)", border:"none", color:saving?T.sub:"#fff", fontWeight:900, fontSize:14, cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {saving?"⏳ Sauvegarde…":`✅ Enregistrer — ${form.forfaitOp} ${form.forfaitType} ${fF(form.forfaitPrix)}`}
                </button>
              )}
            </div>
            )}

            <button onClick={shareReport} style={{ width:"100%", padding:16, borderRadius:16, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>📤</span> Envoyer le point du jour sur WhatsApp
            </button>

            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid ${T.border}` }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:16 }}>Par opérateur</div>
              {OPERATORS.map((op,i)=>{
                const o = txs.filter(t=>t.operateur===op);
                return (
                  <div key={op} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                    <div style={{ width:36, height:36, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                      <div style={{ fontSize:11, color:T.sub }}>{o.length} opération{o.length>1?"s":""}</div>
                    </div>
                    <div style={{ fontWeight:900, color:OP_COLORS[op], fontSize:15 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</div>
                  </div>
                );
              })}
            </div>

           

            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:16 }}>Dernières opérations</div>
              {loading && <div style={{ textAlign:"center", color:T.faint, padding:"24px 0", fontSize:13 }}>⏳ Chargement…</div>}
              {!loading && txs.length===0 && <div style={{ textAlign:"center", color:T.faint, padding:"32px 0", fontSize:13 }}>{isToday?"Aucune opération · Appuie sur ⬇️ ou ⬆️":"Aucune opération ce jour"}</div>}
              {txs.slice(0,6).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:i<Math.min(txs.length,8)-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ width:38, height:38, borderRadius:11, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                    <div style={{ fontSize:11, color:T.sub }}>{t.heure||""}</div>
                  </div>
                  {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:15, flexShrink:0, padding:"0 4px" }}>🗑️</button>}
                </div>
              ))}
            </div>
          </>)}

          {/* ══ STATS ══ */}
          {tab==="stats" && (
            <div>
              <div style={{ fontWeight:900, fontSize:desktop?20:18, marginBottom:20 }}>📊 Statistiques</div>
              <div style={{ background:"linear-gradient(135deg,#1A2810,#1A2030)", borderRadius:18, padding:desktop?24:18, marginBottom:16, border:"1px solid #00C89630" }}>
                <div style={{ fontSize:11, color:"#4A7050", marginBottom:4 }}>💰 Commission {isToday?"du jour":"ce jour"}</div>
                <div style={{ fontSize:desktop?38:30, fontWeight:900, color:"#00C896" }}>{fF(totalCom)}</div>
                <div style={{ fontSize:11, color:"#3A5040", marginTop:6 }}>Retrait : grille tarifaire officielle · Dépôt : aucune commission</div>
              </div>
              {["depot","retrait"].map(type=>{
                const tTxs = txs.filter(t=>t.type===type);
                return (
                  <div key={type} style={{ background:T.card, borderRadius:16, padding:desktop?20:16, marginBottom:12, border:`1px solid ${TYPE_COLOR[type]}22` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                      <div style={{ fontWeight:800, fontSize:14 }}>{TYPE_ICON[type]} {TYPE_LABEL[type]}s</div>
                      <div>
                        <span style={{ color:TYPE_COLOR[type], fontWeight:900 }}>{fF(tTxs.reduce((s,t)=>s+Number(t.montant),0))}</span>
                        <span style={{ color:T.sub, fontSize:11 }}> · {fF(tTxs.reduce((s,t)=>s+Number(t.commission),0))}</span>
                      </div>
                    </div>
                    {OPERATORS.map((op,i)=>{
                      const o = txs.filter(t=>t.type===type&&t.operateur===op);
                      return (
                        <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:i<2?`1px solid ${T.border}`:"none", fontSize:13 }}>
                          <div><span style={{ color:OP_COLORS[op], fontWeight:700 }}>{op}</span><span style={{ color:T.faint, fontSize:11 }}> {o.length} opération{o.length>1?"s":""}</span></div>
                          <div><span style={{ fontWeight:700 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</span><span style={{ color:T.sub, fontSize:11 }}> +{fF(o.reduce((s,t)=>s+Number(t.commission),0))}</span></div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <button onClick={shareReport} style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>📤</span> Partager ce rapport
              </button>
            </div>
          )}

          {/* ══ HISTORIQUE ══ */}
          {tab==="historique" && (
            <div>
              <div style={{ fontWeight:900, fontSize:desktop?20:18, marginBottom:20 }}>🗂️ Historique</div>
              {loading && <div style={{ textAlign:"center", color:T.faint, padding:"48px 0" }}>⏳ Chargement…</div>}
              {!loading && txs.length===0 && <div style={{ textAlign:"center", color:T.faint, padding:"56px 0", fontSize:14 }}>Aucune opération {isToday?"enregistrée":"ce jour"}</div>}
              <div style={{ display:"grid", gridTemplateColumns:desktop?"1fr 1fr":"1fr", gap:10 }}>
                {txs.map(t=>(
                  <div key={t.id} style={{ background:T.card, borderRadius:14, padding:"14px 16px", border:`1px solid ${TYPE_COLOR[t.type]}18`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:38, height:38, borderRadius:11, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13 }}>{TYPE_LABEL[t.type]} · <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                        <div style={{ fontSize:11, color:T.sub }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:15 }}>{fF(t.montant)}</div>
                        <div style={{ fontSize:11, color:T.sub }}>{t.heure||""}</div>
                      </div>
                      {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:15, padding:4 }}>🗑️</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ PROFIL ══ */}
          {tab==="profil" && (
            <div>
              <div style={{ fontWeight:900, fontSize:desktop?20:18, marginBottom:20 }}>👤 Mon Profil</div>

              {/* Infos agent */}
              <div style={{ background:T.card, borderRadius:18, padding:desktop?26:20, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
                  <div style={{ width:58, height:58, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:17, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:24, color:"#fff", flexShrink:0, boxShadow:"0 4px 16px #00C89640" }}>
                    {agent.nom?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:18 }}>{agent.nom}</div>
                    <div style={{ fontSize:13, color:T.sub }}>Agent Mobile Money</div>
                    <div style={{ fontSize:12, color:OP_COLORS[agent.reseau]||"#00C896", marginTop:3, fontWeight:700 }}>{agent.reseau} · +229 {agent.telephone}</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:desktop?"1fr 1fr":"1fr", gap:10 }}>
                  {[
                    ["📱 Réseau", agent.reseau],
                    ["📞 WhatsApp", `+229 ${agent.telephone}`],
                    ["📧 Email", agent.email || "—"],
                    ["📅 Inscrit le", agent.trial_start ? new Date(agent.trial_start).toLocaleDateString("fr-FR") : "—"],
                  ].map(([label,value])=>(
                    <div key={label} style={{ background:T.hero, borderRadius:12, padding:"12px 16px" }}>
                      <div style={{ fontSize:11, color:T.sub }}>{label}</div>
                      <div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Statut abonnement */}
              <div style={{ background:T.card, borderRadius:18, padding:desktop?22:18, marginBottom:14, border:`1px solid ${trialColor}30` }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>⏳ Mon abonnement</div>
                {trialInfo?.status === "trial" && (
                  <div style={{ background:trialBg, border:`1px solid ${trialColor}40`, borderRadius:12, padding:"14px 16px", marginBottom:14 }}>
                    <div style={{ fontSize:15, fontWeight:900, color:trialColor }}>
                      {trialInfo.daysLeft} jour{trialInfo.daysLeft>1?"s":""} d'essai restant{trialInfo.daysLeft>1?"s":""}
                    </div>
                    <div style={{ fontSize:12, color:T.sub, marginTop:4 }}>
                      {agent.trial_extended ? "✅ Tu as déjà profité du bonus parrainage (30j total)" : "Invite 1 ami → gagne +16 jours gratuits"}
                    </div>
                  </div>
                )}
                {trialInfo?.status === "subscribed" && (
                  <div style={{ background:"#00C89618", border:"1px solid #00C89640", borderRadius:12, padding:"14px 16px", marginBottom:14 }}>
                    <div style={{ fontSize:15, fontWeight:900, color:"#00C896" }}>✅ Abonnement actif</div>
                    <div style={{ fontSize:12, color:T.sub, marginTop:4 }}>{trialInfo.daysLeft} jours restants</div>
                  </div>
                )}
                {trialInfo?.status !== "subscribed" && (
                  <div style={{ background:`linear-gradient(135deg,${T.hero},${T.card})`, border:`1px solid #00C89630`, borderRadius:12, padding:"16px 18px", textAlign:"center" }}>
                    <div style={{ fontSize:12, color:T.sub, marginBottom:4 }}>Abonnement mensuel</div>
                    <div style={{ fontSize:28, fontWeight:900, color:"#00C896", marginBottom:10 }}>1 999 F/mois</div>
                    <button onClick={()=>setShowPaywall(true)}
                      style={{ width:"100%", padding:14, borderRadius:12, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer" }}>
                      💳 S'abonner maintenant
                    </button>
                  </div>
                )}
              </div>

              {/* Parrainage */}
              <div style={{ background:T.card, borderRadius:18, padding:desktop?22:18, marginBottom:14, border:"1px solid #FFB80030" }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>🎁 Parrainage</div>
                <div style={{ background:"#FFB80012", border:"1px solid #FFB80030", borderRadius:12, padding:"14px 16px", marginBottom:14 }}>
                  <div style={{ fontSize:13, color:"#FFB800", fontWeight:700, marginBottom:6 }}>
                    {agent.trial_extended
                      ? `✅ Bonus utilisé — ${agent.referral_count||0} ami(s) inscrit(s)`
                      : `👥 ${agent.referral_count||0}/1 ami inscrit — invite 1 ami pour +16 jours !`
                    }
                  </div>
                  <div style={{ fontSize:11, color:T.sub }}>
                    Partage ton lien. Dès qu'un ami s'inscrit et utilise l'app, tu gagnes automatiquement <strong style={{color:"#FFB800"}}>16 jours gratuits</strong>.
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <div style={{ flex:1, background:T.hero, borderRadius:10, padding:"10px 14px", fontSize:11, color:T.sub, wordBreak:"break-all" }}>
                    {getReferralLink(agent.telephone)}
                  </div>
                  <button onClick={()=>{ navigator.clipboard?.writeText(getReferralLink(agent.telephone)); setFlash("depot"); setTimeout(()=>setFlash(null),2000); }}
                    style={{ flexShrink:0, padding:"10px 16px", borderRadius:10, background:"#FFB80020", border:"1px solid #FFB80050", color:"#FFB800", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                    📋 Copier
                  </button>
                </div>
                <button onClick={()=>{ const url = getReferralLink(agent.telephone); const text = `📱 J'utilise Mon Point pour gérer mon point MoMo — c'est trop pratique ! Essaie gratuitement : ${url}`; window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank"); }}
                  style={{ width:"100%", marginTop:10, padding:12, borderRadius:12, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <span>📤</span> Partager via WhatsApp
                </button>
              </div>

              {/* Données offline */}
              <div style={{ background:T.card, borderRadius:18, padding:desktop?22:18, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>💾 Synchronisation</div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:12 }}>Tes données sont sauvegardées sur Supabase et synchronisées automatiquement.</div>
                {pendingCount > 0
                  ? <div style={{ background:"#FFB80018", border:"1px solid #FFB80040", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#FFB800", fontWeight:700 }}>⚡ {pendingCount} opération(s) en attente</div>
                  : <div style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#00C896", fontWeight:700 }}>✅ Toutes les données sont synchronisées</div>
                }
              </div>

              {/* Thème */}
              <div style={{ background:T.card, borderRadius:18, padding:desktop?22:18, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>⚙️ Préférences</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{dark?"Mode sombre":"Mode clair"}</div>
                    <div style={{ fontSize:11, color:T.sub }}>Changer l'apparence</div>
                  </div>
                  <button onClick={()=>setDark(d=>!d)} style={{ padding:"9px 18px", borderRadius:10, background:T.hero, border:`1px solid ${T.border}`, color:T.text, fontSize:13, fontWeight:700, cursor:"pointer" }}>
                    {dark?"☀️ Clair":"🌙 Sombre"}
                  </button>
                </div>
              </div>

              <button onClick={()=>setConfirmLogout(true)} style={{ width:"100%", padding:17, borderRadius:15, background:"#E6394618", border:"2px solid #E6394640", color:"#E63946", fontWeight:800, fontSize:15, cursor:"pointer" }}>
                🔓 Se déconnecter
              </button>
            </div>
          )}

        </div>
      </main>

      {/* ══ FABs ════════════════════════════════════════════════════════ */}
      {!desktop && isToday && (
        <div style={{ position:"fixed", bottom:mobile?116:124, right:tablet?22:16, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
          <button onClick={()=>{setModal("retrait");setForm({});}}
            style={{ height:48, paddingLeft:16, paddingRight:18, borderRadius:24, background:"#4F8EF7", border:"none", color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 4px 18px #4F8EF760", display:"flex", alignItems:"center", gap:8, whiteSpace:"nowrap" }}>
            <span style={{ fontSize:18 }}>⬆️</span> Retrait
          </button>
          <button onClick={()=>{setModal("depot");setForm({});}}
            style={{ height:54, paddingLeft:18, paddingRight:20, borderRadius:27, background:"linear-gradient(135deg,#00C896,#009E78)", border:"none", color:"#fff", fontSize:14, fontWeight:900, cursor:"pointer", boxShadow:"0 6px 24px #00C89660", display:"flex", alignItems:"center", gap:8, whiteSpace:"nowrap" }}>
            <span style={{ fontSize:20 }}>⬇️</span> Dépôt
          </button>
        </div>
      )}

      {/* ══ BOTTOM NAV ══════════════════════════════════════════════════ */}
      {!desktop && (
        <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.nav, borderTop:`1px solid ${T.border}`, zIndex:50 }}>
          <div style={{ display:"flex", justifyContent:"space-around", padding:tablet?"10px 0 14px":"8px 0 12px" }}>
            {NAV_ITEMS.map(([key,icon,label])=>(
              <button key={key} onClick={()=>setTab(key)} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.faint, fontSize:tablet?11:10, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:tablet?"0 18px":"0 12px", WebkitTapHighlightColor:"transparent" }}>
                <span style={{ fontSize:tablet?23:21 }}>{icon}</span>{label}
                {tab===key && <div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* ══ MODAL SAISIE ════════════════════════════════════════════════ */}
      {modal && (
        <div style={modalWrap} onClick={()=>setModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={modalBox}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />}
            <div style={{ fontWeight:900, fontSize:18, marginBottom:18 }}>
              {modal==="depot"?"⬇️ Nouveau Dépôt":"⬆️ Nouveau Retrait"}
            </div>

            {modal==="retrait" && (
              <div style={{ marginBottom:16 }}>
                {form.montant && Number(form.montant)>=100 ? (()=>{
                  const tranche = getTranche(form.montant);
                  const c = form.operateur ? calcComRetrait(form.operateur, form.montant) : 0;
                  return tranche ? (
                    <div style={{ background:"#4F8EF712", border:"1px solid #4F8EF735", borderRadius:14, padding:"14px 16px" }}>
                      <div style={{ fontSize:11, color:"#4F8EF7", fontWeight:700, marginBottom:10 }}>
                        📊 TRANCHE : {Number(tranche.min).toLocaleString("fr-FR")} – {Number(tranche.max).toLocaleString("fr-FR")} F
                      </div>
                      <div style={{ display:"flex", gap:8, marginBottom:form.operateur?12:0 }}>
                        {["MTN","MOOV","Celtiis"].map(op=>{
                          const sel = op===form.operateur;
                          return (
                            <div key={op} style={{ flex:1, textAlign:"center", background:sel?`${OP_COLORS[op]}20`:T.hero, border:`2px solid ${sel?OP_COLORS[op]:T.border}`, borderRadius:11, padding:"10px 4px" }}>
                              <div style={{ fontSize:10, color:OP_COLORS[op], fontWeight:800, marginBottom:4 }}>{op}</div>
                              <div style={{ fontSize:15, fontWeight:900, color:sel?OP_COLORS[op]:T.text }}>{fF(tranche[op])}</div>
                              {sel && <div style={{ fontSize:9, color:OP_COLORS[op], marginTop:2, fontWeight:700 }}>✓ sélectionné</div>}
                            </div>
                          );
                        })}
                      </div>
                      {form.operateur && (
                        <div style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontSize:12, color:T.sub }}>💰 Ta commission</span>
                          <span style={{ fontSize:18, fontWeight:900, color:"#00C896" }}>{fF(c)}</span>
                        </div>
                      )}
                    </div>
                  ) : <div style={{ background:"#E6394612", border:"1px solid #E6394635", borderRadius:12, padding:"12px 14px", fontSize:13, color:"#E63946", fontWeight:700 }}>⚠️ Montant hors grille (100 F – 2 000 000 F)</div>;
                })() : (
                  <div style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:12, padding:"12px 16px", fontSize:12, color:T.sub }}>
                    💡 Entre le montant pour voir la commission automatiquement
                  </div>
                )}
              </div>
            )}

            {modal==="depot" && (
              <div style={{ background:"#00C89610", border:"1px solid #00C89625", borderRadius:12, padding:"11px 14px", marginBottom:16, fontSize:12, color:"#00C896", display:"flex", alignItems:"center", gap:8 }}>
                <span>ℹ️</span><span>Aucune commission sur les dépôts.</span>
              </div>
            )}

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>OPÉRATEUR</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPERATORS.map(op=>(
                  <button key={op} onClick={()=>setForm(f=>({...f,operateur:op,montant:""}))}
                    style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?OP_BG[op]:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:14, cursor:"pointer" }}>
                    {op}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>MONTANT (FCFA)</div>
              <input type="number" placeholder="Ex : 5000" value={form.montant||""} onChange={e=>setForm(f=>({...f,montant:e.target.value}))}
                style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:20, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
            </div>

            <div style={{ marginBottom:22 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>NUMÉRO DE TÉLÉPHONE (optionnel)</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 10px", color:T.text, fontSize:12, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
                <input type="tel" placeholder="97 00 00 00" value={form.telephone||""} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))}
                  style={{ flex:1, background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 14px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>

            <button onClick={addTx} disabled={saving}
              style={{ width:"100%", padding:17, borderRadius:14, background:saving?"#1A1D2E":modal==="depot"?"#00C896":"#4F8EF7", border:"none", color:saving?T.sub:"#fff", fontWeight:900, fontSize:16, cursor:saving?"not-allowed":"pointer" }}>
              {saving?"⏳ Sauvegarde…":"Enregistrer ✓"}
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL CALENDRIER ════════════════════════════════════════════ */}
      {showCal && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:desktop?"center":"flex-end", justifyContent:desktop?"center":"stretch", zIndex:300 }} onClick={()=>setShowCal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:desktop?"20px":"22px 22px 0 0", padding:"20px 18px 36px", border:`1px solid ${T.border2}`, width:desktop?380:"100%", maxWidth:desktop?380:"100%" }}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <button onClick={()=>{if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>‹</button>
              <div style={{ fontWeight:800, fontSize:15 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
              <button onClick={()=>{if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{ background:T.hero, border:"none", borderRadius:9, width:36, height:36, cursor:"pointer", fontSize:18, color:T.text }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:8 }}>
              {JOURS.map(j=>(<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"4px 0" }}>{j}</div>))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array(getFirstDay(calYear,calMonth)).fill(null).map((_,i)=>(<div key={`e${i}`}/>))}
              {Array(getDaysInMonth(calYear,calMonth)).fill(null).map((_,i)=>{
                const day=i+1, ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isTod=ds===todayStr(), isSel=ds===selectedDate, has=activeDays.includes(ds), isFut=ds>todayStr();
                return (
                  <button key={day} disabled={isFut} onClick={()=>{setSelectedDate(ds);setShowCal(false);setTab("accueil");}}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:10, border:isSel?"2px solid #00C896":isTod?`2px solid ${OP_COLORS.MTN}`:`1px solid ${T.border}`, background:isSel?"#00C89620":isTod?"#FFB80015":T.hero, color:isFut?T.faint:isSel?"#00C896":T.text, fontWeight:isSel||isTod?800:500, fontSize:13, cursor:isFut?"not-allowed":"pointer", position:"relative", display:"flex", alignItems:"center", justifyContent:"center", opacity:isFut?0.3:1 }}>
                    {day}
                    {has&&!isSel&&<div style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:3, height:3, borderRadius:"50%", background:"#00C896" }}/>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ CONFIRM SUPPRESSION ════════════════════════════════════════ */}
      {confirm && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:24 }}>
          <div style={{ background:T.card, borderRadius:20, padding:26, width:"100%", maxWidth:320, border:`1px solid ${T.border2}` }}>
            <div style={{ fontSize:18, fontWeight:900, marginBottom:8 }}>🗑️ Supprimer ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:22 }}>Cette opération sera effacée définitivement.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirm(null)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={()=>removeTx(confirm)} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ CONFIRM DÉCONNEXION ════════════════════════════════════════ */}
      {confirmLogout && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
          <div style={{ background:T.card, borderRadius:22, padding:30, width:"100%", maxWidth:340, border:`1px solid ${T.border2}`, textAlign:"center" }}>
            <div style={{ fontSize:44, marginBottom:14 }}>🔓</div>
            <div style={{ fontSize:19, fontWeight:900, marginBottom:8 }}>Se déconnecter ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:26 }}>Tes données restent sauvegardées sur le serveur.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirmLogout(false)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={handleLogout} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Déconnexion</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL FLOAT / SOLDE DE DÉPART ══════════════════════════════ */}
      {showFloatModal && (
        <div style={{ position:"fixed", inset:0, background:"#000D", display:"flex", alignItems:desktop?"center":"flex-end", justifyContent:desktop?"center":"stretch", zIndex:600 }}
          onClick={()=>setShowFloatModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:desktop?"20px":"22px 22px 0 0", padding:"22px 20px 40px", width:desktop?420:"100%", border:`1px solid #7B2FBE40` }}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />}

            <div style={{ fontWeight:900, fontSize:18, marginBottom:4 }}>💼 Solde de départ</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>
              Entre le montant d'unités disponible ce matin pour chaque opérateur.
            </div>

            {/* Sélecteur opérateur */}
            {floatEditOp === null && (
              <div style={{ marginBottom:18 }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:10 }}>CHOISIR UN OPÉRATEUR</div>
                <div style={{ display:"flex", gap:8 }}>
                  {OPERATORS.map(op => (
                    <button key={op} onClick={()=>{ setFloatEditOp(op); setFloatInput(floats[op]!==null?String(floats[op]):""); }}
                      style={{ flex:1, padding:"14px 0", borderRadius:12, border:`2px solid ${OP_COLORS[op]}50`, background:`${OP_COLORS[op]}18`, color:OP_COLORS[op], fontWeight:800, fontSize:13, cursor:"pointer" }}>
                      {op}
                      {floats[op] !== null && <div style={{ fontSize:9, marginTop:3, opacity:0.8 }}>{fF(floats[op])}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Saisie montant pour l'opérateur sélectionné */}
            {floatEditOp !== null && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
                  <button onClick={()=>{ setFloatEditOp(null); setFloatInput(""); }}
                    style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:9, padding:"7px 12px", color:T.sub, fontSize:12, cursor:"pointer" }}>← Retour</button>
                  <div style={{ fontWeight:800, fontSize:15, color:OP_COLORS[floatEditOp] }}>Solde de départ {floatEditOp}</div>
                </div>

                <div style={{ background:`${OP_COLORS[floatEditOp]}12`, border:`1px solid ${OP_COLORS[floatEditOp]}30`, borderRadius:12, padding:"12px 16px", marginBottom:16, fontSize:12, color:T.sub }}>
                  💡 C'est le montant d'unités sur ton compte <strong style={{color:OP_COLORS[floatEditOp]}}>{floatEditOp}</strong> ce matin avant toute opération.
                </div>

                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>SOLDE DE DÉPART (FCFA)</div>
                  <input
                    type="number"
                    placeholder="Ex : 150 000"
                    value={floatInput}
                    onChange={e => setFloatInput(e.target.value)}
                    autoFocus
                    style={{ width:"100%", background:T.input, border:`2px solid ${OP_COLORS[floatEditOp]}`, borderRadius:12, padding:"16px", color:T.text, fontSize:22, fontWeight:800, outline:"none", boxSizing:"border-box", textAlign:"center" }}
                  />
                </div>

                {/* Touches rapides */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:18 }}>
                  {[25000, 50000, 100000, 200000].map(v => (
                    <button key={v} onClick={()=>setFloatInput(String(v))}
                      style={{ padding:"9px 0", borderRadius:9, border:`1px solid ${OP_COLORS[floatEditOp]}30`, background:`${OP_COLORS[floatEditOp]}12`, color:OP_COLORS[floatEditOp], fontWeight:700, fontSize:11, cursor:"pointer" }}>
                      {v >= 1000 ? `${v/1000}k` : v}
                    </button>
                  ))}
                </div>

                <button
                  onClick={()=>{
                    if (!floatInput || isNaN(Number(floatInput))) return;
                    saveFloat(floatEditOp, floatInput);
                    setFloatEditOp(null);
                    setFloatInput("");
                    setShowFloatModal(false);
                  }}
                  disabled={!floatInput || isNaN(Number(floatInput))}
                  style={{ width:"100%", padding:16, borderRadius:14, background: !floatInput?"#1A1D2E":`linear-gradient(135deg,${OP_COLORS[floatEditOp]},${OP_COLORS[floatEditOp]}CC)`, border:"none", color: !floatInput?T.sub:"#fff", fontWeight:900, fontSize:15, cursor: !floatInput?"not-allowed":"pointer" }}>
                  ✅ Enregistrer le float {floatEditOp}
                </button>
              </>
            )}

            {/* Résumé des floats déjà définis */}
            {floatEditOp === null && OPERATORS.some(op => floats[op] !== null) && (
              <div style={{ marginTop:16, background:T.hero, borderRadius:12, padding:"14px 16px" }}>
                <div style={{ fontSize:11, color:T.sub, fontWeight:700, marginBottom:10, letterSpacing:1 }}>RÉSUMÉ DU JOUR</div>
                {OPERATORS.map(op => {
                  const actuel = calcFloatActuel(op);
                  if (floats[op] === null) return null;
                  const color = getFloatColor(actuel, floats[op]);
                  return (
                    <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{ fontSize:12, color:OP_COLORS[op], fontWeight:700 }}>{op}</span>
                      <div style={{ textAlign:"right" }}>
                        <span style={{ fontSize:13, fontWeight:900, color }}>{fF(actuel)}</span>
                        <span style={{ fontSize:10, color:T.sub }}> / {fF(floats[op])}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  </>);
}
