// pages/_app.js
// Layout global : Gate (code d'accès) + Nav (navigation principale) + page.
import "../styles/globals.css";
import Gate from "../components/Gate";
import Nav from "../components/Nav";

export default function App({ Component, pageProps }) {
  return (
    <Gate>
      <Nav />
      <Component {...pageProps} />
    </Gate>
  );
}
