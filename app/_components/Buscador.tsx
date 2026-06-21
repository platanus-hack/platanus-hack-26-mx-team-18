"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { createClient } from "@/lib/supabase/client";
import { rasgosATexto } from "@/lib/rasgos";
import { validarBusqueda } from "@/lib/buscar/validacion";
import { referenciaForense } from "@/lib/fuentes/referencia";
import { acotarPuntaje, PUNTAJE_MAX } from "@/lib/matching/score";
import styles from "./buscador.module.css";

const ESTADOS = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango",
  "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán",
  "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
  "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco",
  "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

/** Alinea un estado de la BD con la opción del `<select>`. */
function estadoParaSelect(estado: string | null): string {
  if (!estado) return "";
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const n = norm(estado);
  return ESTADOS.find((e) => norm(e) === n) ?? estado;
}

type Match = {
  id: number;
  puntaje: number;
  razon: string;
  sexo: string;
  edad_inicial: number | null;
  edad_final: number | null;
  estatura: number | null;
  fecha_hallazgo: string;
  estado: string | null;
  municipio: string | null;
  tatuajes: string | null;
  senas: string | null;
  fuenteEtiqueta: string;
  urlFuente: string | null;
};

type Persona = {
  id: number;
  nombre: string;
  edad: number | null;
  estatura: number | null;
  sexo: string;
  fecha_desaparicion: string;
  rasgos: unknown;
  estado: string | null;
  municipio: string | null;
};

type Estado = "idle" | "loading" | "results" | "empty";

const PHRASE = ["Identificar,", "también", "es", "<em>dignidad</em>"];
const GAUGE_R = 86;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

export default function Buscador() {
  const rootRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const numRef = useRef<HTMLDivElement>(null);

  const [estado, setEstado] = useState<Estado>("idle");

  // --- Campos del formulario (controlados, para poder precargarlos) ---
  const [nombre, setNombre] = useState("");
  const [sexo, setSexo] = useState("Masculino");
  const [edad, setEdad] = useState("");
  const [estatura, setEstatura] = useState("");
  const [estadoUbic, setEstadoUbic] = useState("");
  const [fecha, setFecha] = useState("");
  const [rasgos, setRasgos] = useState("");

  // --- Autocompletado de nombre contra la tabla `persona` ---
  const [sugerencias, setSugerencias] = useState<Persona[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  const [personaSel, setPersonaSel] = useState<Persona | null>(null);

  const [matches, setMatches] = useState<Match[]>([]);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  const limpiarError = () => setErrorValidacion(null);

  // --- Animación de entrada + luz ambiental que respira ---
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to(ambientRef.current, {
        opacity: 1,
        duration: 2.4,
        ease: "power2.out",
      });
      gsap.to(ambientRef.current, {
        scale: 1.12,
        duration: 9,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(`.${styles.kicker}`, { y: 14, opacity: 0, duration: 0.9 })
        .from(
          `.${styles.phrase} .${styles.word}`,
          { y: 30, opacity: 0, duration: 1, stagger: 0.08 },
          "-=0.5",
        )
        .from(`.${styles.sub}`, { y: 12, opacity: 0, duration: 0.8 }, "-=0.6")
        .from(
          `.${styles.form} > *`,
          { y: 18, opacity: 0, duration: 0.7, stagger: 0.06 },
          "-=0.55",
        );
    }, rootRef);
    return () => ctx.revert();
  }, []);

  // --- Autocompletado en vivo: busca personas reportadas por nombre ---
  useEffect(() => {
    const q = nombre.trim();
    // Si el texto coincide con la persona ya elegida, no volvemos a buscar.
    if (personaSel && q === personaSel.nombre) return;
    if (q.length < 2) {
      setSugerencias([]);
      setBuscandoNombre(false);
      return;
    }

    let activo = true;
    setBuscandoNombre(true);
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("persona")
        .select(
          "id,nombre,edad,estatura,sexo,fecha_desaparicion,rasgos, ultimo_lugar:lugares!persona_ultimo_lugar_id_fkey(estado,municipio)",
        )
        .ilike("nombre", `%${q}%`)
        .limit(6);
      if (!activo) return;
      type Fila = {
        id: number;
        nombre: string;
        edad: number | null;
        estatura: number | null;
        sexo: string;
        fecha_desaparicion: string;
        rasgos: unknown;
        ultimo_lugar: { estado: string | null; municipio: string | null } | null;
      };
      const lista: Persona[] = ((data ?? []) as unknown as Fila[]).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        edad: p.edad,
        estatura: p.estatura,
        sexo: p.sexo,
        fecha_desaparicion: p.fecha_desaparicion,
        rasgos: p.rasgos,
        estado: p.ultimo_lugar?.estado ?? null,
        municipio: p.ultimo_lugar?.municipio ?? null,
      }));
      setSugerencias(lista);
      setAbierto(true);
      setBuscandoNombre(false);
    }, 220);

    return () => {
      activo = false;
      clearTimeout(t);
    };
  }, [nombre, personaSel]);

  function onNombreChange(valor: string) {
    setNombre(valor);
    setErrorValidacion(null);
    if (personaSel && valor !== personaSel.nombre) setPersonaSel(null);
  }

  function elegirPersona(p: Persona) {
    const rasgosTexto = rasgosATexto(p.rasgos);
    setPersonaSel(p);
    setNombre(p.nombre);
    setSexo(p.sexo);
    setEdad(p.edad != null ? String(p.edad) : "");
    setEstatura(p.estatura != null ? String(Math.round(p.estatura)) : "");
    setEstadoUbic(estadoParaSelect(p.estado));
    setFecha(p.fecha_desaparicion ?? "");
    setRasgos(rasgosTexto);
    setSugerencias([]);
    setAbierto(false);
  }

  async function buscarEnVivo(opts?: {
    municipio?: string | null;
    sinEstado?: boolean;
  }): Promise<{ matches: Match[]; error?: string }> {
    const res = await fetch("/api/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sexo,
        edad,
        estatura,
        estado: opts?.sinEstado ? "" : estadoUbic,
        municipio: opts?.sinEstado ? null : (opts?.municipio ?? null),
        fecha_desaparicion: fecha,
        rasgos,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { matches: [], error: data.error ?? "No se pudo completar la búsqueda." };
    }
    return { matches: data.matches ?? [] };
  }

  function mapearCoincidencias(filas: unknown[]): Match[] {
    type Lugar = { estado: string | null; municipio: string | null } | null;
    type Forense = {
      id: number;
      sexo: string;
      edad_inicial: number | null;
      edad_final: number | null;
      estatura: number | null;
      fecha_hallazgo: string;
      fuente: string | null;
      fuente_id: string | null;
      rasgos: unknown;
      lugar_hallazgo: Lugar;
    };
    type Coincidencia = { puntaje: number | string; razon: string | null; forense: Forense | null };
    return (filas as Coincidencia[])
      .filter((c) => c.forense)
      .map((c) => {
        const f = c.forense!;
        const r = (f.rasgos ?? {}) as Record<string, unknown>;
        const ref = referenciaForense(f.fuente, f.fuente_id);
        return {
          id: f.id,
          puntaje: acotarPuntaje(Number(c.puntaje)),
          razon: c.razon ?? "",
          sexo: f.sexo,
          edad_inicial: f.edad_inicial,
          edad_final: f.edad_final,
          estatura: f.estatura,
          fecha_hallazgo: f.fecha_hallazgo,
          estado: f.lugar_hallazgo?.estado ?? null,
          municipio: f.lugar_hallazgo?.municipio ?? null,
          tatuajes: typeof r.tatuajes === "string" ? r.tatuajes : null,
          senas: typeof r.senas_particulares === "string" ? r.senas_particulares : null,
          fuenteEtiqueta: ref.etiqueta,
          urlFuente: ref.url,
        };
      });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (estado === "loading") return;
    setAbierto(false);

    const validacion = validarBusqueda({
      personaId: personaSel?.id ?? null,
      nombre,
      edad,
      estatura,
      estado: estadoUbic,
      fecha_desaparicion: fecha,
      rasgos,
    });
    if (!validacion.ok) {
      setErrorValidacion(validacion.mensaje);
      return;
    }
    setErrorValidacion(null);

    // Salida elegante del formulario
    await new Promise<void>((resolve) => {
      gsap.to([heroRef.current, formRef.current], {
        y: -18,
        opacity: 0,
        duration: 0.5,
        ease: "power2.in",
        onComplete: resolve,
      });
    });
    setEstado("loading");

    try {
      let found: Match[] = [];

      if (personaSel) {
        // Persona del registro nacional: coincidencias precalculadas, con fallback en vivo.
        const supabase = createClient();
        const { data } = await supabase
          .from("coincidencias")
          .select(
            "puntaje,razon, forense:forense_id(id,sexo,edad_inicial,edad_final,estatura,fecha_hallazgo,fuente,fuente_id,rasgos, lugar_hallazgo:lugares!forense_lugar_hallazgo_id_fkey(estado,municipio))",
          )
          .eq("persona_id", personaSel.id)
          .order("puntaje", { ascending: false })
          .limit(8);
        found = mapearCoincidencias(data ?? []);

        if (found.length === 0) {
          const live = await buscarEnVivo({ municipio: personaSel.municipio });
          found = live.matches;
          if (live.error) setErrorValidacion(live.error);
        }

        if (found.length === 0 && estadoUbic) {
          const live = await buscarEnVivo({ sinEstado: true });
          found = live.matches;
          if (live.error) setErrorValidacion(live.error);
        }
      } else {
        const live = await buscarEnVivo();
        found = live.matches;
        if (live.error) setErrorValidacion(live.error);
      }

      setMatches(found);
      setEstado(found.length ? "results" : "empty");
    } catch {
      setMatches([]);
      setEstado("empty");
      setErrorValidacion("Ocurrió un error al buscar. Intenta de nuevo.");
    }
  }

  // --- Animaciones al pintar resultados ---
  useEffect(() => {
    if (estado !== "results" || !matches.length) return;
    const top = matches[0];
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // Resumen e items entran
      tl.from(`.${styles.summary}`, { y: 24, opacity: 0, duration: 0.8 });

      // Aguja del medidor (count-up)
      if (arcRef.current) {
        gsap.set(arcRef.current, { strokeDasharray: GAUGE_C, strokeDashoffset: GAUGE_C });
        tl.to(
          arcRef.current,
          {
            strokeDashoffset: GAUGE_C * (1 - Math.min(top.puntaje, PUNTAJE_MAX) / PUNTAJE_MAX),
            duration: 1.5,
            ease: "power2.inOut",
          },
          0.2,
        );
      }
      const counter = { v: 0 };
      tl.to(
        counter,
        {
          v: top.puntaje,
          duration: 1.5,
          ease: "power2.inOut",
          onUpdate: () => {
            if (numRef.current)
              numRef.current.firstChild!.textContent = String(Math.round(counter.v));
          },
        },
        0.2,
      );

      tl.from(
        `.${styles.chip}`,
        { y: 8, opacity: 0, duration: 0.5, stagger: 0.06 },
        "-=0.9",
      );

      // Tarjetas de la lista
      tl.from(
        `.${styles.card}`,
        { y: 22, opacity: 0, duration: 0.6, stagger: 0.08 },
        "-=1.1",
      );
      gsap.to(`.${styles.barFill}`, {
        width: (i) => `${Math.min(matches[i]?.puntaje ?? 0, PUNTAJE_MAX)}%`,
        duration: 1.1,
        delay: 0.5,
        stagger: 0.08,
        ease: "power2.out",
      });
    }, resultsRef);
    return () => ctx.revert();
  }, [estado, matches]);

  function reset() {
    setErrorValidacion(null);
    gsap.to(resultsRef.current, {
      opacity: 0,
      y: 14,
      duration: 0.4,
      ease: "power2.in",
      onComplete: () => {
        setEstado("idle");
        setMatches([]);
        requestAnimationFrame(() => {
          gsap.fromTo(
            [heroRef.current, formRef.current],
            { y: 18, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.7, stagger: 0.1, ease: "power3.out" },
          );
        });
      },
    });
  }

  const top = matches[0];
  const chips = top ? top.razon.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 4) : [];

  return (
    <div
      className={`${styles.root}${estado === "results" ? ` ${styles.rootResults}` : ""}`}
      ref={rootRef}
    >
      <div className={styles.ambient} ref={ambientRef} />
      <div className={styles.grain} />

      <div className={`${styles.stage}${estado === "results" ? ` ${styles.stageResults}` : ""}`}>
        {(estado === "idle" || estado === "loading") && (
          <>
            <div className={styles.hero} ref={heroRef}>
              <div className={styles.kicker}>Registro Nacional · Coincidencias</div>
              <h1
                className={styles.phrase}
                dangerouslySetInnerHTML={{
                  __html: PHRASE.map(
                    (w) => `<span class="${styles.word}">${w}</span>`,
                  ).join(" "),
                }}
              />
              <p className={styles.sub}>
                Busca por nombre en el registro de personas desaparecidas, o
                ingresa los datos manualmente. Cruzamos su huella entre los
                registros forenses, con cuidado y con respeto.
              </p>
            </div>

            {estado === "idle" && (
              <form className={styles.form} ref={formRef} onSubmit={onSubmit}>
                {/* --- Nombre con autocompletado --- */}
                <div className={`${styles.field} ${styles.nameField}`}>
                  <span className={styles.label}>
                    NOMBRE
                    {personaSel && (
                      <span className={styles.linked}>· del registro nacional</span>
                    )}
                  </span>
                  <div className={styles.nameWrap}>
                    <input
                      className={`${styles.input} ${personaSel ? styles.inputLinked : ""}`}
                      value={nombre}
                      autoComplete="off"
                      placeholder="Escribe un nombre para buscar en el registro…"
                      onChange={(e) => onNombreChange(e.target.value)}
                      onFocus={() => sugerencias.length && setAbierto(true)}
                      onBlur={() => setTimeout(() => setAbierto(false), 120)}
                    />
                    {buscandoNombre && <span className={styles.spinner} />}
                    {nombre && (
                      <button
                        type="button"
                        className={styles.clear}
                        aria-label="Limpiar nombre"
                        onClick={() => {
                          setNombre("");
                          setPersonaSel(null);
                          setSugerencias([]);
                        }}
                      >
                        ×
                      </button>
                    )}

                    {abierto && sugerencias.length > 0 && (
                      <ul className={styles.suggest}>
                        {sugerencias.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className={styles.suggestItem}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                elegirPersona(p);
                              }}
                            >
                              <span className={styles.suggestName}>{p.nombre}</span>
                              <span className={styles.suggestMeta}>
                                {[
                                  p.sexo,
                                  p.edad != null ? `${p.edad} años` : null,
                                  p.estado,
                                  `desap. ${p.fecha_desaparicion}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {abierto &&
                      !buscandoNombre &&
                      nombre.trim().length >= 2 &&
                      sugerencias.length === 0 &&
                      !personaSel && (
                        <div className={styles.suggestEmpty}>
                          Sin reportes con ese nombre. Bórralo y completa los
                          datos manualmente, o elige una coincidencia del listado.
                        </div>
                      )}
                  </div>
                </div>

                <div className={styles.grid3}>
                  <div className={styles.field}>
                    <span className={styles.label}>SEXO</span>
                    <div className={styles.seg}>
                      {[
                        ["Femenino", "Mujer"],
                        ["Masculino", "Hombre"],
                        ["Indeterminado", "Indet."],
                      ].map(([val, lbl]) => (
                        <button
                          type="button"
                          key={val}
                          className={`${styles.segBtn} ${sexo === val ? styles.segActive : ""}`}
                          onClick={() => {
                            setSexo(val);
                            limpiarError();
                          }}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>EDAD</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={0}
                      max={120}
                      placeholder="años"
                      value={edad}
                      onChange={(e) => {
                        setEdad(e.target.value);
                        limpiarError();
                      }}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>ESTATURA</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={40}
                      max={230}
                      placeholder="cm"
                      value={estatura}
                      onChange={(e) => {
                        setEstatura(e.target.value);
                        limpiarError();
                      }}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <span className={styles.label}>ÚLTIMO ESTADO</span>
                    <select
                      className={styles.input}
                      value={estadoUbic}
                      onChange={(e) => {
                        setEstadoUbic(e.target.value);
                        limpiarError();
                      }}
                    >
                      <option value="">Sin especificar</option>
                      {ESTADOS.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>FECHA DE DESAPARICIÓN</span>
                    <input
                      className={styles.input}
                      type="date"
                      max="2026-06-21"
                      value={fecha}
                      onChange={(e) => {
                        setFecha(e.target.value);
                        limpiarError();
                      }}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>SEÑAS PARTICULARES Y TATUAJES</span>
                  <textarea
                    className={styles.textarea}
                    placeholder="Tatuaje de golondrina en el antebrazo izquierdo, cicatriz en la ceja, lunar en la mejilla…"
                    value={rasgos}
                    onChange={(e) => {
                      setRasgos(e.target.value);
                      limpiarError();
                    }}
                  />
                </div>

                <button className={styles.submit} type="submit">
                  {personaSel
                    ? `Ver coincidencias de ${personaSel.nombre.split(" ")[0]}`
                    : "Buscar coincidencias"}
                </button>
                {errorValidacion && (
                  <p className={styles.validacion} role="alert">
                    {errorValidacion}
                  </p>
                )}
                <p className={styles.footnote}>
                  La búsqueda es anónima y no se guarda. Las coincidencias son
                  orientativas; toda identificación debe confirmarse por la autoridad.
                </p>
              </form>
            )}

            {estado === "loading" && (
              <div className={styles.loading}>
                <div className={styles.dots}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={styles.dot}
                      ref={(el) => {
                        if (el)
                          gsap.to(el, {
                            y: -8,
                            opacity: 0.4,
                            duration: 0.5,
                            repeat: -1,
                            yoyo: true,
                            ease: "sine.inOut",
                            delay: i * 0.15,
                          });
                      }}
                    />
                  ))}
                </div>
                <p className={styles.loadingText}>Cruzando registros con cuidado…</p>
              </div>
            )}
          </>
        )}

        {estado === "empty" && (
          <div className={styles.empty} ref={resultsRef}>
            <p>
              {errorValidacion ??
                "No encontramos coincidencias relevantes con estos datos. Probar con menos restricciones, o detallar las señas particulares, puede ayudar."}
            </p>
            <button className={styles.back} onClick={() => setEstado("idle")}>
              ← Nueva búsqueda
            </button>
          </div>
        )}

        {estado === "results" && top && (
          <div className={styles.results} ref={resultsRef}>
            <div className={styles.summary}>
              <div className={styles.gaugeWrap}>
                <svg className={styles.gauge} viewBox="0 0 200 200">
                  <circle className={styles.gaugeTrack} cx="100" cy="100" r={GAUGE_R} />
                  <circle ref={arcRef} className={styles.gaugeArc} cx="100" cy="100" r={GAUGE_R} />
                </svg>
                <div className={styles.gaugeCenter}>
                  <div className={styles.gaugeNum} ref={numRef}>
                    {"0"}<span>%</span>
                  </div>
                  <div className={styles.gaugeLabel}>Compatibilidad</div>
                </div>
              </div>
              <div className={styles.summaryMeta}>
                {personaSel ? (
                  <>
                    Coincidencia más probable para <strong>{personaSel.nombre}</strong>
                  </>
                ) : (
                  <>
                    Coincidencia más probable · <strong>Registro #{top.id}</strong>
                    {top.estado ? ` · ${top.estado}` : ""}
                  </>
                )}
              </div>
              <div className={styles.chips}>
                {chips.map((c, i) => (
                  <span className={styles.chip} key={i}>{c}</span>
                ))}
              </div>
              <button className={styles.back} onClick={reset}>
                ← Nueva búsqueda
              </button>
            </div>

            <div className={styles.listPanel}>
              <div className={styles.listHead}>
                {matches.length} coincidencias encontradas
              </div>
              <div className={`${styles.list} scroll-area`}>
                {matches.map((m) => {
                  const contenido = (
                    <>
                      <div className={styles.cardTop}>
                        <span className={styles.cardId}>Registro #{m.id}</span>
                        <span className={styles.cardScore}>{Math.round(m.puntaje)}%</span>
                      </div>
                      <div className={styles.cardMeta}>
                        {m.estado ?? "Estado n/d"}
                        {m.municipio ? `, ${m.municipio}` : ""} ·{" "}
                        {m.edad_inicial != null
                          ? `${m.edad_inicial}–${m.edad_final ?? m.edad_inicial} años`
                          : "edad n/d"}{" "}
                        · hallazgo {m.fecha_hallazgo}
                      </div>
                      <div className={styles.bar}>
                        <div className={styles.barFill} />
                      </div>
                      {m.razon && <div className={styles.cardReason}>{m.razon}</div>}
                      <div className={styles.cardFuente}>
                        {m.urlFuente ? (
                          <span className={styles.cardFuenteLink}>
                            Fuente: {m.fuenteEtiqueta} ↗
                          </span>
                        ) : (
                          <span className={styles.cardFuenteRef}>
                            Fuente: {m.fuenteEtiqueta}
                          </span>
                        )}
                      </div>
                    </>
                  );

                  return m.urlFuente ? (
                    <a
                      className={`${styles.card} ${styles.cardLink}`}
                      key={m.id}
                      href={m.urlFuente}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {contenido}
                    </a>
                  ) : (
                    <article className={styles.card} key={m.id}>
                      {contenido}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
