# ═══════════════════════════════════════════════════════════════
# Planilha TCC — Google Sheets
# https://docs.google.com/spreadsheets/d/1xJGkM1ZVYO9rIWBtW2tiqR2V6ZsI9-VIcwqUIHRoWx0
# ═══════════════════════════════════════════════════════════════

SHEET_ID = "1xJGkM1ZVYO9rIWBtW2tiqR2V6ZsI9-VIcwqUIHRoWx0"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"

# Colunas da aba Página1
# A = horários | B–G = Segunda a Sábado | H = marca d'água (fora da grade)
COL_DIA_MIN = 2   # B — Segunda
COL_DIA_MAX = 7   # G — Sábado
COL_MARCA_AGUA = 8  # H — créditos do sistema

LINHAS_INTERVALO = {5, 12}
LINHA_INICIO = 2
LINHA_FIM = 15

# Horários alinhados com a coluna A da planilha (linha → início, fim)
HORARIOS = {
    2:  ("07:00", "07:50"),
    3:  ("07:50", "08:40"),
    4:  ("08:40", "09:30"),
    5:  ("09:30", "09:50"),   # intervalo
    6:  ("09:50", "10:40"),
    7:  ("10:40", "11:30"),
    8:  ("11:30", "12:20"),
    9:  ("12:20", "13:30"),
    10: ("13:30", "14:20"),
    11: ("14:20", "15:10"),
    12: ("15:10", "15:30"),   # intervalo
    13: ("15:30", "16:20"),
    14: ("16:20", "17:10"),
    15: ("17:10", "18:00"),
}

DIAS_NOME = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

# Marca d'água (coluna H — não entra na limpeza semanal)
MARCA_AGUA_CHAVE = "marca_agua_jvseki_v1"
MARCA_NICK = "JVSEKI"
MARCA_AUTOR = "João Victor Seki Mantovani"
MARCA_TEXTO = "Sistema de reservas - Informativo"
