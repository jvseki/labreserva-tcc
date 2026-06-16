import os
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from config import SHEET_ID

scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive"
]

# =========================
# 🔥 FUNÇÃO DE AUTENTICAÇÃO
# =========================

def get_credentials():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")

    # =========================
    # 🌐 PRODUÇÃO (RENDER)
    # =========================
    if creds_json:
        creds_dict = json.loads(creds_json)

        creds = ServiceAccountCredentials.from_json_keyfile_dict(
            creds_dict,
            scope
        )
        return creds

    # =========================
    # 💻 LOCAL (SEU PC)
    # =========================
    print("⚠️ Usando credenciais locais (credenciais.json)")
    base_dir = os.path.dirname(__file__)
    cred_path = os.path.join(base_dir, "credenciais.json")

    creds = ServiceAccountCredentials.from_json_keyfile_name(
        cred_path,
        scope
    )
    return creds


# =========================
# 🔗 CLIENTE GOOGLE SHEETS
# =========================

creds = get_credentials()
client = gspread.authorize(creds)

sheet = client.open_by_key(SHEET_ID).sheet1

print("TESTE:", client.list_spreadsheet_files())


# =========================
# 📌 FUNÇÕES
# =========================

def get_all_data():
    return sheet.get_all_records()


def get_cell(row, col):
    return sheet.cell(row, col).value


def update_cell(row, col, value):
    sheet.update_cell(row, col, value)


def clear_cell(row, col):
    sheet.update_cell(row, col, "")