// pages/_app.js
// Layout global : Gate (code d'accès) + Nav (navigation principale) + page.
import "../styles/globals.css";
import Head from "next/head";
import Gate from "../components/Gate";
import Nav from "../components/Nav";
import NotesWidget from "../components/NotesWidget";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* viewport-fit=cover : les marges env(safe-area-inset-*) des iPhone à encoche
            sont prises en compte (voir globals.css). Le zoom reste autorisé. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" key="viewport" />
        <meta name="theme-color" content="#1f3a5f" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Ouvre la connexion à Firestore pendant le chargement du code. */}
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="anonymous" />
      </Head>
      <Gate>
        <Nav />
        <Component {...pageProps} />
        <NotesWidget />
      </Gate>
    </>
  );
}
