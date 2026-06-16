from flask import Flask, jsonify, request
from flask_cors import CORS
from sheets import get_all_data, update_cell, client, sheet
from config import (
    SHEET_ID,
    COL_DIA_MIN,
    COL_DIA_MAX,
    COL_MARCA_AGUA,
    LINHAS_INTERVALO,
    LINHA_INICIO,
    LINHA_FIM,
    DIAS_NOME,
    CABECALHO_CHAVE,
    MARCA_AGUA_CHAVE,
    MARCA_NICK,
    MARCA_AUTOR,
    MARCA_TEXTO,
)
from datetime import datetime, timedelta
import re

app = Flask(__name__)
CORS(app)

try:
    print("📊 Planilhas detectadas:", client.list_spreadsheet_files())
except Exception as e:
    print("❌ Erro ao conectar Sheets:", e)


def agora_brasilia():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Sao_Paulo"))
    except Exception:
        return datetime.now()


def js_dia_semana(dt):
    """Equivalente ao getDay() do JavaScript (0=dom … 5=sex, 6=sab)."""
    py = dt.weekday()  # seg=0 … dom=6
    return (py + 1) % 7 if py < 6 else 0


def exibir_proxima_semana(agora=None):
    """Sexta 18h+, sábado ou domingo — UI mostra a semana seguinte."""
    agora = agora or agora_brasilia()
    ds = js_dia_semana(agora)
    return (ds == 5 and agora.hour >= 18) or ds in (6, 0)


def segunda_da_semana_exibida(agora=None):
    """Segunda-feira (date) da semana que o frontend está exibindo."""
    agora = agora or agora_brasilia()
    hoje = agora.date()
    ds = js_dia_semana(agora)
    if ds == 5 and agora.hour >= 18:
        return hoje + timedelta(days=3)
    if ds == 6:
        return hoje + timedelta(days=2)
    if ds == 0:
        return hoje + timedelta(days=1)
    py = agora.weekday()
    return hoje - timedelta(days=py)


def get_config_ws():
    spreadsheet = client.open_by_key(SHEET_ID)
    try:
        return spreadsheet.worksheet("Config")
    except Exception:
        ws = spreadsheet.add_worksheet(title="Config", rows=50, cols=2)
        ws.update("A1:B1", [["chave", "valor"]])
        return ws


def config_get(chave, default=""):
    ws = get_config_ws()
    for row in ws.get_all_values()[1:]:
        if row and row[0] == chave:
            return row[1] if len(row) > 1 else default
    return default


def config_set(chave, valor):
    ws = get_config_ws()
    rows = ws.get_all_values()
    for i, row in enumerate(rows[1:], start=2):
        if row and row[0] == chave:
            ws.update_cell(i, 2, valor)
            return
    ws.append_row([chave, valor])


MARCA_AGUA_RANGE = f"H1:H3"


def garantir_cabecalho_planilha():
    """Restaura B1:F1 (Seg–Sex) e limpa G1 — marca d'água não é dia da semana."""
    if config_get(CABECALHO_CHAVE):
        return
    try:
        for col in range(COL_DIA_MIN, COL_DIA_MAX + 1):
            nome = DIAS_NOME[col - 1] if col - 1 < len(DIAS_NOME) else ""
            if nome:
                sheet.update_cell(1, col, nome)
        sheet.update_cell(1, 7, "")
        config_set(CABECALHO_CHAVE, "ok")
        print("[cabecalho] Segunda a Sexta restaurado; G1 limpo")
    except Exception as e:
        print(f"[cabecalho] erro: {e}")


def garantir_marca_agua_planilha():
    """
    Grava créditos na coluna H (fora de B–F) e na aba Config.
    Não é apagado pela limpeza semanal (só B2:F15).
    """
    garantir_cabecalho_planilha()
    if config_get(MARCA_AGUA_CHAVE):
        return
    try:
        sheet.update_cell(1, COL_MARCA_AGUA, MARCA_NICK)
        sheet.update_cell(2, COL_MARCA_AGUA, MARCA_AUTOR)
        sheet.update_cell(3, COL_MARCA_AGUA, MARCA_TEXTO)

        try:
            sheet.format(
                MARCA_AGUA_RANGE,
                {
                    "textFormat": {
                        "foregroundColor": {"red": 0.55, "green": 0.55, "blue": 0.55},
                        "italic": True,
                        "fontSize": 9,
                    },
                    "horizontalAlignment": "RIGHT",
                    "verticalAlignment": "TOP",
                },
            )
        except Exception:
            pass

        config_set("desenvolvedor", f"{MARCA_NICK} — {MARCA_AUTOR}")
        config_set("licenciado_para", "Demonstração acadêmica — TCC")
        config_set(MARCA_AGUA_CHAVE, "ok")
        print(f"[marca] créditos {MARCA_NICK} gravados na planilha")
    except Exception as e:
        print(f"[marca] erro ao gravar: {e}")


ADMIN_EMAILS = {
    "joaovictorsekimantovani@gmail.com",
}


def agenda_tem_reservas(valores):
    for i, row in enumerate(valores or []):
        if i == 0:
            continue
        for j, cell in enumerate(row):
            if j == 0:
                continue
            if cell and "|" in str(cell):
                v = str(cell).strip().upper()
                if v and v not in ("LIVRE", "BLOQUEADO"):
                    return True
    return False


def limpar_celulas_agenda():
    """Limpa agendamentos B2:F15 (preserva intervalos e BLOQUEADO manual)."""
    for ln in range(LINHA_INICIO, LINHA_FIM + 1):
        if ln in LINHAS_INTERVALO:
            continue
        for col in range(COL_DIA_MIN, COL_DIA_MAX + 1):
            try:
                v = (sheet.cell(ln, col).value or "").strip().upper()
                if v == "BLOQUEADO":
                    continue
            except Exception:
                pass
            update_cell(ln, col, "")


def tentar_limpeza_semana():
    """
    Limpa a planilha UMA vez por semana na virada (sexta 18h+).
    Controle na aba Config — não depende do celular de cada professor.
    """
    if not exibir_proxima_semana():
        return

    agora = agora_brasilia()
    seg = segunda_da_semana_exibida(agora)
    chave = f"limpeza_{seg.isoformat()}"
    if config_get(chave):
        return

    ds = js_dia_semana(agora)
    stamp = agora.strftime("%d/%m/%Y %H:%M")

    # Sexta 18h+: virada oficial — limpa dados da semana que acabou
    if ds == 5 and agora.hour >= 18:
        limpar_celulas_agenda()
        config_set(chave, f"limpo_{stamp}")
        print(f"[limpeza] planilha limpa para semana de {seg.strftime('%d/%m/%Y')} às {stamp}")
        return

    # Sáb/Dom (ou deploy tardio): já há reservas da semana nova — só registra, não apaga
    valores = sheet.get_all_values()
    if agenda_tem_reservas(valores):
        config_set(chave, f"preservado_{stamp}")
        print(f"[limpeza] semana {seg.strftime('%d/%m/%Y')} preservada (já tinha reservas)")
        return

    limpar_celulas_agenda()
    config_set(chave, f"limpo_{stamp}")
    print(f"[limpeza] planilha limpa (fallback) semana {seg.strftime('%d/%m/%Y')}")

def get_espera_sheet():
    """Retorna a aba 'Espera', criando-a se não existir.
    Garante também que o cabeçalho tenha a coluna 'email' (migração de abas antigas).
    """
    spreadsheet = client.open_by_key(SHEET_ID)
    try:
        ws = spreadsheet.worksheet("Espera")
        header = ws.row_values(1)
        if header and "email" not in header:
            ws.insert_cols([[""]] * 1, 3)
            ws.update_cell(1, 3, "email")
        return ws
    except Exception:
        ws = spreadsheet.add_worksheet(title="Espera", rows=500, cols=7)
        ws.append_row(["id", "nome", "email", "linha", "coluna", "equipamentos", "timestamp"])
        return ws


def formatar_reserva_agenda(nome, email, equip):
    """Mesmo formato das reservas normais — permite editar no app pelo e-mail."""
    nome = (nome or "").strip()
    email = (email or "").strip().lower()
    tag = f" [{email}]" if email and "@" in email else ""
    return f"{nome}{tag} | {equip}"


@app.route("/")
def home():
    return jsonify({"status": "API rodando 🚀"})


@app.route("/agenda", methods=["GET"])
def agenda():
    try:
        garantir_marca_agua_planilha()
    except Exception as e:
        print(f"[marca] erro (agenda segue): {e}")
    try:
        tentar_limpeza_semana()
    except Exception as e:
        print(f"[limpeza] erro (agenda segue): {e}")
    valores = sheet.get_all_values()
    return jsonify(valores)


@app.route("/editar", methods=["POST"])
def editar():
    data = request.json
    update_cell(data["linha"], data["coluna"], data["valor"])
    return jsonify({"status": "ok"})


@app.route("/admin/editar", methods=["POST"])
def admin_editar():
    data = request.json or {}
    email = (data.get("admin_email") or "").strip().lower()
    if email not in ADMIN_EMAILS:
        return jsonify({"erro": "Acesso negado"}), 403
    linha = data.get("linha")
    coluna = data.get("coluna")
    valor = data.get("valor", "")
    if linha is None or coluna is None:
        return jsonify({"erro": "Parâmetros inválidos"}), 400
    update_cell(int(linha), int(coluna), str(valor))
    return jsonify({"status": "ok"})


# ════════════════════════════════════════
# LISTA DE ESPERA
# ════════════════════════════════════════

@app.route("/espera", methods=["GET"])
def listar_espera():
    try:
        ws = get_espera_sheet()
        return jsonify(ws.get_all_records())
    except Exception as e:
        return jsonify({"erro": str(e)}), 500


@app.route("/espera", methods=["POST"])
def entrar_espera():
    try:
        data = request.json or {}
        nome = (data.get("nome") or "").strip()
        email = (data.get("email") or "").strip().lower()
        if not nome:
            return jsonify({"erro": "Nome obrigatório"}), 400
        if not email or "@" not in email:
            return jsonify({
                "erro": "É necessário estar logado com Google para entrar na fila (e-mail obrigatório)."
            }), 400

        ws = get_espera_sheet()
        import time
        import random

        uid = f"{int(time.time())}-{random.randint(100, 999)}"
        timestamp = time.strftime("%d/%m/%Y %H:%M")

        ws.append_row([
            uid,
            nome,
            email,
            int(data["linha"]),
            int(data["coluna"]),
            data["equipamentos"],
            timestamp,
        ])
        return jsonify({"status": "ok", "id": uid})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500


@app.route("/espera/<uid>", methods=["DELETE"])
def remover_espera(uid):
    try:
        ws = get_espera_sheet()
        registros = ws.get_all_values()
        for i, row in enumerate(registros):
            if row and row[0] == uid:
                ws.delete_rows(i + 1)
                return jsonify({"status": "ok"})
        return jsonify({"status": "nao_encontrado"}), 404
    except Exception as e:
        return jsonify({"erro": str(e)}), 500


RE_EQUIP = re.compile(
    r"(\d+)\s*(tv remota|notebook prata|notebook preto|tablet)",
    re.IGNORECASE,
)


def _parse_equip_segment(seg):
    uso = {"tablet": 0, "prata": 0, "preto": 0, "tvremota": 0}
    for m in RE_EQUIP.finditer(seg):
        qtd = int(m.group(1))
        tipo = m.group(2).lower()
        if tipo == "tablet":
            uso["tablet"] += qtd
        elif tipo == "notebook prata":
            uso["prata"] += qtd
        elif tipo == "notebook preto":
            uso["preto"] += qtd
        elif tipo == "tv remota":
            uso["tvremota"] += qtd
    return uso


def calcular_uso_celula(cel_valor):
    uso = {"tablet": 0, "prata": 0, "preto": 0, "tvremota": 0}
    if not cel_valor or "|" not in cel_valor:
        return uso
    for bloco in cel_valor.split("§"):
        partes = bloco.split("|")
        if len(partes) < 2:
            continue
        for seg in partes[1].split("+"):
            parsed = _parse_equip_segment(seg.strip())
            for k in uso:
                uso[k] += parsed[k]
    return uso


def equip_str_para_dict(equip_str):
    res = {"tablet": 0, "prata": 0, "preto": 0, "tvremota": 0}
    for seg in equip_str.split("+"):
        parsed = _parse_equip_segment(seg.strip())
        for k in res:
            res[k] += parsed[k]
    return res


ESTOQUE_TOTAL = {"tablet": 12, "prata": 23, "preto": 11, "tvremota": 1}


@app.route("/promover", methods=["POST"])
def promover_espera():
    try:
        ws = get_espera_sheet()
        todas_linhas = ws.get_all_values()
        if not todas_linhas:
            return jsonify({"promovidos": []})

        header = todas_linhas[0]

        def col_idx(nome_col):
            try:
                return header.index(nome_col)
            except ValueError:
                return None

        idx_id = col_idx("id")
        idx_nome = col_idx("nome")
        idx_email = col_idx("email")
        idx_linha = col_idx("linha")
        idx_col = col_idx("coluna")
        idx_equip = col_idx("equipamentos")

        if None in (idx_id, idx_nome, idx_linha, idx_col, idx_equip):
            return jsonify({"erro": "Cabeçalho da aba Espera inválido", "header": header}), 500

        registros_raw = todas_linhas[1:]
        promovidos = []
        agenda_vals = sheet.get_all_values()

        for reg_row in registros_raw:
            if not reg_row or not reg_row[idx_id]:
                continue
            try:
                uid = reg_row[idx_id]
                nome = reg_row[idx_nome]
                email = ""
                if idx_email is not None and idx_email < len(reg_row):
                    email = (reg_row[idx_email] or "").strip().lower()
                linha = int(reg_row[idx_linha])
                coluna = int(reg_row[idx_col])
                equip = reg_row[idx_equip]
            except (ValueError, IndexError):
                continue

            try:
                cel_atual = agenda_vals[linha - 1][coluna - 1]
            except IndexError:
                continue

            cel_up = (cel_atual or "").strip().upper()
            if cel_up == "BLOQUEADO":
                continue

            uso = calcular_uso_celula(cel_atual)
            pedido = equip_str_para_dict(equip)

            cabe = all(
                uso.get(tipo, 0) + pedido.get(tipo, 0) <= ESTOQUE_TOTAL[tipo]
                for tipo in pedido
                if pedido[tipo] > 0
            )
            if not cabe:
                continue

            nova_reserva = formatar_reserva_agenda(nome, email, equip)
            if not cel_atual.strip() or cel_up == "":
                novo_valor = nova_reserva
            else:
                novo_valor = f"{cel_atual} § {nova_reserva}"

            sheet.update_cell(linha, coluna, novo_valor)

            while len(agenda_vals) < linha:
                agenda_vals.append([])
            while len(agenda_vals[linha - 1]) < coluna:
                agenda_vals[linha - 1].append("")
            agenda_vals[linha - 1][coluna - 1] = novo_valor

            todos = ws.get_all_values()
            for i, row in enumerate(todos):
                if row and row[0] == uid:
                    ws.delete_rows(i + 1)
                    break

            print(f"[promover] ✅ {nome} ({email or 'sem email'}) → L{linha} C{coluna}")
            promovidos.append({
                "nome": nome,
                "email": email,
                "linha": linha,
                "coluna": coluna,
                "equipamentos": equip,
            })

        return jsonify({"promovidos": promovidos})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500


@app.route("/dados", methods=["GET"])
def dados():
    return jsonify(get_all_data())


@app.route("/atualizar", methods=["POST"])
def atualizar():
    data = request.json
    update_cell(data["row"], data["col"], data["value"])
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
