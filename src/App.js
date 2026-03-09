import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE ───────────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";
const H = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };

// ─── OFFLINE CACHE ───────────────────────────────────────────────────────────
function lsGet(key)     { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(key, v)  { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function lsDel(key)     { try { localStorage.removeItem(key); } catch {} }

const txKey   = (date, uid) => `ms_txs_${uid}_${date}`;
const pendKey = (uid)       => `ms_pend_${uid}`;

async function fetchTxsByDate(dateStr, userId) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${dateStr}T00:00:00&created_at=lt.${dateStr}T23:59:59&user_id=eq.${userId}&order=created_at.desc`, { headers: H });
    if (res.ok) { const data = await res.json(); lsSet(txKey(dateStr, userId), data); return data; }
  } catch {}
  return lsGet(txKey(dateStr, userId)) || [];
}

async function saveTxRemote(tx) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions`, { method: "POST", headers: H, body: JSON.stringify(tx) });
    if (res.ok) return (await res.json())[0];
  } catch {}
  return null;
}

async function deleteTx(id) {
  try { await fetch(`${SUPA_URL}/rest/v1/transactions?id=eq.${id}`, { method: "DELETE", headers: H }); } catch {}
}

async function fetchActiveDays(year, month, userId) {
  try {
    const from = `${year}-${String(month).padStart(2,"0")}-01`;
    const to   = `${year}-${String(month).padStart(2,"0")}-31`;
    const res  = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59&user_id=eq.${userId}&select=created_at`, { headers: H });
    if (!res.ok) return [];
    const data = await res.json();
    return [...new Set(data.map(t => t.created_at.slice(0,10)))];
  } catch { return []; }
}

async function saveAgent(agent) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents`, { method: "POST", headers: H, body: JSON.stringify(agent) });
    return res.ok ? (await res.json())[0] : null;
  } catch { return null; }
}

async function fetchAgent(telephone) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agents?telephone=eq.${telephone}&select=*`, { headers: H });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

async function flushPending(userId) {
  const pending = lsGet(pendKey(userId));
  if (!pending || pending.length === 0) return [];
  const synced = [];
  for (const tx of pending) {
    const saved = await saveTxRemote(tx);
    if (saved) synced.push(tx.localId);
  }
  if (synced.length > 0) {
    lsSet(pendKey(userId), pending.filter(t => !synced.includes(t.localId)));
  }
  return synced;
}

// ─── DONNÉES ────────────────────────────────────────────────────────────────
const COMMISSIONS = {
  MTN:     { depot: 0.005, retrait: 0.015, forfait: 0.07 },
  MOOV:    { depot: 0.005, retrait: 0.015, forfait: 0.07 },
  Celtiis: { depot: 0.005, retrait: 0.01,  forfait: 0.06 },
};
const FORFAITS = {
  MTN: [
    { label: "Pass Jour",  montant: 200,   data: "100 Mo",  duree: "24h" },
    { label: "Pass Hebdo", montant: 500,   data: "300 Mo",  duree: "7j"  },
    { label: "1 Go",       montant: 1000,  data: "1 Go",    duree: "30j" },
    { label: "3 Go",       montant: 2000,  data: "3 Go",    duree: "30j" },
    { label: "8 Go",       montant: 5000,  data: "8 Go",    duree: "30j" },
    { label: "20 Go",      montant: 10000, data: "20 Go",   duree: "30j" },
  ],
  MOOV: [
    { label: "Pass Jour",  montant: 200,   data: "150 Mo",  duree: "24h" },
    { label: "Pass Hebdo", montant: 500,   data: "400 Mo",  duree: "7j"  },
    { label: "1.5 Go",     montant: 1000,  data: "1.5 Go",  duree: "30j" },
    { label: "4 Go",       montant: 2000,  data: "4 Go",    duree: "30j" },
    { label: "10 Go",      montant: 5000,  data: "10 Go",   duree: "30j" },
    { label: "25 Go",      montant: 10000, data: "25 Go",   duree: "30j" },
  ],
  Celtiis: [
    { label: "50 Mo",      montant: 100,   data: "50 Mo",   duree: "24h" },
    { label: "Pass Jour",  montant: 200,   data: "120 Mo",  duree: "24h" },
    { label: "Pass Hebdo", montant: 500,   data: "350 Mo",  duree: "7j"  },
    { label: "1 Go",       montant: 1000,  data: "1 Go",    duree: "30j" },
    { label: "3 Go",       montant: 2000,  data: "3 Go",    duree: "30j" },
    { label: "8 Go",       montant: 5000,  data: "8 Go",    duree: "30j" },
  ],
};
const OPERATORS  = ["MTN", "MOOV", "Celtiis"];
const OP_COLORS  = { MTN: "#FFB800", MOOV: "#0066CC", Celtiis: "#E63946" };
const OP_BG_D    = { MTN: "#FFB80018", MOOV: "#0066CC18", Celtiis: "#E6394618" };
const OP_BG_L    = { MTN: "#FFB80025", MOOV: "#0066CC20", Celtiis: "#E6394620" };
const TYPE_COLOR = { depot: "#00C896", retrait: "#4F8EF7", forfait: "#FFB800" };
const TYPE_ICON  = { depot: "⬇️", retrait: "⬆️", forfait: "📶" };
const TYPE_LABEL = { depot: "Dépôt", retrait: "Retrait", forfait: "Forfait" };
const JOURS      = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR    = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const calcCom  = (type, op, mt) => Math.round((mt||0) * (COMMISSIONS[op]?.[type]||0));
const fF       = n => Number(n||0).toLocaleString("fr-FR") + " F";
const todayStr = () => new Date().toISOString().slice(0,10);

const DARK  = { bg:"#080A11", card:"#0F1118", border:"#1C1F2E", border2:"#22263A", text:"#E8EAF0", sub:"#4A5060", faint:"#2E3140", hero:"#151826", input:"#080A11", nav:"#0F1118", sidebar:"#0C0E17" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", nav:"#FFFFFF", sidebar:"#EAECF5" };

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 375);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── COMPOSANT PIN ───────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin, setPin] = useState("");
  const add = d => { if (pin.length < 4) { const p = pin + d; setPin(p); if (p.length === 4) setTimeout(() => onSubmit(p), 120); } };
  const del = () => setPin(p => p.slice(0,-1));
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:52, height:52, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:20, color:"#fff", marginBottom:20, boxShadow:"0 4px 20px #00C89640" }}>MS</div>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:6, textAlign:"center", color:T.text }}>{title}</div>
      <div style={{ fontSize:13, color:T.sub, marginBottom:32, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:16, marginBottom:36 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:20, height:20, borderRadius:"50%", background: pin.length > i ? "#00C896" : T.border2, border:`2px solid ${pin.length > i ? "#00C896" : T.border}`, transition:"all 0.15s", boxShadow: pin.length > i ? "0 0 12px #00C89660" : "none" }} />
        ))}
      </div>
      {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"8px 18px", fontSize:12, fontWeight:700, marginBottom:20 }}>{error}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, width:"100%", maxWidth:280 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={() => d === "⌫" ? del() : d !== "" ? add(String(d)) : null}
            style={{ height:64, borderRadius:16, border:`1px solid ${T.border}`, background: d===""?"transparent":T.card, color:T.text, fontSize:24, fontWeight:700, cursor:d===""?"default":"pointer", transition:"all 0.12s", WebkitTapHighlightColor:"transparent" }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── COMPOSANT INSCRIPTION ───────────────────────────────────────────────────
function Inscription({ onDone, T, onLogin }) {
  const [step,    setStep]    = useState(1);
  const [mode,    setMode]    = useState("register"); // register | login
  const [form,    setForm]    = useState({ nom:"", telephone:"", reseau:"MTN" });
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const w = useWindowWidth();
  const wide = w >= 640;

  async function handlePinRegister(p) {
    if (step === 2) { setPin(p); setStep(3); }
    else if (step === 3) {
      if (p !== pin) { setError("Les 2 codes ne correspondent pas. Réessaie."); return; }
      setLoading(true);
      const agent = { nom: form.nom, telephone: form.telephone, reseau: form.reseau, pin: p, created_at: new Date().toISOString(), trial_start: new Date().toISOString() };
      const saved = await saveAgent(agent);
      lsSet("ms_agent", saved || agent);
      onDone(saved || agent);
    }
  }

  async function handleLogin() {
    if (!form.telephone) { setError("Entre ton numéro"); return; }
    setLoading(true);
    setError("");
    const agent = await fetchAgent(form.telephone);
    setLoading(false);
    if (!agent) { setError("Numéro introuvable. Crée un compte d'abord."); return; }
    lsSet("ms_agent", agent);
    setStep(10); // PIN login
  }

  function handlePinLogin(p) {
    const agent = lsGet("ms_agent");
    if (p === agent.pin) { onDone(agent); }
    else { setError("Code PIN incorrect."); }
  }

  if (step === 2) return <PinPad title="Crée ton code PIN" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={p => { setPin(p); setStep(3); }} T={T} />;
  if (step === 3) return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePinRegister} T={T} error={error} />;
  if (step === 10) return <PinPad title="Connexion" subtitle={`Bienvenue, entre ton PIN`} onSubmit={handlePinLogin} T={T} error={error} />;

  const inp = { width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", transition:"border-color 0.2s" };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding: wide ? 40 : 24, background:T.bg }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:32 }}>
          <div style={{ width:56, height:56, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:22, color:"#fff", marginBottom:16, boxShadow:"0 6px 24px #00C89640" }}>MS</div>
          <div style={{ fontWeight:900, fontSize:26, marginBottom:6, color:T.text }}>My Somme</div>
          <div style={{ fontSize:13, color:T.sub, textAlign:"center" }}>{mode === "register" ? "Crée ton compte agent gratuit" : "Reconnecte-toi à ton espace"}</div>
        </div>

        {/* Tab toggle */}
        <div style={{ display:"flex", background:T.hero, borderRadius:12, padding:4, marginBottom:24, border:`1px solid ${T.border}` }}>
          {[["register","Nouveau compte"],["login","Se connecter"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }}
              style={{ flex:1, padding:"10px 0", borderRadius:9, border:"none", background:mode===m?"linear-gradient(135deg,#00C896,#00A5FF)":"transparent", color:mode===m?"#fff":T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "register" ? (
          <>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>TON NOM COMPLET</div>
              <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={inp} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO WHATSAPP</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 10px", color:T.text, fontSize:13, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
                <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
              </div>
            </div>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>TON RÉSEAU PRINCIPAL</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPERATORS.map(op=>(
                  <button key={op} onClick={()=>setForm(f=>({...f,reseau:op}))}
                    style={{ flex:1, padding:"12px 0", borderRadius:11, border:`2px solid ${form.reseau===op?OP_COLORS[op]:T.border}`, background:form.reseau===op?OP_BG_D[op]:"transparent", color:form.reseau===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
                    {op}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background:"#00C89612", border:"1px solid #00C89630", borderRadius:12, padding:"12px 16px", marginBottom:20, fontSize:12, color:"#00C896", textAlign:"center" }}>
              🎁 <strong>30 jours gratuits</strong> — aucune carte bancaire requise
            </div>
            <button onClick={()=>{ if(!form.nom||!form.telephone){setError("Remplis tous les champs");return;} setStep(2); }}
              style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", boxShadow:"0 4px 20px #00C89640" }}>
              Commencer gratuitement →
            </button>
          </>
        ) : (
          <>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>TON NUMÉRO DE TÉLÉPHONE</div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 10px", color:T.text, fontSize:13, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
                <input type="tel" placeholder="97 00 00 00" value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} style={{ ...inp, flex:1 }} />
              </div>
            </div>
            <button onClick={handleLogin} disabled={loading}
              style={{ width:"100%", padding:16, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
              {loading ? "⏳ Vérification…" : "Continuer →"}
            </button>
          </>
        )}

        {error && <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:12, fontWeight:700 }}>{error}</div>}
      </div>
    </div>
  );
}

// ─── APP PRINCIPALE ──────────────────────────────────────────────────────────
export default function MySomme() {
  const [dark,         setDark]         = useState(true);
  const [agent,        setAgent]        = useState(null);
  const [locked,       setLocked]       = useState(false);
  const [pinErr,       setPinErr]       = useState("");
  const [tab,          setTab]          = useState("accueil");
  const [modal,        setModal]        = useState(null);
  const [form,         setForm]         = useState({});
  const [txs,          setTxs]          = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [flash,        setFlash]        = useState(null);
  const [confirm,      setConfirm]      = useState(null);
  const [confirmLogout,setConfirmLogout]= useState(false);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [calMonth,     setCalMonth]     = useState(new Date().getMonth()+1);
  const [calYear,      setCalYear]      = useState(new Date().getFullYear());
  const [activeDays,   setActiveDays]   = useState([]);
  const [showCal,      setShowCal]      = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);

  const w       = useWindowWidth();
  const mobile  = w < 640;
  const tablet  = w >= 640 && w < 1024;
  const desktop = w >= 1024;
  const T       = dark ? DARK : LIGHT;
  const OP_BG   = dark ? OP_BG_D : OP_BG_L;
  const isToday = selectedDate === todayStr();

  // Charger agent
  useEffect(() => {
    const saved = lsGet("ms_agent");
    if (saved) { setAgent(saved); setLocked(true); }
  }, []);

  // Compter les opérations en attente de sync
  useEffect(() => {
    if (agent) {
      const pend = lsGet(pendKey(agent.telephone));
      setPendingCount(pend ? pend.length : 0);
    }
  }, [agent, txs]);

  // Synchroniser les données en attente dès qu'on est online
  useEffect(() => {
    if (!agent) return;
    const trySync = async () => {
      const synced = await flushPending(agent.telephone);
      if (synced.length > 0) {
        setPendingCount(0);
        loadTxs(selectedDate);
      }
    };
    window.addEventListener("online", trySync);
    trySync();
    return () => window.removeEventListener("online", trySync);
  }, [agent]);

  async function handleUnlock(pin) {
    if (pin === agent.pin) { setLocked(false); setPinErr(""); }
    else setPinErr("Code PIN incorrect. Réessaie.");
  }

  function handleLogout() {
    lsDel("ms_agent");
    setAgent(null); setLocked(false); setTxs([]); setTab("accueil"); setConfirmLogout(false);
  }

  const loadTxs = useCallback(async (date) => {
    if (!agent) return;
    setLoading(true);
    const data = await fetchTxsByDate(date, agent.telephone);
    setTxs(data || []);
    setLoading(false);
  }, [agent]);

  useEffect(() => { if (agent && !locked) loadTxs(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) fetchActiveDays(calYear, calMonth, agent.telephone).then(setActiveDays); }, [calMonth, calYear, agent, locked]);

  const sum = f => txs.filter(f).reduce((s,t)=>s+Number(t.montant), 0);
  const com = f => txs.filter(f).reduce((s,t)=>s+Number(t.commission), 0);
  const totalCA  = sum(()=>true);
  const totalCom = com(()=>true);

  async function addTx() {
    if (!form.operateur || !form.montant) return;
    if (modal==="forfait" && !form.forfait) return;
    setSaving(true);
    const localId = Date.now();
    const tx = {
      type: modal, operateur: form.operateur, montant: Number(form.montant),
      commission: calcCom(modal, form.operateur, Number(form.montant)),
      client: form.client||"Client", telephone: form.telephone||null,
      forfait: form.forfait||null,
      heure: new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
      user_id: agent.telephone, localId,
      created_at: new Date().toISOString()
    };

    // Optimistic UI
    const optimisticTx = { ...tx, id: localId };
    setTxs(p => [optimisticTx, ...p]);

    // Save to Supabase
    const saved = await saveTxRemote(tx);

    if (saved) {
      // Replace optimistic entry with real saved entry
      setTxs(p => p.map(t => t.id === localId ? saved : t));
    } else {
      // Save to pending queue for later sync
      const pending = lsGet(pendKey(agent.telephone)) || [];
      lsSet(pendKey(agent.telephone), [...pending, tx]);
      setPendingCount(c => c + 1);
    }

    // Update localStorage cache
    const cached = lsGet(txKey(selectedDate, agent.telephone)) || [];
    lsSet(txKey(selectedDate, agent.telephone), [saved || optimisticTx, ...cached]);

    setSaving(false); setModal(null); setForm({});
    setFlash(modal); setTimeout(() => setFlash(null), 2200);
  }

  async function removeTx(id) {
    await deleteTx(id);
    const updated = txs.filter(t => t.id !== id);
    setTxs(updated);
    lsSet(txKey(selectedDate, agent.telephone), updated);
    setConfirm(null);
  }

  function shareReport() {
    const dateLabel = new Date(selectedDate).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    const report = `📊 *Point du jour — My Somme*\n📅 ${dateLabel}\n👤 Agent : ${agent.nom}\n\n⬇️ Dépôts : ${fF(sum(t=>t.type==="depot"))}\n⬆️ Retraits : ${fF(sum(t=>t.type==="retrait"))}\n📶 Forfaits : ${fF(sum(t=>t.type==="forfait"))}\n\n💰 *CA Total : ${fF(totalCA)}*\n✅ *Commission : ${fF(totalCom)}*\n\n_Généré par My Somme_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, "_blank");
  }

  function getDaysInMonth(y,m) { return new Date(y,m,0).getDate(); }
  function getFirstDay(y,m)    { return new Date(y,m-1,1).getDay(); }
  function formatDateLabel(str) {
    if (str === todayStr()) return "Aujourd'hui";
    return new Date(str).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  }

  if (!agent) return <Inscription onDone={a => { setAgent(a); setLocked(false); }} T={T} />;
  if (locked)  return <PinPad title="Bon retour 👋" subtitle={`Continu ${agent.nom}`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  // ─── NAVIGATION ITEMS ────────────────────────────────────────────────────
  const NAV_ITEMS = [
    ["accueil",    "🏠", "Accueil"],
    ["stats",      "📊", "Statistiques"],
    ["historique", "🗂️", "Historique"],
    ["profil",     "👤", "Mon Profil"],
  ];

  // ─── MODAL STYLE (bottom sheet on mobile, centered on desktop) ─────────────
  const modalWrap = desktop
    ? { position:"fixed", inset:0, background:"#000B", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:24 }
    : { position:"fixed", inset:0, background:"#000B", display:"flex", alignItems:"flex-end", zIndex:200 };
  const modalBox = desktop
    ? { background:T.card, borderRadius:20, padding:"24px 28px 28px", width:"100%", maxWidth:480, border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" }
    : { width:"100%", background:T.card, borderRadius:"22px 22px 0 0", padding:"16px 16px 42px", border:`1px solid ${T.border2}`, maxHeight:"90vh", overflowY:"auto" };

  // ─── CONTENT PADDING ─────────────────────────────────────────────────────
  const contentPad = desktop ? "16px 28px 40px" : tablet ? "14px 20px 100px" : "12px 14px 100px";
  const mainLeft   = desktop ? 240 : 0;
  const contentMax = desktop ? 820 : tablet ? 720 : "100%";

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background:T.bg, minHeight:"100vh", color:T.text, fontFamily:"'Segoe UI', system-ui, sans-serif", position:"relative", overflowX:"hidden" }}>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash], color:flash==="forfait"?"#000":"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:999, boxShadow:"0 4px 24px #0009", whiteSpace:"nowrap" }}>
          ✅ {TYPE_LABEL[flash]} sauvegardé !
        </div>
      )}

      {/* PENDING SYNC BADGE */}
      {pendingCount > 0 && (
        <div style={{ position:"fixed", top:20, right:20, background:"#FFB800", color:"#000", borderRadius:12, padding:"8px 14px", fontWeight:800, fontSize:12, zIndex:999, boxShadow:"0 4px 16px #FFB80050" }}>
          ⚡ {pendingCount} op. en attente de sync
        </div>
      )}

      {/* ═══ SIDEBAR (Desktop uniquement) ════════════════════════════════════ */}
      {desktop && (
        <aside style={{ position:"fixed", top:0, left:0, width:240, height:"100vh", background:T.sidebar, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", zIndex:100, padding:"20px 0" }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"0 20px 20px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ width:40, height:40, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:15, color:"#fff", flexShrink:0 }}>MS</div>
            <div>
              <div style={{ fontWeight:900, fontSize:15, letterSpacing:"-0.5px" }}>My Somme</div>
              <div style={{ fontSize:10, color:T.sub }}>Agent mobile money</div>
            </div>
          </div>

          {/* Agent card */}
          <div style={{ margin:"16px 12px", background:T.card, borderRadius:12, padding:"12px 14px", border:`1px solid ${T.border}` }}>
            <div style={{ fontSize:11, color:T.sub }}>Connecté en tant que</div>
            <div style={{ fontWeight:800, fontSize:14, marginTop:2 }}>{agent.nom}</div>
            <div style={{ fontSize:11, color:OP_COLORS[agent.reseau]||"#00C896", marginTop:2, fontWeight:700 }}>{agent.reseau} · +229 {agent.telephone}</div>
          </div>

          {/* Nav items */}
          <nav style={{ flex:1, padding:"8px 12px" }}>
            {NAV_ITEMS.map(([key, icon, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 14px", borderRadius:11, border:"none", background:tab===key?"#00C89618":"transparent", color:tab===key?"#00C896":T.sub, fontWeight:tab===key?800:500, fontSize:14, cursor:"pointer", marginBottom:4, transition:"all 0.2s", textAlign:"left" }}>
                <span style={{ fontSize:18 }}>{icon}</span>{label}
                {tab===key && <div style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#00C896" }} />}
              </button>
            ))}
          </nav>

          {/* Bas sidebar */}
          <div style={{ padding:"12px 12px 8px", borderTop:`1px solid ${T.border}` }}>
            <button onClick={() => setDark(d => !d)}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 14px", borderRadius:10, border:"none", background:"transparent", color:T.sub, fontSize:13, cursor:"pointer", marginBottom:6 }}>
              <span style={{ fontSize:16 }}>{dark ? "☀️" : "🌙"}</span>{dark ? "Mode clair" : "Mode sombre"}
            </button>
            <button onClick={() => setConfirmLogout(true)}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 14px", borderRadius:10, border:"none", background:"#E6394610", color:"#E63946", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              <span style={{ fontSize:16 }}>🔓</span>Déconnexion
            </button>
          </div>
        </aside>
      )}

      {/* ═══ HEADER (Mobile + Tablet) ════════════════════════════════════════ */}
      {!desktop && (
        <header style={{ background:T.card, padding: tablet ? "14px 20px" : "12px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:13, color:"#fff" }}>MS</div>
            <div>
              <div style={{ fontWeight:900, fontSize:15 }}>My Somme</div>
              <div style={{ fontSize:10, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {pendingCount > 0 && <div style={{ background:"#FFB80018", color:"#FFB800", borderRadius:8, padding:"3px 8px", fontSize:10, fontWeight:700 }}>⚡{pendingCount}</div>}
            <button onClick={() => setDark(d => !d)} style={{ background:dark?"#22263A":"#E4E8F5", border:"none", borderRadius:20, padding:"5px 9px", cursor:"pointer", fontSize:15 }}>{dark?"☀️":"🌙"}</button>
            <button onClick={() => setShowCal(true)} style={{ background:dark?"#22263A":"#E4E8F5", border:"none", borderRadius:9, padding:"6px 9px", cursor:"pointer", fontSize:15 }}>📅</button>
            <button onClick={shareReport} style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:9, padding:"6px 9px", cursor:"pointer", fontSize:15 }}>📤</button>
            <button onClick={() => setConfirmLogout(true)} style={{ background:"#E6394615", border:"1px solid #E6394630", borderRadius:9, padding:"6px 10px", cursor:"pointer", fontSize:12, color:"#E63946", fontWeight:700 }}>🔓</button>
          </div>
        </header>
      )}

      {/* ═══ HEADER DESKTOP ══════════════════════════════════════════════════ */}
      {desktop && (
        <header style={{ position:"fixed", top:0, left:240, right:0, background:T.card, borderBottom:`1px solid ${T.border}`, padding:"14px 28px", display:"flex", justifyContent:"space-between", alignItems:"center", zIndex:50 }}>
          <div>
            <div style={{ fontWeight:900, fontSize:16, letterSpacing:"-0.5px" }}>{NAV_ITEMS.find(n => n[0] === tab)?.[2] || "Accueil"}</div>
            <div style={{ fontSize:11, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={() => setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:9, padding:"7px 12px", cursor:"pointer", fontSize:13, color:T.text, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              📅 Changer de date
            </button>
            <button onClick={shareReport} style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:9, padding:"7px 12px", cursor:"pointer", fontSize:13, color:"#00C896", fontWeight:700 }}>
              📤 Partager
            </button>
          </div>
        </header>
      )}

      {/* ═══ CONTENU PRINCIPAL ═══════════════════════════════════════════════ */}
      <main style={{ marginLeft:mainLeft, paddingTop: desktop ? 62 : 0, minHeight:"100vh" }}>
        <div style={{ maxWidth: contentMax, margin:"0 auto", padding: contentPad }}>

          {/* Bandeau date passée */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:"1px solid #4F8EF740", marginBottom:14, borderRadius:12, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={() => setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:8, padding:"5px 12px", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          {/* ══ ACCUEIL ══ */}
          {tab === "accueil" && <>
            {/* Hero card */}
            <div style={{ background:`linear-gradient(135deg,${T.hero},${T.card})`, borderRadius:18, padding: desktop ? 24 : 16, marginBottom:14, border:`1px solid ${T.border2}` }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:4 }}>{isToday ? "Chiffre d'affaires aujourd'hui" : "Chiffre d'affaires"}</div>
              <div style={{ fontSize: desktop ? 40 : 34, fontWeight:900, color:"#00C896", letterSpacing:-1 }}>{fF(totalCA)}</div>
              <div style={{ display:"flex", gap:24, marginTop:12, flexWrap:"wrap" }}>
                <div><div style={{ fontSize:10, color:T.sub }}>Opérations</div><div style={{ fontSize:18, fontWeight:800 }}>{txs.length}</div></div>
                <div><div style={{ fontSize:10, color:T.sub }}>Commission</div><div style={{ fontSize:18, fontWeight:800, color:"#FFB800" }}>{fF(totalCom)}</div></div>
                <div><div style={{ fontSize:10, color:T.sub }}>Agent</div><div style={{ fontSize:16, fontWeight:700, color:OP_COLORS[agent.reseau]||"#00C896" }}>{agent.nom?.split(" ")[0]}</div></div>
              </div>
            </div>

            {/* Grille stats */}
            <div style={{ display:"grid", gridTemplateColumns: desktop ? "repeat(4,1fr)" : "repeat(2,1fr)", gap:10, marginBottom:14 }}>
              {[
                { label:"Dépôts",   value:sum(t=>t.type==="depot"),   c:com(t=>t.type==="depot"),   icon:"⬇️", color:"#00C896" },
                { label:"Retraits", value:sum(t=>t.type==="retrait"), c:com(t=>t.type==="retrait"), icon:"⬆️", color:"#4F8EF7" },
                { label:"Forfaits", value:sum(t=>t.type==="forfait"), c:com(t=>t.type==="forfait"), icon:"📶", color:"#FFB800" },
                { label:"Commission totale", value:totalCom, c:null, icon:"💰", color:"#E63946" },
              ].map((s,i) => (
                <div key={i} style={{ background:T.card, borderRadius:14, padding: desktop ? 18 : 14, border:`1px solid ${s.color}22` }}>
                  <div style={{ fontSize:22 }}>{s.icon}</div>
                  <div style={{ fontSize: desktop ? 20 : 18, fontWeight:900, color:s.color, marginTop:6 }}>{fF(s.value)}</div>
                  {s.c !== null && <div style={{ fontSize:10, color:T.sub, marginTop:2 }}>comm. {fF(s.c)}</div>}
                  <div style={{ fontSize:10, color:T.faint, marginTop:4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Par opérateur */}
            <div style={{ background:T.card, borderRadius:16, padding: desktop ? 20 : 15, marginBottom:14, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>Par opérateur</div>
              {OPERATORS.map((op,i) => {
                const o = txs.filter(t => t.operateur === op);
                return (
                  <div key={op} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
                    <div style={{ width:34, height:34, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{op}</div>
                      <div style={{ fontSize:11, color:T.sub }}>{o.length} op. · comm. {fF(o.reduce((s,t)=>s+Number(t.commission),0))}</div>
                    </div>
                    <div style={{ fontWeight:900, color:OP_COLORS[op], fontSize:15 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</div>
                  </div>
                );
              })}
            </div>

            {/* Bouton WhatsApp */}
            <button onClick={shareReport} style={{ width:"100%", padding:15, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>📤</span> Envoyer le point du jour sur WhatsApp
            </button>

            {/* Dernières opérations */}
            <div style={{ background:T.card, borderRadius:16, padding: desktop ? 20 : 15, border:`1px solid ${T.border}` }}>
              <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>Dernières opérations</div>
              {loading && <div style={{ textAlign:"center", color:T.faint, padding:"24px 0", fontSize:13 }}>⏳ Chargement…</div>}
              {!loading && txs.length === 0 && <div style={{ textAlign:"center", color:T.faint, padding:"32px 0", fontSize:13 }}>{isToday ? "Aucune opération · Appuie sur ⬇️ ⬆️ ou 📶" : "Aucune opération ce jour"}</div>}
              {txs.slice(0,8).map((t,i) => (
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<Math.min(txs.length,8)-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}{t.forfait?` · ${t.forfait}`:""}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                    <div style={{ fontSize:11, color:T.sub }}>+{fF(t.commission)}</div>
                  </div>
                  {isToday && <button onClick={() => setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14, flexShrink:0, padding:4 }}>🗑️</button>}
                </div>
              ))}
            </div>

            {/* Boutons action rapide sur desktop */}
            {desktop && isToday && (
              <div style={{ display:"flex", gap:12, marginTop:16 }}>
                {[["depot","⬇️ Nouveau Dépôt","#00C896"],["retrait","⬆️ Nouveau Retrait","#4F8EF7"],["forfait","📶 Vente Forfait","#FFB800"]].map(([type, label, color]) => (
                  <button key={type} onClick={() => { setModal(type); setForm({}); }}
                    style={{ flex:1, padding:14, borderRadius:13, background:`${color}18`, border:`2px solid ${color}40`, color, fontWeight:800, fontSize:14, cursor:"pointer", transition:"all 0.2s" }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>}

          {/* ══ STATS ══ */}
          {tab === "stats" && (
            <div>
              <div style={{ fontWeight:900, fontSize:18, marginBottom:16 }}>📊 Statistiques</div>
              <div style={{ background:"linear-gradient(135deg,#1A2810,#1A2030)", borderRadius:16, padding:desktop?20:16, marginBottom:14, border:"1px solid #00C89630" }}>
                <div style={{ fontSize:11, color:"#4A7050", marginBottom:4 }}>💰 Commission {isToday?"du jour":"ce jour"}</div>
                <div style={{ fontSize:desktop?36:28, fontWeight:900, color:"#00C896" }}>{fF(totalCom)}</div>
                <div style={{ fontSize:11, color:"#3A5040", marginTop:6 }}>Dépôt 0.5% · Retrait MTN/MOOV 1.5% · Retrait Celtiis 1% · Forfaits 6-7%</div>
              </div>
              {["depot","retrait","forfait"].map(type => {
                const tTxs = txs.filter(t => t.type === type);
                return (
                  <div key={type} style={{ background:T.card, borderRadius:14, padding:desktop?18:15, marginBottom:12, border:`1px solid ${TYPE_COLOR[type]}22` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                      <div style={{ fontWeight:800, fontSize:14 }}>{TYPE_ICON[type]} {TYPE_LABEL[type]}s</div>
                      <div><span style={{ color:TYPE_COLOR[type], fontWeight:900 }}>{fF(tTxs.reduce((s,t)=>s+Number(t.montant),0))}</span><span style={{ color:T.sub, fontSize:11 }}> · {fF(tTxs.reduce((s,t)=>s+Number(t.commission),0))}</span></div>
                    </div>
                    {OPERATORS.map((op,i) => {
                      const o = txs.filter(t => t.type===type && t.operateur===op);
                      return (
                        <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:i<2?`1px solid ${T.border}`:"none", fontSize:13 }}>
                          <div><span style={{ color:OP_COLORS[op], fontWeight:700 }}>{op}</span><span style={{ color:T.faint, fontSize:11 }}> {o.length}x · {(COMMISSIONS[op][type]*100).toFixed(1)}%</span></div>
                          <div><span style={{ fontWeight:700 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</span><span style={{ color:T.sub, fontSize:11 }}> +{fF(o.reduce((s,t)=>s+Number(t.commission),0))}</span></div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <button onClick={shareReport} style={{ width:"100%", padding:15, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>📤</span> Partager ce rapport
              </button>
            </div>
          )}

          {/* ══ HISTORIQUE ══ */}
          {tab === "historique" && (
            <div>
              <div style={{ fontWeight:900, fontSize:18, marginBottom:16 }}>🗂️ Historique</div>
              {loading && <div style={{ textAlign:"center", color:T.faint, padding:"48px 0" }}>⏳ Chargement…</div>}
              {!loading && txs.length === 0 && <div style={{ textAlign:"center", color:T.faint, padding:"56px 0", fontSize:14 }}>Aucune opération {isToday?"enregistrée":"ce jour"}</div>}
              {txs.map(t => (
                <div key={t.id} style={{ background:T.card, borderRadius:13, padding: desktop ? "14px 18px" : "12px 14px", marginBottom:10, border:`1px solid ${TYPE_COLOR[t.type]}18`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:13 }}>{TYPE_LABEL[t.type]} · <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:1 }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}{t.forfait?` · ${t.forfait}`:""}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:15 }}>{fF(t.montant)}</div>
                      <div style={{ fontSize:11, color:T.sub }}>+{fF(t.commission)}</div>
                    </div>
                    {isToday && <button onClick={() => setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14, padding:4 }}>🗑️</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ PROFIL ══ */}
          {tab === "profil" && (
            <div>
              <div style={{ fontWeight:900, fontSize:18, marginBottom:16 }}>👤 Mon Profil</div>
              <div style={{ background:T.card, borderRadius:16, padding: desktop ? 24 : 18, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
                  <div style={{ width:56, height:56, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:22, color:"#fff", flexShrink:0 }}>
                    {agent.nom?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:18 }}>{agent.nom}</div>
                    <div style={{ fontSize:13, color:T.sub }}>Agent Mobile Money</div>
                    <div style={{ fontSize:12, color:OP_COLORS[agent.reseau]||"#00C896", marginTop:2, fontWeight:700 }}>{agent.reseau} · +229 {agent.telephone}</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap:10 }}>
                  {[
                    ["📱 Réseau principal", agent.reseau],
                    ["📞 WhatsApp", `+229 ${agent.telephone}`],
                    ["📅 Membre depuis", agent.trial_start ? new Date(agent.trial_start).toLocaleDateString("fr-FR") : "—"],
                    ["🎁 Statut", "Période d'essai (30j)"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background:T.hero, borderRadius:11, padding:"12px 14px" }}>
                      <div style={{ fontSize:11, color:T.sub }}>{label}</div>
                      <div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Thème */}
              <div style={{ background:T.card, borderRadius:16, padding: desktop ? 20 : 16, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:14 }}>⚙️ Préférences</div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{dark ? "Mode sombre" : "Mode clair"}</div>
                    <div style={{ fontSize:11, color:T.sub }}>Changer l'apparence de l'app</div>
                  </div>
                  <button onClick={() => setDark(d => !d)} style={{ padding:"8px 20px", borderRadius:10, background:dark?"#22263A":"#E4E8F5", border:`1px solid ${T.border}`, color:T.text, fontWeight:700, fontSize:14, cursor:"pointer" }}>
                    {dark ? "☀️ Clair" : "🌙 Sombre"}
                  </button>
                </div>
              </div>

              {/* Données hors ligne */}
              <div style={{ background:T.card, borderRadius:16, padding: desktop ? 20 : 16, marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ fontWeight:800, fontSize:14, marginBottom:6 }}>💾 Données hors ligne</div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:12 }}>Tes données sont sauvegardées localement et synchronisées automatiquement avec le serveur.</div>
                {pendingCount > 0 ? (
                  <div style={{ background:"#FFB80018", border:"1px solid #FFB80040", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#FFB800", fontWeight:700 }}>
                    ⚡ {pendingCount} opération(s) en attente de synchronisation
                  </div>
                ) : (
                  <div style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:10, padding:"10px 14px", fontSize:12, color:"#00C896", fontWeight:700 }}>
                    ✅ Toutes les données sont synchronisées
                  </div>
                )}
              </div>

              {/* Déconnexion */}
              <button onClick={() => setConfirmLogout(true)}
                style={{ width:"100%", padding:16, borderRadius:14, background:"#E6394618", border:"2px solid #E6394640", color:"#E63946", fontWeight:800, fontSize:15, cursor:"pointer" }}>
                🔓 Se déconnecter
              </button>
            </div>
          )}
        </div>
      </main>

      {/* ═══ FABs (Mobile + Tablet) ══════════════════════════════════════════ */}
      {!desktop && isToday && (
        <div style={{ position:"fixed", bottom: mobile ? 72 : 80, right: tablet ? 20 : 14, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
          <button onClick={() => { setModal("forfait"); setForm({}); }} style={{ width:48, height:48, borderRadius:"50%", background:"#FFB800", border:"none", color:"#000", fontSize:18, cursor:"pointer", boxShadow:"0 3px 14px #FFB80060", display:"flex", alignItems:"center", justifyContent:"center" }}>📶</button>
          <button onClick={() => { setModal("retrait"); setForm({}); }} style={{ width:48, height:48, borderRadius:"50%", background:"#4F8EF7", border:"none", color:"#fff", fontSize:18, cursor:"pointer", boxShadow:"0 3px 14px #4F8EF760", display:"flex", alignItems:"center", justifyContent:"center" }}>⬆️</button>
          <button onClick={() => { setModal("depot"); setForm({}); }} style={{ width:56, height:56, borderRadius:"50%", background:"linear-gradient(135deg,#00C896,#009E78)", border:"none", color:"#fff", fontSize:22, cursor:"pointer", boxShadow:"0 4px 20px #00C89660", display:"flex", alignItems:"center", justifyContent:"center" }}>⬇️</button>
        </div>
      )}

      {/* ═══ BOTTOM NAV (Mobile + Tablet) ════════════════════════════════════ */}
      {!desktop && (
        <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.nav, borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-around", padding: tablet ? "10px 0 16px" : "8px 0 14px", zIndex:50 }}>
          {NAV_ITEMS.map(([key, icon, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.faint, fontSize: tablet ? 11 : 10, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding: tablet ? "0 20px" : "0 14px", WebkitTapHighlightColor:"transparent" }}>
              <span style={{ fontSize: tablet ? 24 : 22 }}>{icon}</span>{label}
              {tab===key && <div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
            </button>
          ))}
        </nav>
      )}

      {/* ═══ MODAL SAISIE ════════════════════════════════════════════════════ */}
      {modal && (
        <div style={modalWrap} onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} style={modalBox}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />}
            <div style={{ fontWeight:900, fontSize:17, marginBottom:16 }}>
              {modal==="depot"?"⬇️ Nouveau Dépôt":modal==="retrait"?"⬆️ Nouveau Retrait":"📶 Vente Forfait Internet"}
            </div>
            {form.operateur && (
              <div style={{ background:"#00C89610", border:"1px solid #00C89630", borderRadius:10, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#00C896" }}>
                💰 Commission : {(COMMISSIONS[form.operateur][modal]*100).toFixed(1)}%{form.montant?` → ${fF(calcCom(modal,form.operateur,Number(form.montant)))}` : ""}
              </div>
            )}
            {/* Opérateur */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>OPÉRATEUR</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPERATORS.map(op => (
                  <button key={op} onClick={() => setForm(f => ({ ...f, operateur:op, forfait:null, montant:"" }))}
                    style={{ flex:1, padding:"11px 0", borderRadius:11, border:`2px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?OP_BG[op]:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:14, cursor:"pointer", transition:"all 0.2s" }}>
                    {op}
                  </button>
                ))}
              </div>
            </div>
            {/* Forfaits */}
            {modal === "forfait" && form.operateur && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>FORFAIT</div>
                <div style={{ display:"grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap:8 }}>
                  {FORFAITS[form.operateur].map(f => (
                    <button key={f.label} onClick={() => setForm(p => ({ ...p, forfait:f.label, montant:f.montant }))}
                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderRadius:11, border:`2px solid ${form.forfait===f.label?OP_COLORS[form.operateur]:T.border}`, background:form.forfait===f.label?OP_BG[form.operateur]:"transparent", cursor:"pointer", transition:"all 0.2s" }}>
                      <div style={{ fontWeight:800, fontSize:13, color:form.forfait===f.label?OP_COLORS[form.operateur]:T.text }}>{f.data} · {f.duree}</div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontWeight:900, fontSize:13, color:form.forfait===f.label?OP_COLORS[form.operateur]:T.text }}>{fF(f.montant)}</div>
                        <div style={{ fontSize:10, color:"#00C896" }}>+{fF(Math.round(f.montant*COMMISSIONS[form.operateur].forfait))}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Montant */}
            {modal !== "forfait" && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>MONTANT (FCFA)</div>
                <input type="number" placeholder="Ex : 5000" value={form.montant||""} onChange={e => setForm(f => ({ ...f, montant:e.target.value }))}
                  style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:18, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
              </div>
            )}
            {/* Client */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>NOM DU CLIENT (optionnel)</div>
              <input type="text" placeholder="Ex : Kofi Mensah" value={form.client||""} onChange={e => setForm(f => ({ ...f, client:e.target.value }))}
                style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 14px", color:T.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            {/* Téléphone */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700, letterSpacing:1 }}>NUMÉRO DE TÉLÉPHONE (optionnel)</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 10px", color:T.text, fontSize:12, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
                <input type="tel" placeholder="97 00 00 00" value={form.telephone||""} onChange={e => setForm(f => ({ ...f, telephone:e.target.value }))}
                  style={{ flex:1, background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 14px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <button onClick={addTx} disabled={saving}
              style={{ width:"100%", padding:16, borderRadius:14, background:saving?"#1A1D2E":modal==="depot"?"#00C896":modal==="retrait"?"#4F8EF7":"#FFB800", border:"none", color:saving?T.sub:modal==="forfait"?"#000":"#fff", fontWeight:900, fontSize:16, cursor:saving?"not-allowed":"pointer" }}>
              {saving ? "⏳ Sauvegarde…" : "Enregistrer ✓"}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL CALENDRIER ════════════════════════════════════════════════ */}
      {showCal && (
        <div style={{ ...modalWrap, zIndex:300 }} onClick={() => setShowCal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalBox, maxWidth: desktop ? 380 : "100%" }}>
            {!desktop && <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <button onClick={() => { if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1); }} style={{ background:T.hero, border:"none", borderRadius:9, width:34, height:34, cursor:"pointer", fontSize:17, color:T.text }}>‹</button>
              <div style={{ fontWeight:800, fontSize:15 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
              <button onClick={() => { if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1); }} style={{ background:T.hero, border:"none", borderRadius:9, width:34, height:34, cursor:"pointer", fontSize:17, color:T.text }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:8 }}>
              {JOURS.map(j => (<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"4px 0" }}>{j}</div>))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array(getFirstDay(calYear,calMonth)).fill(null).map((_,i) => (<div key={`e${i}`} />))}
              {Array(getDaysInMonth(calYear,calMonth)).fill(null).map((_,i) => {
                const day = i+1, ds = `${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isTod=ds===todayStr(), isSel=ds===selectedDate, has=activeDays.includes(ds), isFut=ds>todayStr();
                return (
                  <button key={day} disabled={isFut} onClick={() => { setSelectedDate(ds); setShowCal(false); setTab("accueil"); }}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:9, border:isSel?"2px solid #00C896":isTod?`2px solid ${OP_COLORS.MTN}`:`1px solid ${T.border}`, background:isSel?"#00C89620":isTod?"#FFB80015":T.hero, color:isFut?T.faint:isSel?"#00C896":T.text, fontWeight:isSel||isTod?800:500, fontSize:13, cursor:isFut?"not-allowed":"pointer", position:"relative", display:"flex", alignItems:"center", justifyContent:"center", opacity:isFut?0.3:1 }}>
                    {day}
                    {has && !isSel && <div style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:3, height:3, borderRadius:"50%", background:"#00C896" }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CONFIRM SUPPRESSION ══════════════════════════════════════════════ */}
      {confirm && (
        <div style={{ ...modalWrap, zIndex:400 }}>
          <div style={{ background:T.card, borderRadius:18, padding:24, width:"100%", maxWidth:320, border:`1px solid ${T.border2}`, margin: desktop ? 0 : "0 16px 16px" }}>
            <div style={{ fontSize:18, fontWeight:900, marginBottom:8 }}>🗑️ Supprimer ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>Cette opération sera effacée définitivement.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirm(null)} style={{ flex:1, padding:13, borderRadius:11, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={() => removeTx(confirm)} style={{ flex:1, padding:13, borderRadius:11, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CONFIRM DÉCONNEXION ══════════════════════════════════════════════ */}
      {confirmLogout && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:24 }}>
          <div style={{ background:T.card, borderRadius:20, padding:28, width:"100%", maxWidth:340, border:`1px solid ${T.border2}`, textAlign:"center" }}>
            <div style={{ fontSize:42, marginBottom:12 }}>🔓</div>
            <div style={{ fontSize:18, fontWeight:900, marginBottom:8 }}>Se déconnecter ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:24 }}>Tu pourras te reconnecter avec ton numéro et ton PIN. Tes données restent sauvegardées.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirmLogout(false)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={handleLogout} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Déconnexion</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
