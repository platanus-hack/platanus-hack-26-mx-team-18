import re
import json

# falta que recorra todo el directorio por todos los .md
text = open("person.md", encoding="utf-8").read()

FIELDS = [
    "Folio",
    "FECHA DEL LEVANTAMIENTO",
    "HORA DEL LEVANTAMIENTO",
    "EXPEDIENTE",
    "LUGAR DE INTERVENCION",
    "MUNICIPIO",
    "ESTADO QUE REPORTÓ",
    "SEÑA PARTICULARES",
    "OBSERVACIONES",
    "PERTENENCIAS Y ACCESORIOS",
    "SEXO",
    "PESO",
    "ESTATURA",
    "TEZ/PIEL",
    "COMPLEXION",
    "FORMA CARA",
    "FRENTE",
    "BARBA",
    "ANTEOJOS",
    "MENTON",
    "MENTON FORMA",
    "NARIZ",
    "TAMAÑO NARIZ",
    "BOCA TAMAÑO",
    "GROSOR LABIOS",
    "TIPO CEJAS",
    "TAMAÑO CEJAS",
    "FORMA OREJAS",
    "TAMAÑO OREJAS",
    "COLOR CABELLO",
    "FORMA CABELLO",
    "COLOR OJOS",
    "TAMAÑO OJOS",
    "LARGO CABELLO"
]

person = {}

# Find every key occurrence
matches = []

for field in FIELDS:
    pattern = re.escape(field) + r"\s*:"
    for m in re.finditer(pattern, text):
        matches.append((m.start(), field, m.end()))

matches.sort()

# Extract values until next key
for i, (_, field, value_start) in enumerate(matches):
    value_end = matches[i + 1][0] if i + 1 < len(matches) else len(text)

    value = text[value_start:value_end].strip()

    # cleanup
    value = re.sub(r"\s+", " ", value)

    person[field] = value

print(json.dumps({"person": person}, ensure_ascii=False, indent=2))
