// pages/_app.js
// Layout global : Gate (code d'accès) + Nav (navigation principale) + page.
import "../styles/globals.css";
import Gate from "../components/Gate";
import Nav from "../components/Nav";
import NotesWidget from "../components/NotesWidget";

export default function App({ Component, pageProps }) {
  return (
    <Gate>
      <Nav />
      <Component {...pageProps} />
      <NotesWidget />
    </Gate>
  );
}
