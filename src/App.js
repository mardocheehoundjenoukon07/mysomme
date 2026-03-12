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
const floatKey  = (date, uid) => `ms_float_${uid}_${date}`;
const cashKey   = (date, uid) => `ms_cash_${uid}_${date}`;

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
// ─── CONSTANTES APP ──────────────────────────────────────────────────────────
const OPERATORS   = ["MTN","MOOV","Celtiis"];
const OP_COLORS   = { MTN:"#FFB800", MOOV:"#0066CC", Celtiis:"#E63946" };
const OP_BG       = { MTN:"#FFB80018", MOOV:"#0066CC18", Celtiis:"#E6394618" };
const OP_BG_D     = { MTN:"#FFB80028", MOOV:"#0066CC28", Celtiis:"#E6394628" };
const NAV_ITEMS   = [["accueil","🏠","Accueil"],["stats","📊","Statistiques"],["historique","🗂️","Historique"]];
const TYPE_COLOR  = { depot:"#00C896", retrait:"#4F8EF7" };
const TYPE_ICON   = { depot:"⬇️", retrait:"⬆️" };
const TYPE_LABEL  = { depot:"Dépôt", retrait:"Retrait" };
const fF = n => Number(n||0).toLocaleString("fr-FR")+" F";
function getSalutation(nom) {
  const h = new Date().getHours();
  const p = nom.split(" ")[0];
  if(h<12) return `Bonjour, ${p} 👋`;
  if(h<18) return `Bon après-midi, ${p} 👋`;
  return `Bonsoir, ${p} 👋`;
}
function useWindowWidth() {
  const [w, setW] = React.useState(window.innerWidth);
  React.useEffect(()=>{
    const fn = ()=>setW(window.innerWidth);
    window.addEventListener("resize",fn);
    return ()=>window.removeEventListener("resize",fn);
  },[]);
  return w;
}




function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin, setPin] = React.useState("");
  function add(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) { setTimeout(() => { onSubmit(next); setPin(""); }, 150); }
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ fontWeight:900, fontSize:22, marginBottom:8, color:T.text }}>{title}</div>
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
  const [step,    setStep]    = useState(1); // 1=form, 2=pin-create, 3=pin-confirm
  const [form,    setForm]    = useState({ nom:"", telephone:"", reseau:"MTN" });
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [loginBlocked,  setLoginBlocked]  = useState(false);
  const w = useWindowWidth();

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", display:"block" };

  // ── INSCRIPTION : étape 1 → vérif numéro puis PIN ──
  async function handleRegisterStep1() {
    if (!form.nom.trim()) { setError("Entre ton nom complet"); return; }
    if (!form.telephone.trim() || form.telephone.length < 8) { setError("Entre un numéro valide (8 chiffres)"); return; }
    setLoading(true); setError("");
    const existing = await fetchAgent(form.telephone);
    setLoading(false);
    if (existing) { setError("Ce numéro a déjà un compte. Connecte-toi."); return; }
    setStep(2);
  }

  // ── INSCRIPTION : création PIN ──
  function handlePinCreate(p) { setPin(p); setStep(3); }

  // ── INSCRIPTION : confirmation PIN → sauvegarder ──
  async function handlePinConfirm(p) {
    if (p !== pin) { setError("Les codes PIN ne correspondent pas."); setStep(2); setPin(""); return; }
    setLoading(true);
    const pinHash = await hashPin(p);
    const agent = {
      nom: form.nom.trim(), telephone: form.telephone.trim(),
      reseau: form.reseau, pin: pinHash,
      trial_days: 14,
      trial_extended: false,
      subscription_status: "trial",
      created_at: nowISO(), trial_start: nowISO()
    };
    const saved = await saveAgent(agent);
    const fresh = await fetchAgent(agent.telephone);
    const trusted = fresh ? { ...fresh, pin: pinHash } : { ...(saved||agent), pin: pinHash };
    lsSet("ms_agent", trusted);
    setLoading(false);
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
    if (loginBlocked) { setError("🔒 Trop de tentatives. Réessaie dans 5 minutes."); return; }
    const agent = lsGet("ms_agent");
    const pinHash = await hashPin(p);
    if (pinHash === agent?.pin) {
      onDone(agent); setLoginAttempts(0);
    } else {
      const n = loginAttempts + 1; setLoginAttempts(n);
      if (n >= 3) {
        setLoginBlocked(true);
        setError("🔒 3 tentatives échouées — bloqué 5 minutes.");
        setTimeout(()=>{ setLoginBlocked(false); setLoginAttempts(0); setError(""); }, 5*60*1000);
      } else {
        setError(`Code PIN incorrect. ${3-n} tentative${3-n>1?"s":""} restante${3-n>1?"s":""}.`);
      }
    }
  }

  if (step===2)  return <PinPad title="Crée ton PIN 🔐" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={handlePinCreate} T={T} />;
  if (step===3)  return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePinConfirm} T={T} error={error} />;
  if (step===10) return <PinPad title="Bon retour 👋" subtitle="Entre ton code PIN" onSubmit={handlePinLogin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:w>=640?40:24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:30 }}>
          <svg width="58" height="58" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:14,filter:"drop-shadow(0 6px 26px #00C89640)"}}>
            <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_ins)"/>
            <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
            <defs>
              <linearGradient id="msgrad_ins" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00C896"/>
                <stop offset="50%" stopColor="#00A5FF"/>
                <stop offset="100%" stopColor="#7B2FBE"/>
              </linearGradient>
            </defs>
          </svg>
          <div style={{ fontWeight:900, fontSize:28, marginBottom:4, color:T.text }}>Mon Point</div>
          <div style={{ fontSize:13, color:T.sub, textAlign:"center" }}>
            {mode==="register" ? "Ton cahier MoMo numérique 🇧🇯" : "Reconnecte-toi à ton espace"}
          </div>
        </div>

        <div style={{ display:"flex", background:T.hero, borderRadius:13, padding:4, marginBottom:26, border:`1px solid ${T.border}` }}>
          {[["register","Nouveau compte"],["login","Se connecter"]].map(([m,label])=>(
            <button key={m} onClick={()=>{setMode(m);setStep(1);setError("");}}
              style={{ flex:1, padding:"11px 0", borderRadius:10, border:"none", background:mode===m?"linear-gradient(135deg,#00C896,#00A5FF)":"transparent", color:mode===m?"#fff":T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>

        {mode==="register" && step===1 && (<>
          <div style={{ marginBottom:13 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NOM COMPLET</div>
            <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} autoFocus />
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO DE TÉLÉPHONE</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"")}))} style={{ ...inp, flex:1 }} />
            </div>
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
            🎁 <strong>2 mois d'essai gratuit</strong> — aucune carte bancaire requise
          </div>
          <button onClick={handleRegisterStep1} disabled={loading}
            style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading?"⏳ Vérification...":"Créer mon compte →"}
          </button>
        </>)}

        {mode==="login" && step===1 && (<>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, color:T.sub, marginBottom:7, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO DE TÉLÉPHONE</div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ ...inp, flexShrink:0, width:"auto", padding:"14px 12px", fontWeight:700, fontSize:13 }}>🇧🇯 +229</div>
              <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value.replace(/\D/g,"")}))} style={{ ...inp, flex:1 }} />
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
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_pay" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00C896"/>
      <stop offset="50%" stopColor="#00A5FF"/>
      <stop offset="100%" stopColor="#7B2FBE"/>
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
          <button onClick={()=>{ navigator.clipboard?.writeText(`https://monpoint.site?ref=${agent.telephone}`); alert("Lien copié !"); }}
            style={{ width:"100%", padding:"9px 0", borderRadius:10, background:"#FFB80020", border:"1px solid #FFB80050", color:"#FFB800", fontWeight:700, fontSize:12, cursor:"pointer" }}>

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
  const [showReport,    setShowReport]    = useState(false);
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
  const [capitalCash,   setCapitalCash]   = useState(null);
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashInput,     setCashInput]     = useState("");
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
          <stop offset="0%" stopColor="#00C896"/>
          <stop offset="50%" stopColor="#00A5FF"/>
          <stop offset="100%" stopColor="#7B2FBE"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="48" height="48" rx="14" fill="url(#fg)"/>
      <path d="M11 37 L11 17 L26 29 L41 17 L41 37" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
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
      heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
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
    const storedCash = lsGet(cashKey(date, agent.telephone));
    setCapitalCash(storedCash !== null && storedCash !== undefined ? Number(storedCash) : null);
  }

  function saveFloat(op, solde) {
    const updated = { ...floats, [op]: Number(solde) };
    setFloats(updated);
    lsSet(floatKey(selectedDate, agent.telephone), updated);
  }

  function calcCashActuel() {
    if (capitalCash === null) return null;
    const depots   = txs.filter(t=>t.type==="depot")   .reduce((s,t)=>s+Number(t.montant),0);
    const retraits = txs.filter(t=>t.type==="retrait") .reduce((s,t)=>s+Number(t.montant),0);
    // Dépôt    → cash monte  (client apporte cash)
    // Retrait  → cash descend (agent donne cash)
    return capitalCash + depots - retraits + unites;
  }

  function calcFloatActuel(op) {
    if (floats[op] === null || floats[op] === undefined) return null;
    const depots   = txs.filter(t=>t.operateur===op&&t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
    const retraits = txs.filter(t=>t.operateur===op&&t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
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

  function shareReport() { setShowReport(true); }

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
          ✅ {TYPE_LABEL[flash]||"Opération"} enregistrée !
        </div>
      )}




      {/* ══ SIDEBAR DESKTOP ═════════════════════════════════════════════ */}
      {desktop && (
        <aside style={{ position:"fixed", top:0, left:0, width:240, height:"100vh", background:T.sidebar, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"22px 20px 20px", borderBottom:`1px solid ${T.border}` }}>
            <svg width="42" height="42" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
  <rect x="4" y="4" width="44" height="44" rx="14" fill="url(#msgrad_sb)"/>
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad_sb" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00C896"/>
      <stop offset="50%" stopColor="#00A5FF"/>
      <stop offset="100%" stopColor="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:15 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>Agent mobile money 🇧🇯</div>
            </div>
          </div>

          {/* Bannière essai desktop — fixe */}
          <div style={{ margin:"12px 14px 0", background:"#00C89612", border:"1px solid #00C89630", borderRadius:11, padding:"10px 14px", textAlign:"center" }}>
            <div style={{ fontSize:11, color:"#00C896", fontWeight:800 }}>🎁 2 mois d'essai gratuit</div>
          </div>

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
  <path d="M12 36 L12 18 L26 29 L40 18 L40 36" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  <circle cx="26" cy="40" r="3" fill="white" opacity="0.95"/>
  <defs>
    <linearGradient id="msgrad2" x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00C896"/>
      <stop offset="50%" stopColor="#00A5FF"/>
      <stop offset="100%" stopColor="#7B2FBE"/>
    </linearGradient>
  </defs>
</svg>
            <div>
              <div style={{ fontWeight:900, fontSize:16 }}>Mon Point</div>
              <div style={{ fontSize:10, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>


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

          

          {/* Bandeau date passée */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", borderRadius:12, padding:"10px 16px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 14px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          {/* ══ ACCUEIL ══ */}
          {tab==="accueil" && (<>

            {/* ══ CARTE CAPITAL CASH ══ */}
            {(()=>{
              const cashActuel = calcCashActuel();
              const cashPct = capitalCash > 0 && cashActuel !== null ? Math.max(0, Math.min(100, (cashActuel / capitalCash) * 100)) : 0;
              const cashColor = cashActuel === null ? T.sub : cashActuel < 0 ? "#E63946" : cashActuel / (capitalCash||1) < 0.2 ? "#FFB800" : "#00C896";
              const depTotaux   = txs.filter(t=>t.type==="depot")  .reduce((s,t)=>s+Number(t.montant),0);
              const retTotaux = txs.filter(t=>t.type==="retrait").reduce((s,t)=>s+Number(t.montant),0);
              return (
                <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #00C89630` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    <div>
                      <div style={{ fontWeight:800, fontSize:14 }}>💵 Capital Cash</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Argent liquide disponible</div>
                    </div>
                    {isToday && (
                      <button onClick={()=>{setCashInput(capitalCash!==null?String(capitalCash):"");setShowCashModal(true);}}
                        style={{ background:"#00C89618", border:"1px solid #00C89640", borderRadius:9, padding:"6px 14px", color:"#00C896", fontSize:11, fontWeight:800, cursor:"pointer" }}>
                        {capitalCash===null ? "+ Définir" : "✏️ Modifier"}
                      </button>
                    )}
                  </div>

                  {capitalCash === null ? (
                    <div style={{ textAlign:"center", padding:"12px 0", color:T.faint, fontSize:13 }}>
                      Entre ton capital cash du matin pour suivre ta liquidité
                    </div>
                  ) : (
                    <>
                      {/* Montant principal */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
                        <div>
                          <div style={{ fontSize:11, color:T.sub }}>Départ</div>
                          <div style={{ fontSize:15, fontWeight:700, color:T.sub }}>{fF(capitalCash)}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:11, color:T.sub }}>Disponible maintenant</div>
                          <div style={{ fontSize:26, fontWeight:900, color:cashColor }}>{fF(cashActuel)}</div>
                        </div>
                      </div>

                      {/* Barre de progression */}
                      <div style={{ height:6, background:T.faint, borderRadius:3, overflow:"hidden", marginBottom:10 }}>
                        <div style={{ height:"100%", width:`${cashPct}%`, background:cashColor, borderRadius:3, transition:"width 0.4s ease" }} />
                      </div>

                      {/* Détail +/- */}
                      <div style={{ display:"flex", gap:8 }}>
                        {depTotaux > 0 && <div style={{ flex:1, background:"#00C89610", border:"1px solid #00C89625", borderRadius:8, padding:"6px 10px", fontSize:11 }}>
                          <span style={{ color:T.sub }}>⬇️ Dépôts </span><span style={{ color:"#00C896", fontWeight:800 }}>+{fF(depTotaux)}</span>
                        </div>}
                        {retTotaux > 0 && <div style={{ flex:1, background:"#E6394610", border:"1px solid #E6394625", borderRadius:8, padding:"6px 10px", fontSize:11 }}>
                          <span style={{ color:T.sub }}>⬆️ Retraits </span><span style={{ color:"#E63946", fontWeight:800 }}>-{fF(retTotaux)}</span>
                        </div>}
                        </div>}
                      </div>

                      {/* Alertes */}
                      {cashActuel < 0 && <div style={{ marginTop:8, background:"#E6394620", border:"1px solid #E6394650", borderRadius:8, padding:"6px 12px", fontSize:11, color:"#E63946", fontWeight:800 }}>🚨 Cash insuffisant ! Tu dois {fF(Math.abs(cashActuel))} de plus</div>}
                      {cashActuel >= 0 && cashActuel / (capitalCash||1) < 0.2 && <div style={{ marginTop:8, background:"#FFB80015", border:"1px solid #FFB80035", borderRadius:8, padding:"6px 12px", fontSize:11, color:"#FFB800", fontWeight:700 }}>⚠️ Cash faible — pense à te réapprovisionner</div>}
                    </>
                  )}
                </div>
              );
            })()}

          {/* ══ CARTE SOLDE DE DÉPART ══ */}
            <div style={{ background:T.card, borderRadius:16, padding:desktop?22:18, marginBottom:14, border:`1px solid #7B2FBE30` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:800, fontSize:14 }}>💼 Solde de départ du jour</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>Solde électronique par réseau</div>
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

            {/* ══ MODAL RAPPORT ══ */}
      {showReport && (()=>{
        const dateLabel = new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
        const txArgent  = txs;
        const floatLines = OPERATORS.map(op=>{
          const actuel = calcFloatActuel(op);
          if(actuel===null) return null;
          return {op, actuel};
        }).filter(Boolean);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowReport(false)}>
            <div style={{ background:"#fff", borderRadius:20, padding:24, maxWidth:400, width:"100%", maxHeight:"90vh", overflowY:"auto", color:"#111" }} onClick={e=>e.stopPropagation()}>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div>
                  <div style={{ fontWeight:900, fontSize:16, color:"#111" }}>📊 Point du jour</div>
                  <div style={{ fontSize:12, color:"#666", marginTop:2 }}>{dateLabel}</div>
                </div>
                <button onClick={()=>setShowReport(false)} style={{ background:"#f0f0f0", border:"none", borderRadius:20, width:32, height:32, cursor:"pointer", fontSize:16 }}>✕</button>
              </div>

              {/* Agent */}
              <div style={{ background:"#f8f8f8", borderRadius:12, padding:"10px 14px", marginBottom:16, fontSize:13 }}>
                👤 <strong>{agent.nom}</strong> — {agent.reseau} — {agent.telephone}
              </div>

              {/* Séparateur ARGENT */}
              <div style={{ fontWeight:900, fontSize:13, color:"#00C896", borderBottom:"2px solid #00C89630", paddingBottom:6, marginBottom:12 }}>💵 TRANSACTIONS ARGENT</div>
              {OPERATORS.map(op=>{
                const deps = txArgent.filter(t=>t.type==="depot"&&t.operateur===op);
                const rets = txArgent.filter(t=>t.type==="retrait"&&t.operateur===op);
                if(deps.length===0&&rets.length===0) return null;
                return (
                  <div key={op} style={{ marginBottom:12, background:"#f8f8f8", borderRadius:10, padding:"10px 14px" }}>
                    <div style={{ fontWeight:800, fontSize:13, marginBottom:6, color:"#333" }}>{op}</div>
                    {deps.length>0&&<div style={{ fontSize:13, marginBottom:3 }}>⬇️ Dépôts : <strong>{deps.length} op — {fF(deps.reduce((s,t)=>s+Number(t.montant),0))}</strong> <span style={{color:"#888",fontSize:11}}>comm. {fF(deps.reduce((s,t)=>s+Number(t.commission),0))}</span></div>}
                    {rets.length>0&&<div style={{ fontSize:13 }}>⬆️ Retraits : <strong>{rets.length} op — {fF(rets.reduce((s,t)=>s+Number(t.montant),0))}</strong> <span style={{color:"#888",fontSize:11}}>comm. {fF(rets.reduce((s,t)=>s+Number(t.commission),0))}</span></div>}
                  </div>
                );
              })}
              <div style={{ display:"flex", gap:10, marginBottom:16 }}>
                <div style={{ flex:1, background:"#00C89615", borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:11, color:"#666" }}>CA Total</div>
                  <div style={{ fontWeight:900, fontSize:18, color:"#00C896" }}>{fF(totalCA)}</div>
                </div>
                <div style={{ flex:1, background:"#FFB80015", borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:11, color:"#666" }}>Commission</div>
                  <div style={{ fontWeight:900, fontSize:18, color:"#FFB800" }}>{fF(totalCom)}</div>
                </div>
              </div>

              {/* Soldes float */}
              {floatLines.length>0&&<>
              <div style={{ fontWeight:900, fontSize:13, color:"#4F8EF7", borderBottom:"2px solid #4F8EF730", paddingBottom:6, marginBottom:12, marginTop:4 }}>💼 SOLDES</div>
              {floatLines.map(({op,actuel})=>(
                <div key={op} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:13, borderBottom:`1px solid #eee` }}>
                  <span>{op}</span><strong>{fF(actuel)}</strong>
                </div>
              ))}
              </>}

              {/* Footer */}
              <div style={{ marginTop:16, fontSize:11, color:"#aaa", textAlign:"center" }}>Généré par Mon Point · {new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>

              {/* Bouton partager */}
              <button onClick={()=>{
                const dateLabel2 = new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
                let txt = `📊 *POINT DU JOUR — ${dateLabel2.toUpperCase()}*
👤 ${agent.nom} | ${agent.reseau}

`;
                txt += `💵 *TRANSACTIONS ARGENT*
                const cashFinal = calcCashActuel();
                if(cashFinal !== null) txt += `💵 Cash départ : ${fF(capitalCash)} → Disponible : ${fF(cashFinal)}\n`;
`;
                OPERATORS.forEach(op=>{
                  const deps=txArgent.filter(t=>t.type==="depot"&&t.operateur===op);
                  const rets=txArgent.filter(t=>t.type==="retrait"&&t.operateur===op);
                  if(deps.length||rets.length){
                    txt+=`
▪️ ${op}
`;
                    if(deps.length) txt+=`  ⬇️ Dépôts: ${deps.length} op · ${fF(deps.reduce((s,t)=>s+Number(t.montant),0))} · comm. ${fF(deps.reduce((s,t)=>s+Number(t.commission),0))}
`;
                    if(rets.length) txt+=`  ⬆️ Retraits: ${rets.length} op · ${fF(rets.reduce((s,t)=>s+Number(t.montant),0))} · comm. ${fF(rets.reduce((s,t)=>s+Number(t.commission),0))}
`;
                  }
                });
                txt+=`
💰 CA Total: ${fF(totalCA)} | ✅ Commission: ${fF(totalCom)}
                txt+=`
_Mon Point_`;
                window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`,"_blank");
              }} style={{ width:"100%", marginTop:12, padding:14, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:900, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                <span style={{fontSize:18}}>📤</span> Partager sur WhatsApp
              </button>
            </div>
          </div>
        );
      })()}

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

      {/* ══ MODAL CAPITAL CASH ══ */}
      {showCashModal && (
        <div style={{ position:"fixed", inset:0, background:"#000D", display:"flex", alignItems:desktop?"center":"flex-end", justifyContent:desktop?"center":"stretch", zIndex:600 }}
          onClick={()=>setShowCashModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:desktop?"20px":"22px 22px 0 0", padding:"22px 20px 40px", width:desktop?420:"100%", border:`1px solid #00C89640` }}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />}

            <div style={{ fontWeight:900, fontSize:18, marginBottom:4 }}>💵 Capital Cash du matin</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>
              L'argent liquide total que tu as en main ce matin pour toutes tes opérations.
            </div>
            <div style={{ background:"#00C89612", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", marginBottom:18, fontSize:12, color:"#00C896" }}>
              💡 Ce montant est commun pour MTN + MOOV + CELTIIS. Les dépôts le font monter, les retraits le font descendre.
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.sub, fontWeight:700, letterSpacing:1, marginBottom:8 }}>CAPITAL CASH (FCFA)</div>
              <input
                type="number"
                placeholder="Ex : 500 000"
                value={cashInput}
                onChange={e=>setCashInput(e.target.value)}
                autoFocus
                style={{ width:"100%", background:T.input, border:`2px solid #00C896`, borderRadius:12, padding:"16px", color:T.text, fontSize:22, fontWeight:800, outline:"none", boxSizing:"border-box", textAlign:"center" }}
              />
            </div>

            {/* Touches rapides */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:18 }}>
              {[100000, 200000, 300000, 500000].map(v=>(
                <button key={v} onClick={()=>setCashInput(String(v))}
                  style={{ padding:"9px 0", borderRadius:9, border:`1px solid #00C89630`, background:"#00C89612", color:"#00C896", fontWeight:700, fontSize:11, cursor:"pointer" }}>
                  {v>=1000?`${v/1000}k`:v}
                </button>
              ))}
            </div>

            <button onClick={()=>{
              if (!cashInput || isNaN(Number(cashInput))) return;
              const val = Number(cashInput);
              setCapitalCash(val);
              lsSet(cashKey(selectedDate, agent.telephone), val);
              setShowCashModal(false);
              setCashInput("");
            }} style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:15, cursor:"pointer" }}>
              ✅ Enregistrer le capital cash
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL FLOAT / SOLDE DE DÉPART ══════════════════════════════ */}
      {showFloatModal && (
        <div style={{ position:"fixed", inset:0, background:"#000D", display:"flex", alignItems:desktop?"center":"flex-end", justifyContent:desktop?"center":"stretch", zIndex:600 }}
          onClick={()=>setShowFloatModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius:desktop?"20px":"22px 22px 0 0", padding:"22px 20px 40px", width:desktop?420:"100%", border:`1px solid #7B2FBE40` }}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 18px" }} />}

            <div style={{ fontWeight:900, fontSize:18, marginBottom:4 }}>💼 Solde de départ du jour</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>
              Entre le solde électronique de départ ce matin pour chaque réseau.
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
                  💡 C'est le solde électronique sur ton compte <strong style={{color:OP_COLORS[floatEditOp]}}>{floatEditOp}</strong> ce matin avant toute opération.
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
