// pages/index.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
import Gate from "../components/Gate";

const HOTEL = {
  name: "Hôtel Le Belleville",
  addr: "188 bis rue de Belleville, 75020 Paris",
};

function esc(s) { return s == null ? "" : String(s); }
function fmtDate(d) {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("fr-FR");
}
function customMap(r) {
  const m = {};
  (r.customFieldValues || []).forEach(c => {
    m[(c.customField?.name || c.name || "").toLowerCase()] = c.value;
  });
  return m;
}

function Cell({ lbl, value, full }) {
  return (
    <div className={"cell" + (full ? " full" : "")}>
      <div className="lbl">{lbl}</div>
      {value ? <div className="val">{value}</div> : <div className="val blank" />}
    </div>
  );
}

function Sheet({ r }) {
  const c = customMap(r);
  const adresse = c["adresse"] || c["adresse personnelle"] || c["domicile"] || c["home address"] || r.guestAddress || "";
  const ville = c["ville"] || c["city"] || r.guestCity || "";
  const pays = c["pays"] || c["nationalité"] || c["nationality"] || r.guestCountry || "";
  const naiss = c["date de naissance"] || c["naissance"] || c["date of birth"] || "";
  const lieuNaiss = c["lieu de naissance"] || c["place of birth"] || "";
  const nom = [r.guestFirstName, r.guestName || r.guestLastName].filter(Boolean).join(" ") || r.guestName || "";
  const today = new Date().toLocaleDateString("fr-FR");

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div className="hotel">{HOTEL.name}<small>{HOTEL.addr}</small></div>
        <div className="doc-title">
          <div className="t1">Fiche Individuelle de Police</div>
          <div className="t2">Individual Police Registration Form · Art. R.611-42 CESEDA</div>
        </div>
      </div>

      <div className="legal">
        Fiche à remplir et signer par tout voyageur de nationalité étrangère (UE incluse) dès son arrivée /
        To be completed and signed by every foreign national guest on arrival.
        Conservation 6 mois · tenue à disposition de la police et de la gendarmerie.
      </div>

      <div className="grid">
        <div className="section-label">Séjour / Stay</div>
        <Cell lbl="N° de réservation / Booking ref." value={esc(r.hostawayReservationId || r.channelReservationId || r.id)} />
        <Cell lbl="Logement / Room" value={esc(r.listingName || r.listingMapId)} />
        <Cell lbl="Date d'arrivée / Date of arrival" value={fmtDate(r.arrivalDate || r.checkInDate)} />
        <Cell lbl="Date de départ prévue / Intended departure" value={fmtDate(r.departureDate || r.checkOutDate)} />

        <div className="section-label">Identité du voyageur / Guest identity</div>
        <Cell lbl="Nom et prénom(s) / Name and first name(s)" value={esc(nom)} full />
        <Cell lbl="Date de naissance / Date of birth" value={esc(naiss)} />
        <Cell lbl="Lieu de naissance / Place of birth" value={esc(lieuNaiss)} />
        <Cell lbl="Nationalité / Nationality" value={esc(pays)} />
        <Cell lbl="Ville / Code postal — City / Postcode" value={esc(ville)} />
        <Cell lbl="Domicile habituel / Permanent address" value={esc(adresse)} full />
        <Cell lbl="Téléphone mobile / Mobile phone" value={esc(r.phone)} />
        <Cell lbl="Adresse e-mail / E-mail address" value={esc(r.guestEmail)} />

        <div className="section-label">Enfants de moins de 15 ans accompagnants / Accompanying children under 15</div>
        <div className="cell full" style={{ minHeight: 38 }}>
          <div className="lbl">Nom, prénom, date de naissance / Name, first name, date of birth</div>
          <div className="val blank" style={{ height: 26 }} />
        </div>
      </div>

      <div className="rgpd">
        Conformément à la loi « Informatique et Libertés » n°78-17 du 6 janvier 1978 et au RGPD, vous disposez d'un droit
        d'accès et de rectification de vos données en contactant le responsable de l'établissement. /
        In accordance with the French Data Protection Act, you have the right to access and rectify your personal data.
      </div>

      <div className="footer-block">
        <div className="sig">
          <div className="lbl">Fait à Paris, le / Done in Paris, on {today}</div>
          <div className="line" />
          <div className="hint">Signature du voyageur / Guest signature</div>
        </div>
      </div>
    </div>
  );
}

function isoDay(d) { return d.toISOString().slice(0, 10); }

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

export default function App() {
  return (
    <Gate>
      <Home />
    </Gate>
  );
}

function Home() {
  const [day, setDay] = useState(isoDay(new Date()));
  const [list, setList] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [account, setAccount] = useState("");
  const [saved, setSaved] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Récupère les identifiants mémorisés à l'ouverture
  useEffect(() => {
    const k = typeof window !== "undefined" ? window.localStorage.getItem(KEY_KEY) : "";
    const a = typeof window !== "undefined" ? window.localStorage.getItem(ACCOUNT_KEY) : "";
    if (k) setApiKey(k);
    if (a) setAccount(a);
    if (k && a) setSaved(true);
  }, []);

  const load = useCallback(async (d, acc, key) => {
    if (!acc || !key) { setStatus("Renseigne l'Account ID et l'API Key."); setList(null); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/reservations?from=${d}&to=${d}`, {
        headers: {
          "x-hostaway-account": acc,
          "x-hostaway-key": key,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      const arr = data.result || [];
      setList(arr);
      setStatus(arr.length ? `${arr.length} arrivée(s)` : "Aucune arrivée ce jour");
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement auto : à l'ouverture (si identifiants présents) et à chaque changement de jour
  useEffect(() => {
    if (saved && account && apiKey) load(day, account, apiKey);
  }, [day, saved, account, apiKey, load]);

  function saveCreds() {
    if (!account.trim() || !apiKey.trim()) return;
    window.localStorage.setItem(ACCOUNT_KEY, account.trim());
    window.localStorage.setItem(KEY_KEY, apiKey.trim());
    setSaved(true);
    setShowSetup(false);
    load(day, account.trim(), apiKey.trim());
  }

  function forgetCreds() {
    window.localStorage.removeItem(ACCOUNT_KEY);
    window.localStorage.removeItem(KEY_KEY);
    setAccount(""); setApiKey(""); setSaved(false); setList(null);
    setStatus("Identifiants effacés.");
  }

  function shiftDay(n) {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDay(isoDay(d));
  }

  const dayLabel = new Date(day + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <>
      <Head><title>Fiches de Police du jour — Le Belleville</title></Head>

      <div className="toolbar">
        <h1>Fiches de Police</h1>

        {!saved || showSetup ? (
          <div className="token-setup">
            <input
              type="text"
              className="acc"
              placeholder="Account ID"
              value={account}
              onChange={e => setAccount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveCreds()}
              autoFocus
            />
            <input
              type="password"
              placeholder="API Key Hostaway…"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveCreds()}
            />
            <button className="arrow save" onClick={saveCreds} title="Enregistrer">→</button>
          </div>
        ) : (
          <>
            <div className="daynav">
              <button className="arrow" onClick={() => shiftDay(-1)} title="Jour précédent">‹</button>
              <div className="daylabel">{dayLabel}</div>
              <button className="arrow" onClick={() => shiftDay(1)} title="Jour suivant">›</button>
            </div>
            <button onClick={() => setDay(isoDay(new Date()))}>Aujourd'hui</button>
            <button onClick={() => load(day, account, apiKey)} disabled={loading} title="Actualiser">↻</button>
            <button className="primary" onClick={() => window.print()} disabled={!list || !list.length}>Imprimer</button>
            <button className="ghost" onClick={() => setShowSetup(true)} title="Changer les identifiants">⚙</button>
          </>
        )}

        <span className="status">{status}</span>
        <Link href="/menage" className="navlink">Ménages →</Link>
        {saved && !showSetup && (
          <button className="ghost forget" onClick={forgetCreds} title="Oublier les identifiants">Déconnecter</button>
        )}
      </div>

      <div className="sheets">
        {!saved && !loading && (
          <div className="empty-state">
            Renseigne ton <strong>Account ID</strong> et ton <strong>API Key</strong> Hostaway une seule fois,
            puis valide avec la flèche <strong>→</strong>. Ils restent enregistrés sur cet appareil :
            à la prochaine ouverture, les arrivées du jour s'afficheront automatiquement.
          </div>
        )}
        {loading && <div className="empty-state">Chargement des arrivées…</div>}
        {!loading && saved && list && list.length === 0 && (
          <div className="empty-state">Aucune arrivée ce jour.</div>
        )}
        {!loading && saved && list && list.map((r, i) => <Sheet key={i} r={r} />)}
      </div>
    </>
  );
}
