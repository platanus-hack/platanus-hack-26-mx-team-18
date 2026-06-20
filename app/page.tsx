export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", margin: 0 }}>🍌 team-18</h1>
      <p style={{ fontSize: "1.1rem", color: "#555", maxWidth: 480 }}>
        Proyecto Next.js listo. Edita <code>app/page.tsx</code> y guarda para
        ver los cambios en vivo.
      </p>
    </main>
  );
}
