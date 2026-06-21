import re

with open('consultaOc.html', 'r', encoding='utf-8') as f:
    html = f.read()

    # Gets the ID numbers for the page


ids = re.findall(r'CargaOcciso\((\d+)\)', html)
ids = [int(x) for x in ids]  # convert to integers, drop this line to keep as strings

# falta hacer la función que obtiene todas las páginas https://fiscaliasinaloa.mx/Apps/ConsultaOcciso/Contact?id=3174
# con contact id siendo cada ID en ids.
# El scrapping debe de ser en markdown

print(ids)
