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
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <Gate>
        <Nav />
        <Component {...pageProps} />
        <NotesWidget />
      </Gate>
    </>
  );
}
