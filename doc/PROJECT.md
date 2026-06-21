# Proyecto

Desarrollar una plataforma de software inteligente diseñada para cruzar información de personas desaparecidas con registros de cuerpos o restos no identificados, con el fin de encontrar coincidencias (matches) y facilitar su identificación en México.

El Motor del Sistema (Análisis Probabilístico)
El núcleo del software es un algoritmo de probabilidad estadística que compara dos universos de datos:

Datos Ante Mortem (AM): Características de la persona en vida (físicas, señas particulares, ropa, tatuajes, contexto de desaparición).

Datos Post Mortem (PM): Características forenses de los hallazgos no identificados.
El sistema asigna un "peso" estadístico a cada variable (por ejemplo, un tatuaje específico tiene un valor probabilístico mucho más alto que el color de cabello) para calcular el porcentaje de coincidencia entre un reporte de desaparición y un hallazgo.

Estrategia de Recolección de Datos (Web Scraping)
Ante la fragmentación de la información oficial, el software actuará como un agregador masivo. Utilizará técnicas de extracción automatizada (scraping) para recopilar datos de múltiples fuentes dispersas en internet:

Bases de datos forenses oficiales y registros gubernamentales.

Foros y bases de datos abiertas de la sociedad civil y el periodismo de investigación.

Procesamiento de la Información (Inteligencia Artificial)
Dado que la información recopilada será "sucia" o desestructurada (noticias en texto libre, imágenes de fichas de búsqueda), el software integrará herramientas de IA para procesarla:

Reconocimiento Óptico de Caracteres (OCR): Para "leer" y extraer el texto incrustado en las imágenes de los boletines de búsqueda que publican los colectivos y autoridades.

Procesamiento de Lenguaje Natural (NLP): Para leer artículos de noticias o reportes policiales y extraer de forma automática las variables clave (fechas, ubicación, tipo de ropa, tatuajes) y convertirlas en datos estructurados que el algoritmo pueda entender y comparar.

Resultado Esperado
Una herramienta tecnológica que automatice el cruce masivo de información fragmentada, reduciendo drásticamente el universo de búsqueda y arrojando resultados con alta probabilidad de coincidencia para apoyar a las familias y autoridades en la crisis de identificación forense.
