import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE ───────────────────────────────────────────────────────────────
const SUPA_URL = "https://xwpepotkvjendslfgpza.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3cGVwb3RrdmplbmRzbGZncHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTIxOTMsImV4cCI6MjA4ODYyODE5M30.DzgVA46ldUCX-CGE-Byk3QZkQSRMr_HvVXhJl8ZT9H0";
const H = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };

// ─── CACHE LOCAL (offline) ──────────────────────────────────────────────────
const CACHE_KEY = (uid, date) => `ms_txs_${uid}_${date}`;
const PENDING_KEY = "ms_pending_ops";

function getCached(uid, date) {
  try { const r = localStorage.getItem(CACHE_KEY(uid, date)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function setCache(uid, date, data) {
  try { localStorage.setItem(CACHE_KEY(uid, date), JSON.stringify(data)); } catch {}
}
function getPending() {
  try { const r = localStorage.getItem(PENDING_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function addPending(tx) {
  try { const p = getPending(); p.push(tx); localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {}
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

// ─── API SUPABASE ─────────────────────────────────────────────────────────
async function fetchTxsByDate(dateStr, userId) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions?created_at=gte.${dateStr}T00:00:00&created_at=lt.${dateStr}T23:59:59&user_id=eq.${userId}&order=created_at.desc`, { headers: H });
    if (!res.ok) return null;
    const data = await res.json();
    setCache(userId, dateStr, data);
    return data;
  } catch { return null; }
}
async function saveTx(tx) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/transactions`, { method: "POST", headers: H, body: JSON.stringify(tx) });
    return res.ok ? (await res.json())[0] : null;
  } catch { return null; }
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

// ─── DONNÉES ─────────────────────────────────────────────────────────────
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
const OP_BG_D    = { MTN: "#FFB80022", MOOV: "#0066CC22", Celtiis: "#E6394622" };
const OP_BG_L    = { MTN: "#FFB80030", MOOV: "#0066CC25", Celtiis: "#E6394625" };
const TYPE_COLOR = { depot: "#00C896", retrait: "#4F8EF7", forfait: "#FFB800" };
const TYPE_ICON  = { depot: "⬇️", retrait: "⬆️", forfait: "📶" };
const TYPE_LABEL = { depot: "Dépôt", retrait: "Retrait", forfait: "Forfait" };
const JOURS      = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MOIS_FR    = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const calcCom  = (type, op, mt) => Math.round((mt||0) * (COMMISSIONS[op]?.[type]||0));
const fF       = n => Number(n||0).toLocaleString("fr-FR") + " F";
const todayStr = () => new Date().toISOString().slice(0,10);
const todayLbl = () => new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });

const DARK  = { bg:"#080A11", card:"#0F1118", border:"#1C1F2E", border2:"#22263A", text:"#E8EAF0", sub:"#4A5060", faint:"#2E3140", hero:"#151826", input:"#080A11", nav:"#0B0D16" };
const LIGHT = { bg:"#F0F2F8", card:"#FFFFFF",  border:"#DDE1EE", border2:"#CDD2E4", text:"#1A1D2E", sub:"#6B7080", faint:"#C0C5D5", hero:"#E4E8F5", input:"#F8F9FC", nav:"#FFFFFF" };

// ─── HOOK RESPONSIVE ─────────────────────────────────────────────────────
function useBreakpoint() {
  const [bp, setBp] = useState(() => {
    if (typeof window === "undefined") return "mobile";
    const w = window.innerWidth;
    if (w >= 1024) return "desktop";
    if (w >= 640) return "tablet";
    return "mobile";
  });
  useEffect(() => {
    const fn = () => {
      const w = window.innerWidth;
      if (w >= 1024) setBp("desktop");
      else if (w >= 640) setBp("tablet");
      else setBp("mobile");
    };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return bp;
}

// ─── COMPOSANT PIN ──────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, T, error }) {
  const [pin, setPin] = useState("");
  const add = d => {
    if (pin.length < 4) {
      const p = pin + d;
      setPin(p);
      if (p.length === 4) setTimeout(() => onSubmit(p), 120);
    }
  };
  const del = () => setPin(p => p.slice(0,-1));
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:52, height:52, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:15, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:20, color:"#fff", marginBottom:22, boxShadow:"0 4px 20px #00C89640" }}>MS</div>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:6, textAlign:"center", color:T.text }}>{title}</div>
      <div style={{ fontSize:14, color:T.sub, marginBottom:36, textAlign:"center" }}>{subtitle}</div>
      <div style={{ display:"flex", gap:18, marginBottom:36 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:20, height:20, borderRadius:"50%", background: pin.length > i ? "#00C896" : T.border2, border:`2px solid ${pin.length > i ? "#00C896" : T.border}`, transition:"all 0.15s", transform: pin.length > i ? "scale(1.1)" : "scale(1)" }} />
        ))}
      </div>
      {error && <div style={{ background:"#E6394618", border:"1px solid #E6394640", color:"#E63946", borderRadius:10, padding:"8px 18px", fontSize:12, fontWeight:700, marginBottom:20 }}>{error}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, width:"100%", maxWidth:280 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={() => d === "⌫" ? del() : d !== "" ? add(String(d)) : null}
            style={{ height:64, borderRadius:16, border:`1px solid ${T.border}`, background: d===""?"transparent":T.card, color:T.text, fontSize:24, fontWeight:700, cursor:d===""?"default":"pointer", transition:"all 0.1s", boxShadow: d!==""?"0 1px 4px #0002":undefined }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── COMPOSANT INSCRIPTION ───────────────────────────────────────────────
function Inscription({ onDone, T }) {
  const [step,    setStep]    = useState(1);
  const [form,    setForm]    = useState({ nom:"", telephone:"", reseau:"MTN" });
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePin(p) {
    if (step === 2) { setPin(p); setStep(3); }
    else if (step === 3) {
      if (p !== pin) { setError("Les 2 codes ne correspondent pas. Réessaie."); return; }
      setLoading(true);
      const agent = { nom: form.nom, telephone: form.telephone, reseau: form.reseau, pin: p, created_at: new Date().toISOString(), trial_start: new Date().toISOString() };
      const saved = await saveAgent(agent);
      localStorage.setItem("ms_agent", JSON.stringify(saved || agent));
      onDone(saved || agent);
    }
  }

  if (step === 2) return <PinPad title="Crée ton code PIN" subtitle="4 chiffres pour sécuriser ton compte" onSubmit={p=>{setPin(p);setStep(3);}} T={T} />;
  if (step === 3) return <PinPad title="Confirme ton PIN" subtitle="Retape les mêmes 4 chiffres" onSubmit={handlePin} T={T} error={error} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:T.bg }}>
      <div style={{ width:52, height:52, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:15, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:20, color:"#fff", marginBottom:22, boxShadow:"0 4px 20px #00C89640" }}>MS</div>
      <div style={{ fontWeight:900, fontSize:24, marginBottom:4, color:T.text }}>My Somme</div>
      <div style={{ fontSize:14, color:T.sub, marginBottom:36, textAlign:"center" }}>Ton cahier des opérations MoMo numérique 🇧🇯</div>

      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>TON NOM COMPLET</div>
          <input type="text" placeholder="Ex : Koffi Mensah" value={form.nom}
            onChange={e=>setForm(f=>({...f,nom:e.target.value}))}
            style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:15, outline:"none", boxSizing:"border-box", transition:"border 0.2s" }} />
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>TON NUMÉRO WHATSAPP</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 12px", color:T.text, fontSize:13, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
            <input type="tel" placeholder="97 00 00 00" value={form.telephone}
              onChange={e=>setForm(f=>({...f,telephone:e.target.value}))}
              style={{ flex:1, background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 14px", color:T.text, fontSize:16, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
          </div>
        </div>

        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>TON RÉSEAU PRINCIPAL</div>
          <div style={{ display:"flex", gap:8 }}>
            {OPERATORS.map(op=>(
              <button key={op} onClick={()=>setForm(f=>({...f,reseau:op}))}
                style={{ flex:1, padding:"13px 0", borderRadius:11, border:`2px solid ${form.reseau===op?OP_COLORS[op]:T.border}`, background:form.reseau===op?OP_BG_D[op]:"transparent", color:form.reseau===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
                {op}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background:"#00C89612", border:"1px solid #00C89630", borderRadius:12, padding:"14px 16px", marginBottom:24, fontSize:13, color:"#00C896", textAlign:"center" }}>
          🎁 <strong>30 jours gratuits</strong> — aucune carte bancaire requise
        </div>

        <button onClick={()=>{ if(!form.nom||!form.telephone){setError("Remplis tous les champs");return;} setStep(2); }}
          style={{ width:"100%", padding:17, borderRadius:14, background:"linear-gradient(135deg,#00C896,#00A5FF)", border:"none", color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", boxShadow:"0 4px 20px #00C89640" }}>
          Commencer gratuitement →
        </button>
        {error && <div style={{ color:"#E63946", fontSize:12, textAlign:"center", marginTop:10 }}>{error}</div>}
      </div>
    </div>
  );
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────
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
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [calMonth,     setCalMonth]     = useState(new Date().getMonth()+1);
  const [calYear,      setCalYear]      = useState(new Date().getFullYear());
  const [activeDays,   setActiveDays]   = useState([]);
  const [showCal,      setShowCal]      = useState(false);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [showLogout,   setShowLogout]   = useState(false);

  const bp    = useBreakpoint();
  const T     = dark ? DARK : LIGHT;
  const OP_BG = dark ? OP_BG_D : OP_BG_L;
  const isToday   = selectedDate === todayStr();
  const isMobile  = bp === "mobile";
  const isDesktop = bp === "desktop";

  // ─── Online/Offline detection ────────────────────────────────────────
  useEffect(() => {
    const goOn  = () => { setIsOnline(true);  syncPending(); };
    const goOff = () => setIsOnline(false);
    window.addEventListener("online",  goOn);
    window.addEventListener("offline", goOff);
    return () => { window.removeEventListener("online",goOn); window.removeEventListener("offline",goOff); };
  }, []);

  // ─── Sync opérations en attente ──────────────────────────────────────
  async function syncPending() {
    const pending = getPending();
    if (!pending.length) return;
    for (const tx of pending) {
      await saveTx(tx);
    }
    clearPending();
    setPendingCount(0);
    if (agent) loadTxs(todayStr());
  }

  // ─── Charger agent depuis localStorage ───────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("ms_agent");
    if (saved) { setAgent(JSON.parse(saved)); setLocked(true); }
    setPendingCount(getPending().length);
  }, []);

  // ─── Unlock PIN ───────────────────────────────────────────────────────
  async function handleUnlock(pin) {
    if (pin === agent.pin) { setLocked(false); setPinErr(""); }
    else { setPinErr("Code PIN incorrect. Réessaie."); }
  }

  // ─── Déconnexion ─────────────────────────────────────────────────────
  function handleLogout() {
    localStorage.removeItem("ms_agent");
    setAgent(null);
    setLocked(false);
    setShowLogout(false);
    setTab("accueil");
    setTxs([]);
  }

  // ─── Charger transactions (Supabase + cache offline) ─────────────────
  const loadTxs = useCallback(async (date) => {
    if (!agent) return;
    setLoading(true);
    // D'abord le cache local
    const cached = getCached(agent.telephone, date);
    if (cached) setTxs(cached);
    // Puis Supabase si en ligne
    const remote = await fetchTxsByDate(date, agent.telephone);
    if (remote) setTxs(remote);
    else if (!cached) setTxs([]);
    setLoading(false);
  }, [agent]);

  useEffect(() => { if (agent && !locked) loadTxs(selectedDate); }, [selectedDate, agent, locked]);
  useEffect(() => { if (agent && !locked) fetchActiveDays(calYear, calMonth, agent.telephone).then(setActiveDays); }, [calMonth, calYear, agent, locked]);

  // ─── Agrégats ─────────────────────────────────────────────────────────
  const sum = f => txs.filter(f).reduce((s,t)=>s+Number(t.montant), 0);
  const com = f => txs.filter(f).reduce((s,t)=>s+Number(t.commission), 0);
  const totalCA  = sum(()=>true);
  const totalCom = com(()=>true);

  // ─── Ajouter une transaction ──────────────────────────────────────────
  async function addTx() {
    if (!form.operateur || !form.montant) return;
    if (modal==="forfait" && !form.forfait) return;
    setSaving(true);
    const tx = {
      type: modal,
      operateur: form.operateur,
      montant: Number(form.montant),
      commission: calcCom(modal, form.operateur, Number(form.montant)),
      client: form.client || "Client",
      telephone: form.telephone || null,
      forfait: form.forfait || null,
      heure: new Date().toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" }),
      user_id: agent.telephone,
      created_at: new Date().toISOString(),
    };
    const localTx = { ...tx, id: Date.now() };
    // Ajout immédiat en local
    const newTxs = [localTx, ...txs];
    setTxs(newTxs);
    setCache(agent.telephone, selectedDate, newTxs);

    if (isOnline) {
      const saved = await saveTx(tx);
      if (saved) {
        const updated = [saved, ...txs];
        setTxs(updated);
        setCache(agent.telephone, selectedDate, updated);
      }
    } else {
      // Stocker pour sync plus tard
      addPending(tx);
      setPendingCount(p => p+1);
    }
    setSaving(false); setModal(null); setForm({});
    setFlash(modal); setTimeout(()=>setFlash(null), 2200);
  }

  // ─── Supprimer ────────────────────────────────────────────────────────
  async function removeTx(id) {
    await deleteTx(id);
    const updated = txs.filter(t=>t.id!==id);
    setTxs(updated);
    setCache(agent.telephone, selectedDate, updated);
    setConfirm(null);
  }

  // ─── Partage WhatsApp ─────────────────────────────────────────────────
  function shareReport() {
    const dateLabel = new Date(selectedDate).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    const report = `📊 *Point du jour — My Somme*\n📅 ${dateLabel}\n👤 Agent : ${agent.nom}\n\n⬇️ Dépôts : ${fF(sum(t=>t.type==="depot"))}\n⬆️ Retraits : ${fF(sum(t=>t.type==="retrait"))}\n📶 Forfaits : ${fF(sum(t=>t.type==="forfait"))}\n\n💰 *CA Total : ${fF(totalCA)}*\n✅ *Commission : ${fF(totalCom)}*\n\n_Généré par My Somme_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, "_blank");
  }

  // ─── Calendrier ───────────────────────────────────────────────────────
  function getDaysInMonth(y,m) { return new Date(y,m,0).getDate(); }
  function getFirstDay(y,m)    { return new Date(y,m-1,1).getDay(); }
  function formatDateLabel(str) {
    if (str===todayStr()) return "Aujourd'hui";
    return new Date(str).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  }

  // ─── Auth ──────────────────────────────────────────────────────────────
  if (!agent) return <Inscription onDone={a=>{setAgent(a);setLocked(false);}} T={T} />;
  if (locked)  return <PinPad title="Bon retour 👋" subtitle={`Continue ${agent.nom}`} onSubmit={handleUnlock} T={T} error={pinErr} />;

  // ─── NAV ITEMS ─────────────────────────────────────────────────────────
  const navItems = [
    { key:"accueil",    icon:"🏠", label:"Accueil"    },
    { key:"stats",      icon:"📊", label:"Stats"      },
    { key:"historique", icon:"🗂️", label:"Historique" },
  ];

  // ─── LAYOUT ────────────────────────────────────────────────────────────
  return (
    <div style={{ background:T.bg, minHeight:"100vh", width:"100%", color:T.text, fontFamily:"'Segoe UI', system-ui, sans-serif", position:"relative", overflowX:"hidden", transition:"background 0.3s", display:"flex", flexDirection:"column" }}>

      {/* FLASH */}
      {flash && (
        <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", background:TYPE_COLOR[flash], color:flash==="forfait"?"#000":"#fff", borderRadius:14, padding:"12px 28px", fontWeight:800, fontSize:14, zIndex:999, boxShadow:"0 6px 30px #0006", whiteSpace:"nowrap", animation:"fadeIn 0.2s ease" }}>
          ✅ {TYPE_LABEL[flash]} sauvegardé !
        </div>
      )}

      {/* BANDEAU HORS LIGNE */}
      {!isOnline && (
        <div style={{ background:"#FFB80018", borderBottom:"1px solid #FFB80040", padding:"7px 16px", textAlign:"center", fontSize:11, color:"#FFB800", fontWeight:700, zIndex:60 }}>
          📴 Mode hors ligne — tes données sont sauvegardées localement{pendingCount > 0 ? ` (${pendingCount} op. en attente de sync)` : ""}
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div style={{ background:"#00C89618", borderBottom:"1px solid #00C89640", padding:"7px 16px", textAlign:"center", fontSize:11, color:"#00C896", fontWeight:700, zIndex:60 }}>
          🔄 Synchronisation de {pendingCount} opération(s) en cours…
        </div>
      )}

      {/* ══ LAYOUT DESKTOP ══ */}
      {isDesktop ? (
        <div style={{ display:"flex", minHeight:"100vh" }}>

          {/* SIDEBAR */}
          <aside style={{ width:240, background:T.card, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", position:"fixed", top:0, left:0, bottom:0, zIndex:50 }}>
            {/* Logo */}
            <div style={{ padding:"24px 20px 20px", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:40, height:40, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:15, color:"#fff", boxShadow:"0 2px 12px #00C89640" }}>MS</div>
                <div>
                  <div style={{ fontWeight:900, fontSize:16, letterSpacing:"-0.5px" }}>My Somme</div>
                  <div style={{ fontSize:10, color:T.sub }}>Agent MoMo</div>
                </div>
              </div>
            </div>
            {/* Nav */}
            <nav style={{ flex:1, padding:"16px 12px" }}>
              {navItems.map(n=>(
                <button key={n.key} onClick={()=>setTab(n.key)}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:11, border:"none", background:tab===n.key?"#00C89618":"transparent", color:tab===n.key?"#00C896":T.sub, fontWeight:tab===n.key?800:500, fontSize:14, cursor:"pointer", marginBottom:4, transition:"all 0.15s", textAlign:"left" }}>
                  <span style={{ fontSize:18 }}>{n.icon}</span>{n.label}
                  {tab===n.key && <div style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#00C896" }} />}
                </button>
              ))}
            </nav>
            {/* Infos agent + déconnexion */}
            <div style={{ padding:"14px 16px", borderTop:`1px solid ${T.border}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <div style={{ width:36, height:36, background:OP_BG[agent.reseau]||OP_BG_D.MTN, border:`1px solid ${OP_COLORS[agent.reseau]||"#00C896"}40`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:900, color:OP_COLORS[agent.reseau]||"#00C896", flexShrink:0 }}>
                  {agent.nom?.charAt(0)?.toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{agent.nom}</div>
                  <div style={{ fontSize:10, color:T.sub }}>{agent.reseau} · +229 {agent.telephone}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setDark(d=>!d)} style={{ flex:1, padding:"8px 0", background:T.hero, border:`1px solid ${T.border}`, borderRadius:9, cursor:"pointer", fontSize:14 }}>{dark?"☀️":"🌙"}</button>
                <button onClick={()=>setShowLogout(true)} style={{ flex:1, padding:"8px 0", background:"#E6394618", border:"1px solid #E6394640", borderRadius:9, cursor:"pointer", fontSize:12, color:"#E63946", fontWeight:700 }}>🚪 Quitter</button>
              </div>
            </div>
          </aside>

          {/* CONTENU PRINCIPAL DESKTOP */}
          <main style={{ flex:1, marginLeft:240, padding:"0 0 40px 0", maxWidth:"calc(100vw - 240px)" }}>
            {/* Header Desktop */}
            <div style={{ background:T.card, padding:"16px 32px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:40 }}>
              <div>
                <div style={{ fontWeight:900, fontSize:18 }}>{navItems.find(n=>n.key===tab)?.icon} {navItems.find(n=>n.key===tab)?.label}</div>
                <div style={{ fontSize:12, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {isToday && (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{setModal("forfait");setForm({});}} style={{ padding:"9px 16px", borderRadius:10, background:"#FFB80018", border:"1px solid #FFB80040", color:"#FFB800", fontWeight:700, fontSize:13, cursor:"pointer" }}>📶 Forfait</button>
                    <button onClick={()=>{setModal("retrait");setForm({});}} style={{ padding:"9px 16px", borderRadius:10, background:"#4F8EF718", border:"1px solid #4F8EF740", color:"#4F8EF7", fontWeight:700, fontSize:13, cursor:"pointer" }}>⬆️ Retrait</button>
                    <button onClick={()=>{setModal("depot");setForm({});}} style={{ padding:"9px 16px", borderRadius:10, background:"#00C89618", border:"1px solid #00C89640", color:"#00C896", fontWeight:700, fontSize:13, cursor:"pointer" }}>⬇️ Dépôt</button>
                  </div>
                )}
                <button onClick={()=>setShowCal(true)} style={{ background:T.hero, border:`1px solid ${T.border}`, borderRadius:9, padding:"8px 12px", cursor:"pointer", fontSize:15 }}>📅</button>
                <button onClick={shareReport} style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:9, padding:"8px 12px", cursor:"pointer", fontSize:15 }}>📤</button>
                <div style={{ background:isOnline?"#00C89618":"#FFB80018", color:isOnline?"#00C896":"#FFB800", borderRadius:20, padding:"4px 10px", fontSize:10, fontWeight:700, border:`1px solid ${isOnline?"#00C89630":"#FFB80030"}` }}>
                  {loading?"⏳":isOnline?"🟢 En ligne":"📴 Hors ligne"}
                </div>
              </div>
            </div>

            <div style={{ padding:"24px 32px" }}>
              <MainContent tab={tab} txs={txs} loading={loading} isToday={isToday} totalCA={totalCA} totalCom={totalCom} sum={sum} com={com} agent={agent} OP_BG={OP_BG} T={T} setConfirm={setConfirm} shareReport={shareReport} selectedDate={selectedDate} setSelectedDate={setSelectedDate} setTab={setTab} isDesktop={isDesktop} />
            </div>
          </main>
        </div>
      ) : (
        /* ══ LAYOUT MOBILE / TABLETTE ══ */
        <>
          {/* HEADER */}
          <div style={{ background:T.card, padding: isMobile ? "12px 16px" : "14px 24px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:50 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, background:"linear-gradient(135deg,#00C896,#00A5FF)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:13, color:"#fff" }}>MS</div>
              <div>
                <div style={{ fontWeight:900, fontSize:15, letterSpacing:"-0.5px" }}>My Somme</div>
                <div style={{ fontSize:10, color:T.sub }}>{formatDateLabel(selectedDate)}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={()=>setDark(d=>!d)} style={{ background:dark?"#22263A":"#E4E8F5", border:"none", borderRadius:20, padding:"5px 9px", cursor:"pointer", fontSize:15 }}>{dark?"☀️":"🌙"}</button>
              <button onClick={()=>setShowCal(true)} style={{ background:dark?"#22263A":"#E4E8F5", border:"none", borderRadius:9, padding:"6px 9px", cursor:"pointer", fontSize:15 }}>📅</button>
              <button onClick={shareReport} style={{ background:"#00C89618", border:"1px solid #00C89630", borderRadius:9, padding:"6px 9px", cursor:"pointer", fontSize:15 }}>📤</button>
              <button onClick={()=>setShowLogout(true)} style={{ background:"#E6394618", border:"1px solid #E6394640", borderRadius:9, padding:"6px 9px", cursor:"pointer", fontSize:15 }} title="Déconnexion">🚪</button>
              <div style={{ background:isOnline?"#00C89618":"#FFB80018", color:isOnline?"#00C896":"#FFB800", borderRadius:20, padding:"3px 8px", fontSize:10, fontWeight:700, border:`1px solid ${isOnline?"#00C89630":"#FFB80030"}` }}>
                {loading?"⏳":isOnline?"🟢":"📴"}
              </div>
            </div>
          </div>

          {/* BANDEAU DATE PASSÉE */}
          {!isToday && (
            <div style={{ background:"#4F8EF720", border:`1px solid #4F8EF740`, margin: isMobile ? "10px 14px 0" : "12px 24px 0", borderRadius:11, padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#4F8EF7" }}>📅 {new Date(selectedDate).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
              <button onClick={()=>setSelectedDate(todayStr())} style={{ background:"#4F8EF7", border:"none", borderRadius:7, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>Aujourd'hui</button>
            </div>
          )}

          <div style={{ padding: isMobile ? "12px 14px 100px" : "16px 24px 100px" }}>
            <MainContent tab={tab} txs={txs} loading={loading} isToday={isToday} totalCA={totalCA} totalCom={totalCom} sum={sum} com={com} agent={agent} OP_BG={OP_BG} T={T} setConfirm={setConfirm} shareReport={shareReport} selectedDate={selectedDate} setSelectedDate={setSelectedDate} setTab={setTab} isDesktop={false} />
          </div>

          {/* FABs MOBILE */}
          {isToday && (
            <div style={{ position:"fixed", bottom: isMobile ? 72 : 80, right: isMobile ? 14 : 24, display:"flex", flexDirection:"column", gap:10, zIndex:60 }}>
              <button onClick={()=>{setModal("forfait");setForm({});}} style={{ width:48, height:48, borderRadius:"50%", background:"#FFB800", border:"none", color:"#000", fontSize:18, cursor:"pointer", boxShadow:"0 4px 18px #FFB80060", display:"flex", alignItems:"center", justifyContent:"center" }}>📶</button>
              <button onClick={()=>{setModal("retrait");setForm({});}} style={{ width:48, height:48, borderRadius:"50%", background:"#4F8EF7", border:"none", color:"#fff", fontSize:18, cursor:"pointer", boxShadow:"0 4px 18px #4F8EF760", display:"flex", alignItems:"center", justifyContent:"center" }}>⬆️</button>
              <button onClick={()=>{setModal("depot");setForm({});}} style={{ width:56, height:56, borderRadius:"50%", background:"linear-gradient(135deg,#00C896,#009E78)", border:"none", color:"#fff", fontSize:22, cursor:"pointer", boxShadow:"0 6px 24px #00C89660", display:"flex", alignItems:"center", justifyContent:"center" }}>⬇️</button>
            </div>
          )}

          {/* BOTTOM NAV */}
          <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:T.nav, borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-around", padding: isMobile ? "8px 0 18px" : "10px 0 16px", zIndex:50 }}>
            {navItems.map(({key,icon,label})=>(
              <button key={key} onClick={()=>setTab(key)} style={{ background:"none", border:"none", color:tab===key?"#00C896":T.faint, fontSize: isMobile ? 10 : 12, fontWeight:tab===key?800:500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding: isMobile ? "0 16px" : "0 24px" }}>
                <span style={{ fontSize: isMobile ? 22 : 24 }}>{icon}</span>{label}
                {tab===key && <div style={{ width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
              </button>
            ))}
          </nav>
        </>
      )}

      {/* ══ MODAL DÉCONNEXION ══ */}
      {showLogout && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:"0 24px" }}>
          <div style={{ background:T.card, borderRadius:20, padding:28, width:"100%", maxWidth:320, border:`1px solid ${T.border2}`, boxShadow:"0 10px 40px #0008" }}>
            <div style={{ fontSize:36, textAlign:"center", marginBottom:12 }}>🚪</div>
            <div style={{ fontSize:18, fontWeight:900, marginBottom:8, textAlign:"center" }}>Se déconnecter ?</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:24, textAlign:"center" }}>
              Tes données restent sauvegardées. Tu pourras te reconnecter avec ton numéro et ton PIN.
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowLogout(false)} style={{ flex:1, padding:14, borderRadius:12, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer", fontSize:14 }}>Annuler</button>
              <button onClick={handleLogout} style={{ flex:1, padding:14, borderRadius:12, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer", fontSize:14 }}>Déconnecter</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CALENDRIER ══ */}
      {showCal && (
        <div style={{ position:"fixed", inset:0, background:"#000B", display:"flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: isDesktop ? "center" : "stretch", zIndex:300 }} onClick={()=>setShowCal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius: isDesktop ? 20 : "20px 20px 0 0", padding:"18px 16px 34px", border:`1px solid ${T.border2}`, width: isDesktop ? 360 : "100%", maxWidth: isDesktop ? 360 : "100%" }}>
            <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <button onClick={()=>{if(calMonth===1){setCalMonth(12);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{ background:T.hero, border:"none", borderRadius:8, width:34, height:34, cursor:"pointer", fontSize:18, color:T.text }}>‹</button>
              <div style={{ fontWeight:800, fontSize:15 }}>{MOIS_FR[calMonth-1]} {calYear}</div>
              <button onClick={()=>{if(calMonth===12){setCalMonth(1);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{ background:T.hero, border:"none", borderRadius:8, width:34, height:34, cursor:"pointer", fontSize:18, color:T.text }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:8 }}>
              {JOURS.map(j=>(<div key={j} style={{ textAlign:"center", fontSize:10, color:T.sub, fontWeight:700, padding:"3px 0" }}>{j}</div>))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array(getFirstDay(calYear,calMonth)).fill(null).map((_,i)=>(<div key={`e${i}`} />))}
              {Array(getDaysInMonth(calYear,calMonth)).fill(null).map((_,i)=>{
                const day=i+1, ds=`${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isTod=ds===todayStr(), isSel=ds===selectedDate, has=activeDays.includes(ds), isFut=ds>todayStr();
                return (
                  <button key={day} disabled={isFut} onClick={()=>{setSelectedDate(ds);setShowCal(false);setTab("accueil");}}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:10, border:isSel?"2px solid #00C896":isTod?`2px solid ${OP_COLORS.MTN}`:`1px solid ${T.border}`, background:isSel?"#00C89620":isTod?"#FFB80015":T.hero, color:isFut?T.faint:isSel?"#00C896":T.text, fontWeight:isSel||isTod?800:500, fontSize:13, cursor:isFut?"not-allowed":"pointer", position:"relative", display:"flex", alignItems:"center", justifyContent:"center", opacity:isFut?0.3:1, transition:"all 0.1s" }}>
                    {day}
                    {has && !isSel && <div style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:4, height:4, borderRadius:"50%", background:"#00C896" }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ CONFIRM SUPPRESSION ══ */}
      {confirm && (
        <div style={{ position:"fixed", inset:0, background:"#000C", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:"0 24px" }}>
          <div style={{ background:T.card, borderRadius:18, padding:24, width:"100%", maxWidth:300, border:`1px solid ${T.border2}` }}>
            <div style={{ fontSize:17, fontWeight:900, marginBottom:8 }}>🗑️ Supprimer ?</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:20 }}>Cette opération sera effacée définitivement.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirm(null)} style={{ flex:1, padding:13, borderRadius:11, background:T.hero, border:`1px solid ${T.border2}`, color:T.text, fontWeight:700, cursor:"pointer" }}>Annuler</button>
              <button onClick={()=>removeTx(confirm)} style={{ flex:1, padding:13, borderRadius:11, background:"#E63946", border:"none", color:"#fff", fontWeight:800, cursor:"pointer" }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL SAISIE ══ */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"#000B", display:"flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: isDesktop ? "center" : "stretch", zIndex:200 }} onClick={()=>setModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.card, borderRadius: isDesktop ? 20 : "20px 20px 0 0", padding:"18px 20px 40px", border:`1px solid ${T.border2}`, width: isDesktop ? 460 : "100%", maxWidth: isDesktop ? 460 : "100%", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ width:36, height:4, background:T.border2, borderRadius:2, margin:"0 auto 16px" }} />
            <div style={{ fontWeight:900, fontSize:17, marginBottom:16 }}>
              {modal==="depot"?"⬇️ Nouveau Dépôt":modal==="retrait"?"⬆️ Nouveau Retrait":"📶 Vente Forfait Internet"}
            </div>
            {form.operateur && (
              <div style={{ background:"#00C89610", border:"1px solid #00C89630", borderRadius:10, padding:"8px 13px", marginBottom:14, fontSize:12, color:"#00C896" }}>
                💰 Commission : {(COMMISSIONS[form.operateur][modal]*100).toFixed(1)}%{form.montant?` → ${fF(calcCom(modal,form.operateur,Number(form.montant)))}` : ""}
              </div>
            )}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>OPÉRATEUR</div>
              <div style={{ display:"flex", gap:8 }}>
                {OPERATORS.map(op=>(
                  <button key={op} onClick={()=>setForm(f=>({...f,operateur:op,forfait:null,montant:""}))}
                    style={{ flex:1, padding:"11px 0", borderRadius:11, border:`2px solid ${form.operateur===op?OP_COLORS[op]:T.border}`, background:form.operateur===op?OP_BG[op]:"transparent", color:form.operateur===op?OP_COLORS[op]:T.sub, fontWeight:800, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
                    {op}
                  </button>
                ))}
              </div>
            </div>
            {modal==="forfait" && form.operateur && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>FORFAIT</div>
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {FORFAITS[form.operateur].map(f=>(
                    <button key={f.label} onClick={()=>setForm(p=>({...p,forfait:f.label,montant:f.montant}))}
                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 14px", borderRadius:11, border:`2px solid ${form.forfait===f.label?OP_COLORS[form.operateur]:T.border}`, background:form.forfait===f.label?OP_BG[form.operateur]:"transparent", cursor:"pointer", transition:"all 0.1s" }}>
                      <div style={{ fontWeight:800, fontSize:12, color:form.forfait===f.label?OP_COLORS[form.operateur]:T.text }}>{f.data} · {f.duree}</div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontWeight:900, fontSize:13, color:form.forfait===f.label?OP_COLORS[form.operateur]:T.text }}>{fF(f.montant)}</div>
                        <div style={{ fontSize:10, color:"#00C896" }}>comm. {fF(Math.round(f.montant*COMMISSIONS[form.operateur].forfait))}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modal!=="forfait" && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>MONTANT (FCFA)</div>
                <input type="number" placeholder="Ex : 5000" value={form.montant||""}
                  onChange={e=>setForm(f=>({...f,montant:e.target.value}))}
                  style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"14px 16px", color:T.text, fontSize:18, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
              </div>
            )}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>NOM DU CLIENT (optionnel)</div>
              <input type="text" placeholder="Ex : Kofi Mensah" value={form.client||""}
                onChange={e=>setForm(f=>({...f,client:e.target.value}))}
                style={{ width:"100%", background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 15px", color:T.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:T.sub, marginBottom:8, fontWeight:700 }}>NUMÉRO DE TÉLÉPHONE (optionnel)</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 10px", color:T.text, fontSize:12, fontWeight:700, flexShrink:0 }}>🇧🇯 +229</div>
                <input type="tel" placeholder="97 00 00 00" value={form.telephone||""}
                  onChange={e=>setForm(f=>({...f,telephone:e.target.value}))}
                  style={{ flex:1, background:T.input, border:`2px solid ${T.border}`, borderRadius:12, padding:"12px 14px", color:T.text, fontSize:15, fontWeight:700, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <button onClick={addTx} disabled={saving}
              style={{ width:"100%", padding:16, borderRadius:14, background:saving?"#1A1D2E":modal==="depot"?"#00C896":modal==="retrait"?"#4F8EF7":"#FFB800", border:"none", color:saving?T.sub:modal==="forfait"?"#000":"#fff", fontWeight:900, fontSize:16, cursor:saving?"not-allowed":"pointer", transition:"all 0.2s" }}>
              {saving?"⏳ Sauvegarde…":"Enregistrer ✓"}
            </button>
            {!isOnline && <div style={{ textAlign:"center", fontSize:11, color:"#FFB800", marginTop:8 }}>📴 Sera synchronisé dès que tu seras en ligne</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CONTENU PRINCIPAL (partagé mobile/desktop) ─────────────────────────
function MainContent({ tab, txs, loading, isToday, totalCA, totalCom, sum, com, agent, OP_BG, T, setConfirm, shareReport, selectedDate, setSelectedDate, setTab, isDesktop }) {

  function getDaysInMonth(y,m) { return new Date(y,m,0).getDate(); }

  if (tab === "accueil") return (
    <>
      {/* HERO CARD */}
      <div style={{ background:`linear-gradient(135deg,${T.hero},${T.card})`, borderRadius:18, padding:isDesktop?20:16, marginBottom:14, border:`1px solid ${T.border2}` }}>
        <div style={{ fontSize:11, color:T.sub, marginBottom:3 }}>{isToday?"Chiffre d'affaires aujourd'hui":"Chiffre d'affaires"}</div>
        <div style={{ fontSize:isDesktop?38:32, fontWeight:900, color:"#00C896", letterSpacing:-1 }}>{fF(totalCA)}</div>
        <div style={{ display:"flex", gap:isDesktop?32:20, marginTop:12, flexWrap:"wrap" }}>
          <div><div style={{ fontSize:10, color:T.sub }}>Opérations</div><div style={{ fontSize:isDesktop?20:16, fontWeight:800 }}>{txs.length}</div></div>
          <div><div style={{ fontSize:10, color:T.sub }}>Commission</div><div style={{ fontSize:isDesktop?20:16, fontWeight:800, color:"#FFB800" }}>{fF(totalCom)}</div></div>
          <div><div style={{ fontSize:10, color:T.sub }}>Agent</div><div style={{ fontSize:isDesktop?18:14, fontWeight:700, color:OP_COLORS[agent.reseau]||"#00C896" }}>{agent.nom?.split(" ")[0]}</div></div>
        </div>
      </div>

      {/* CARTES RÉSUMÉ */}
      <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(4,1fr)" : "1fr 1fr", gap:10, marginBottom:14 }}>
        {[
          {label:"Dépôts",   value:sum(t=>t.type==="depot"),   c:com(t=>t.type==="depot"),   icon:"⬇️", color:"#00C896"},
          {label:"Retraits", value:sum(t=>t.type==="retrait"), c:com(t=>t.type==="retrait"), icon:"⬆️", color:"#4F8EF7"},
          {label:"Forfaits", value:sum(t=>t.type==="forfait"), c:com(t=>t.type==="forfait"), icon:"📶", color:"#FFB800"},
          {label:"Commission totale", value:totalCom, c:null, icon:"💰", color:"#E63946"},
        ].map((s,i)=>(
          <div key={i} style={{ background:T.card, borderRadius:14, padding:isDesktop?16:13, border:`1px solid ${s.color}22` }}>
            <div style={{ fontSize:isDesktop?22:20 }}>{s.icon}</div>
            <div style={{ fontSize:isDesktop?22:18, fontWeight:900, color:s.color, marginTop:6 }}>{fF(s.value)}</div>
            {s.c!==null && <div style={{ fontSize:10, color:T.sub, marginTop:2 }}>comm. {fF(s.c)}</div>}
            <div style={{ fontSize:10, color:T.faint, marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* PAR OPÉRATEUR */}
      <div style={{ background:T.card, borderRadius:16, padding:isDesktop?18:15, marginBottom:14, border:`1px solid ${T.border}` }}>
        <div style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>Par opérateur</div>
        {OPERATORS.map((op,i)=>{
          const o = txs.filter(t=>t.operateur===op);
          return (
            <div key={op} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:i<2?`1px solid ${T.border}`:"none" }}>
              <div style={{ width:32, height:32, background:OP_BG[op], border:`1px solid ${OP_COLORS[op]}40`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:OP_COLORS[op], flexShrink:0 }}>{op}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:700 }}>{op}</div>
                <div style={{ fontSize:10, color:T.sub }}>{o.length} op. · comm. {fF(o.reduce((s,t)=>s+Number(t.commission),0))}</div>
              </div>
              <div style={{ fontWeight:900, color:OP_COLORS[op], fontSize:14 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</div>
            </div>
          );
        })}
      </div>

      {/* BOUTON WHATSAPP */}
      <button onClick={shareReport} style={{ width:"100%", padding:15, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        <span style={{ fontSize:20 }}>📤</span> Envoyer le point du jour sur WhatsApp
      </button>

      {/* DERNIÈRES OPÉRATIONS */}
      <div style={{ background:T.card, borderRadius:16, padding:isDesktop?18:15, border:`1px solid ${T.border}` }}>
        <div style={{ fontWeight:800, fontSize:13, marginBottom:12 }}>Dernières opérations</div>
        {loading && <div style={{ textAlign:"center", color:T.faint, padding:"20px 0", fontSize:12 }}>⏳ Chargement…</div>}
        {!loading && txs.length===0 && <div style={{ textAlign:"center", color:T.faint, padding:"28px 0", fontSize:13 }}>{isToday?"Aucune opération · Appuie sur ⬇️ ⬆️ ou 📶":"Aucune opération ce jour"}</div>}
        {txs.slice(0,8).map((t,i)=>(
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:i<Math.min(txs.length,8)-1?`1px solid ${T.border}`:"none" }}>
            <div style={{ width:36, height:36, borderRadius:10, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{TYPE_ICON[t.type]}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700 }}>{TYPE_LABEL[t.type]} <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
              <div style={{ fontSize:10, color:T.sub, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}{t.forfait?` · ${t.forfait}`:""}</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:13 }}>{fF(t.montant)}</div>
              <div style={{ fontSize:10, color:T.sub }}>+{fF(t.commission)}</div>
            </div>
            {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14, flexShrink:0, padding:"0 4px" }}>🗑️</button>}
          </div>
        ))}
        {txs.length > 8 && (
          <button onClick={()=>setTab("historique")} style={{ width:"100%", padding:"10px 0", marginTop:8, background:"transparent", border:`1px solid ${T.border}`, borderRadius:10, color:T.sub, fontSize:12, cursor:"pointer" }}>
            Voir tout l'historique ({txs.length} opérations) →
          </button>
        )}
      </div>
    </>
  );

  if (tab === "stats") return (
    <div>
      <div style={{ fontWeight:900, fontSize:isDesktop?20:16, marginBottom:16 }}>📊 Statistiques</div>
      <div style={{ background:"linear-gradient(135deg,#1A2810,#1A2030)", borderRadius:16, padding:isDesktop?20:16, marginBottom:14, border:"1px solid #00C89630" }}>
        <div style={{ fontSize:11, color:"#4A7050", marginBottom:4 }}>💰 Commission {isToday?"du jour":"ce jour"}</div>
        <div style={{ fontSize:isDesktop?36:28, fontWeight:900, color:"#00C896" }}>{fF(totalCom)}</div>
        <div style={{ fontSize:11, color:"#3A5040", marginTop:6 }}>Dépôt 0.5% · Retrait MTN/MOOV 1.5% · Retrait Celtiis 1% · Forfaits 6-7%</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(3,1fr)" : "1fr", gap:12, marginBottom:14 }}>
        {["depot","retrait","forfait"].map(type=>{
          const tTxs = txs.filter(t=>t.type===type);
          return (
            <div key={type} style={{ background:T.card, borderRadius:14, padding:isDesktop?18:15, border:`1px solid ${TYPE_COLOR[type]}22` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                <div style={{ fontWeight:800, fontSize:13 }}>{TYPE_ICON[type]} {TYPE_LABEL[type]}s</div>
                <div><span style={{ color:TYPE_COLOR[type], fontWeight:900 }}>{fF(tTxs.reduce((s,t)=>s+Number(t.montant),0))}</span><span style={{ color:T.sub, fontSize:11 }}> · {fF(tTxs.reduce((s,t)=>s+Number(t.commission),0))}</span></div>
              </div>
              {OPERATORS.map((op,i)=>{
                const o = txs.filter(t=>t.type===type&&t.operateur===op);
                return (
                  <div key={op} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:i<2?`1px solid ${T.border}`:"none", fontSize:12 }}>
                    <div><span style={{ color:OP_COLORS[op], fontWeight:700 }}>{op}</span><span style={{ color:T.faint, fontSize:10 }}> {o.length}x · {(COMMISSIONS[op][type]*100).toFixed(1)}%</span></div>
                    <div><span style={{ fontWeight:700 }}>{fF(o.reduce((s,t)=>s+Number(t.montant),0))}</span><span style={{ color:T.sub, fontSize:10 }}> +{fF(o.reduce((s,t)=>s+Number(t.commission),0))}</span></div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <button onClick={shareReport} style={{ width:"100%", padding:15, borderRadius:14, background:"linear-gradient(135deg,#25D366,#128C7E)", border:"none", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        <span style={{ fontSize:20 }}>📤</span> Partager ce rapport
      </button>
    </div>
  );

  if (tab === "historique") return (
    <div>
      <div style={{ fontWeight:900, fontSize:isDesktop?20:16, marginBottom:16 }}>🗂️ Historique</div>
      {loading && <div style={{ textAlign:"center", color:T.faint, padding:"40px 0" }}>⏳ Chargement…</div>}
      {!loading && txs.length===0 && <div style={{ textAlign:"center", color:T.faint, padding:"48px 0", fontSize:13 }}>Aucune opération {isToday?"enregistrée":"ce jour"}</div>}
      <div style={{ display:"grid", gridTemplateColumns: isDesktop ? "repeat(2,1fr)" : "1fr", gap:8 }}>
        {txs.map(t=>(
          <div key={t.id} style={{ background:T.card, borderRadius:13, padding:"12px 14px", border:`1px solid ${TYPE_COLOR[t.type]}18`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:34, height:34, borderRadius:10, background:`${TYPE_COLOR[t.type]}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>{TYPE_ICON[t.type]}</div>
              <div>
                <div style={{ fontWeight:700, fontSize:12 }}>{TYPE_LABEL[t.type]} · <span style={{ color:OP_COLORS[t.operateur] }}>{t.operateur}</span></div>
                <div style={{ fontSize:10, color:T.sub, marginTop:1 }}>{t.client}{t.telephone?` · +229 ${t.telephone}`:""} · {t.heure}{t.forfait?` · ${t.forfait}`:""}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:900, color:TYPE_COLOR[t.type], fontSize:14 }}>{fF(t.montant)}</div>
                <div style={{ fontSize:10, color:T.sub }}>+{fF(t.commission)}</div>
              </div>
              {isToday && <button onClick={()=>setConfirm(t.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14 }}>🗑️</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return null;
}

const OP_COLORS = { MTN: "#FFB800", MOOV: "#0066CC", Celtiis: "#E63946" };
