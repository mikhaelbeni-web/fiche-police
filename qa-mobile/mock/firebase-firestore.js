// Faux Firestore en mémoire pour l'audit mobile.
const t = new Date(); const iso = d => d.toISOString().slice(0,10);
const day = n => { const d = new Date(t); d.setDate(d.getDate()+n); return iso(d); };
const Q = (a,b,c,d,e,f,g) => ({ grande_serviette:a, housse:b, petite_serviette:c, tapis_bain:d, torchon:e, taie:f, drap:g });
const lines = { drap_clas:{qte:120,prixUnitaire:1.804}, drap_cocoon:{qte:150,prixUnitaire:1.157}, drap_horizon:{qte:0,prixUnitaire:1.157}, housse_stella:{qte:60,prixUnitaire:3.788}, eponge_cocoon:{qte:140,prixUnitaire:0.545}, eponge_horizon:{qte:0,prixUnitaire:0.545}, taie_clas:{qte:130,prixUnitaire:0.558}, tapis_harmony:{qte:70,prixUnitaire:0.759}, torchon_carreaux:{qte:30,prixUnitaire:0.651} };
const DB = {
  linen_stock: { belleville: Q(80,40,90,50,30,100,90) },
  linen_thresholds: { belleville: Q(20,10,20,10,5,20,20) },
  linen_prices: { belleville: { drap: 1.804, grande_serviette: 1.157, housse: 3.788, petite_serviette: 0.545, taie: 0.558, tapis_bain: 0.759, torchon: 0.651 } },
  linen_settings: { belleville: { bonDestinataires: ["a@example.com","b@example.com","c@example.com","d@example.com"] } },
  linen_orders: {
    o1: { date: day(-1), type: "mardi", quantities: Q(35,12,30,15,6,28,26), expectedReception: day(6), status: "commandee" },
    o2: { date: day(-6), type: "jeudi", quantities: Q(40,14,33,18,8,30,30), expectedReception: day(1), status: "recue" },
    o3: { date: day(-8), type: "mardi", quantities: Q(38,10,31,16,5,27,25), expectedReception: day(-1), status: "commandee" },
  },
  linen_receptions: {
    r1: { date: day(-1), orderDate: day(-8), orderType: "mardi", quantities: Q(36,10,31,16,5,25,25), commande: Q(38,10,31,16,5,27,25), ecart: Q(-2,0,0,0,0,-2,0) },
    r2: { date: day(-3), orderDate: null, orderType: null, quantities: Q(4,0,2,0,0,0,1), commande: null, ecart: Q(0,0,0,0,0,0,0) },
  },
  linen_used: { u1: { date: day(-1), quantities: Q(12,4,10,5,2,9,9) }, u2: { date: day(-2), quantities: Q(14,5,11,6,2,10,10) } },
  linen_defects: {
    d1: { date: day(-4), quantities: Q(2,0,1,0,0,1,0), remaining: Q(2,0,1,0,0,1,0), note: "taché", status: "accumule" },
    d2: { date: day(-10), quantities: Q(1,1,0,0,0,0,2), remaining: Q(1,0,0,0,0,0,1), note: "déchiré sur le bord, à vérifier", status: "renvoye", sentDate: day(-9) },
    d3: { date: day(-20), quantities: Q(3,0,0,0,0,0,0), remaining: Q(0,0,0,0,0,0,0), note: "", status: "revenu", returnedDate: day(-12) },
  },
  linen_invoices: {
    i1: { numFacture: "2600104-998618", dateFacture: day(-2), periodFrom: day(-20), periodTo: day(0), lines, autres: [{label:"Participation forfaitaire", qte:1, prixUnitaire:5, montant:5}], participationPerte: 12.4, netAPayer: 812.55, pdf: false },
    i2: { numFacture: "2600104-991111", dateFacture: day(-35), periodFrom: day(-60), periodTo: day(-31), lines, participationPerte: 10, netAPayer: 790.1 },
  },
};
let seq = 0;
export function collection(db, name){ return { name }; }
export function doc(db, name, id){ return { name, id }; }
export function query(c){ return c; } export function orderBy(){ return null; }
const snap = (id, data) => ({ id, exists: () => data != null, data: () => data });
export async function getDoc(r){ return snap(r.id, DB[r.name]?.[r.id]); }
export async function getDocs(c){ const o = DB[c.name] || {}; return { docs: Object.entries(o).map(([id,d]) => snap(id,d)) }; }
export async function setDoc(r, d, opt){ DB[r.name] = DB[r.name] || {}; DB[r.name][r.id] = opt?.merge ? { ...(DB[r.name][r.id]||{}), ...d } : d; }
export async function addDoc(c, d){ const id = "n"+(++seq); DB[c.name] = DB[c.name] || {}; DB[c.name][id] = d; return { id }; }
export async function updateDoc(r, d){ DB[r.name][r.id] = { ...DB[r.name][r.id], ...d }; }
export async function deleteDoc(r){ delete DB[r.name]?.[r.id]; }
export function getFirestore(){ return {}; }
