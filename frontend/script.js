const API = "https://labreserva-tcc.onrender.com";

// =====================================================================
// ESTOQUE — fixo por tipo, independente do dia
// =====================================================================
const ESTOQUE = {
  tablet: { label: "tablet",         total: 12,  emoji: "📱" },
  prata:  { label: "notebook prata", total: 23,  emoji: "💻" },
  preto:  { label: "notebook preto", total: 11,  emoji: "🖥️" },
};

// =====================================================================
// HORÁRIOS — mapeados por linha da planilha (linha 2 = índice 1 etc.)
// =====================================================================
const HORARIOS = {
  2:  ["07:00", "07:50"],
  3:  ["07:50", "08:40"],
  4:  ["08:40", "09:30"],
  5:  ["09:30", "09:50"],
  6:  ["09:50", "10:40"],
  7:  ["10:40", "11:30"],
  8:  ["11:30", "12:20"],
  9:  ["12:20", "13:30"],
  10: ["13:30", "14:20"],
  11: ["14:20", "15:10"],
  12: ["15:10", "15:30"],
  13: ["15:30", "16:20"],
  14: ["16:20", "17:10"],
  15: ["17:10", "18:00"],
};

const COL_DIA_MIN = 2;
const COL_DIA_MAX = 7;

// Guarda os dados globais da planilha
let dadosGlobais = [];

// Estado do modal de reserva por dia
let modalDiaColuna = null;      // coluna (1-based) do dia selecionado
let modalDiaNome = "";          // nome do dia ("Segunda", etc.)
let horariosSelecionados = [];  // linhas selecionadas (1-based)
let tipoSelecionado = null;

// =====================================================================
// UTILITÁRIOS DE TEMPO
// =====================================================================
function agora() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Retorna o dia da semana atual (0=dom, 1=seg, …, 5=sex, 6=sáb)
function diaSemanaAtual() {
  return new Date().getDay();
}

// Converte coluna de dado (1-based, sendo col 1 = "Horário") para dia da semana
// Cabeçalho: [Horário, Segunda … Sábado]
// col 2 = Segunda (dia 1) … col 7 = Sábado (dia 6)
function colParaDiaSemana(col) {
  return col - 1; // col 2 → 1 (seg), col 3 → 2 (ter), …
}

// Retorna true se o horário (linha) JÁ PASSOU no dia de hoje
function horarioJaPassou(linhaNum) {
  const h = HORARIOS[linhaNum];
  if (!h) return false;
  return agora() >= paraMinutos(h[1]);
}

// Retorna true se a célula é do dia atual E o horário já passou
function celulaPertenceAoDiaAtualEPassou(coluna, linhaNum) {
  const diaColuna = colParaDiaSemana(coluna);  // 1=seg…5=sex
  const hoje = diaSemanaAtual();               // 0=dom…6=sáb
  if (diaColuna !== hoje) return false;
  return horarioJaPassou(linhaNum);
}

// =====================================================================
// RESET AUTOMÁTICO
// =====================================================================

// Limpa horários passados do dia ATUAL (não toca outros dias)
async function resetarHorariosPassadosHoje(dados) {
  const hoje = diaSemanaAtual(); // 0=dom…6=sáb
  const agoraMins = agora();

  for (const [linhaStr, [, fim]] of Object.entries(HORARIOS)) {
    const linhaNum = parseInt(linhaStr);
    if (agoraMins < paraMinutos(fim)) continue; // ainda não passou

    const linhaData = dados[linhaNum - 1];
    if (!linhaData) continue;

    // Só a coluna do dia atual (coluna = hoje + 1, pois col 1 = rótulo, col 2 = seg…)
    const coluna = hoje + 1; // 1=dom não tem coluna; mas domingo não tem aula
    if (coluna < 2 || coluna > 6) continue; // só seg–sex

    const val = (linhaData[coluna - 1] || "").trim().toUpperCase();
    if (val !== "" && val !== "LIVRE" && val !== "BLOQUEADO") {
      try {
        await fetch(`${API}/editar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linha: linhaNum, coluna, valor: "LIVRE" })
        });
      } catch (e) { console.warn("Erro ao resetar célula", linhaNum, coluna); }
    }
  }
}

// Limpeza total (sexta às 18h) — limpa TODA a planilha de dados (linhas 2–15, colunas 2–6)
async function limpezaSemanalSeNecessario(dados) {
  const d = new Date();
  const dia = d.getDay();     // 5 = sexta
  const hora = d.getHours();
  if (dia !== 5 || hora < 18) return;

  // Verifica se já limpou hoje (evita repetir)
  const chave = `limpeza_${d.toDateString()}`;
  if (localStorage.getItem(chave)) return;

  for (let linhaNum = 2; linhaNum <= 15; linhaNum++) {
    const linhaData = dados[linhaNum - 1];
    if (!linhaData) continue;
    for (let col = COL_DIA_MIN; col <= COL_DIA_MAX; col++) {
      const val = (linhaData[col - 1] || "").trim().toUpperCase();
      if (val !== "" && val !== "LIVRE" && val !== "BLOQUEADO") {
        try {
          await fetch(`${API}/editar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ linha: linhaNum, coluna: col, valor: "LIVRE" })
          });
        } catch (e) { console.warn("Erro limpeza semanal", linhaNum, col); }
      }
    }
  }
  localStorage.setItem(chave, "1");
}

// =====================================================================
// ESTOQUE VERTICAL — calcula uso POR COLUNA (dia)
// Não conta horários já passados no dia atual
// =====================================================================
function calcularUsoPorColuna(dados) {
  // Retorna objeto: { 2: {tablet:0,prata:0,preto:0}, 3: {...}, … }
  const uso = {};
  for (let col = COL_DIA_MIN; col <= COL_DIA_MAX; col++) uso[col] = { tablet: 0, prata: 0, preto: 0 };

  for (let linhaNum = 2; linhaNum <= 15; linhaNum++) {
    const linhaData = dados[linhaNum - 1];
    if (!linhaData) continue;

    for (let col = COL_DIA_MIN; col <= COL_DIA_MAX; col++) {
      // Se for o dia atual e o horário já passou, não conta no estoque
      if (celulaPertenceAoDiaAtualEPassou(col, linhaNum)) continue;

      const r = extrairReserva(linhaData[col - 1]);
      if (r && uso[col][r.tipo] !== undefined) uso[col][r.tipo] += r.qtd;
    }
  }
  return uso;
}

// =====================================================================
// EXTRAI RESERVA DE UMA CÉLULA
// =====================================================================
function extrairReserva(valor) {
  if (!valor) return null;
  const v = valor.trim().toUpperCase();
  if (v === "" || v === "LIVRE" || v === "BLOQUEADO") return null;
  const partes = valor.split("|");
  if (partes.length < 2) return null;
  const equipPart = partes[1].trim().toLowerCase();
  let tipo = null, qtd = 1;
  const match = equipPart.match(/(\d+)\s*(tablet|notebook prata|notebook preto)/i);
  if (match) {
    qtd = parseInt(match[1]);
    const nome = match[2].toLowerCase();
    if (nome === "tablet") tipo = "tablet";
    else if (nome === "notebook prata") tipo = "prata";
    else if (nome === "notebook preto") tipo = "preto";
  } else {
    if (equipPart.includes("tablet")) tipo = "tablet";
    else if (equipPart.includes("prata")) tipo = "prata";
    else if (equipPart.includes("preto")) tipo = "preto";
  }
  return tipo ? { tipo, qtd } : null;
}

// =====================================================================
// CARREGA E RENDERIZA
// =====================================================================
async function carregarAgenda() {
  document.getElementById("loading").style.display = "flex";
  document.getElementById("table-container").style.display = "none";
  try {
    const r1 = await fetch(`${API}/agenda`);
    const d1 = await r1.json();

    await limpezaSemanalSeNecessario(d1);
    await resetarHorariosPassadosHoje(d1);

    const r2 = await fetch(`${API}/agenda`);
    const dados = await r2.json();
    dadosGlobais = dados;

    renderTabela(dados);
    atualizarStockHeaderGlobal(dados);
  } catch (e) {
    document.getElementById("loading").innerHTML =
      `<p style="color:#c0302a;font-family:'Architects Daughter',cursive;font-size:16px">⚠️ Erro ao conectar com o servidor</p>`;
  }
}

// =====================================================================
// HEADER — estoque global (soma de todos os dias futuros)
// =====================================================================
function atualizarStockHeaderGlobal(dados) {
  // Para o header mostramos o total disponível hoje (coluna do dia atual)
  // Se não for dia de semana, mostra total livre
  const hoje = diaSemanaAtual();
  const colunaHoje = hoje >= 1 && hoje <= 5 ? hoje + 1 : null;

  const usoPorCol = calcularUsoPorColuna(dados);

  // Soma uso de TODOS os dias (visão geral da semana)
  const usoSemana = { tablet: 0, prata: 0, preto: 0 };
  for (let col = COL_DIA_MIN; col <= COL_DIA_MAX; col++) {
    usoSemana.tablet += usoPorCol[col].tablet;
    usoSemana.prata  += usoPorCol[col].prata;
    usoSemana.preto  += usoPorCol[col].preto;
  }

  // O header mostra disponibilidade global da semana (máx = total * 5 dias)
  // Simplificamos: mostra total disponível hoje se for dia útil, senão semana
  const usoRef = colunaHoje ? usoPorCol[colunaHoje] : usoSemana;
  const fator  = colunaHoje ? 1 : 5;

  Object.keys(ESTOQUE).forEach(tipo => {
    const badge = document.getElementById(`stock-${tipo}`);
    if (!badge) return;
    const { emoji, label, total } = ESTOQUE[tipo];
    const disponivel = (total * fator) - usoRef[tipo];
    const totalRef   = total * fator;

    const labelPlural = tipo === "tablet" ? "tablets" : label + "s";
    if (disponivel <= 0) {
      badge.innerHTML = `${emoji} ${totalRef} ${labelPlural} <span class="stock-zero">0 disponíveis</span>`;
      badge.classList.add("esgotado");
    } else {
      badge.innerHTML = `${emoji} ${disponivel}/${totalRef} ${labelPlural} disponíveis`;
      badge.classList.remove("esgotado");
    }
  });
}

// =====================================================================
// RENDER DA TABELA
// =====================================================================
function renderTabela(dados) {
  const tabela = document.getElementById("tabela");
  tabela.innerHTML = "";
  let livre = 0, reservado = 0;
  const cabecalhos = dados[0] || [];

  dados.forEach((linha, i) => {
    const tr = document.createElement("tr");
    const linhaNum = i + 1; // 1-based (linha 1 = cabeçalho)

    linha.forEach((celula, j) => {
      const isHeader  = i === 0;
      const isLabelCol = j === 0;
      const coluna = j + 1; // 1-based
      const td = document.createElement(isHeader ? "th" : "td");

      if (isHeader) {
        td.innerText = celula;
        // Cabeçalhos de dias (col >= 2) ficam clicáveis para abrir modal do dia
        if (j >= 1) {
          td.style.cursor = "pointer";
          td.title = `Reservar em ${celula}`;
          td.onclick = () => abrirModalDia(coluna, celula, dados);
          td.innerHTML = `${celula} <span style="font-size:10px;opacity:0.7">▼</span>`;
        }
        tr.appendChild(td);
        return;
      }

      if (isLabelCol) {
        td.className = "label-col";
        td.innerText = celula;
        tr.appendChild(td);
        return;
      }

      // Célula de dado
      const passouHoje = celulaPertenceAoDiaAtualEPassou(coluna, linhaNum);
      const val = (celula || "").trim().toUpperCase().replace(/\s+/g, " ");

      if (passouHoje) {
        // Horário passado no dia atual — cinza claro com relógio
        td.className = "expirado";
        td.innerHTML = `<span class="icon-relogio">🕐</span><span class="txt-expirado">Passado</span>`;
        td.style.cursor = "default";
        td.title = "Este horário já passou hoje";

      } else if (val === "BLOQUEADO") {
        td.className = "bloqueado";
        td.innerText = "BLOQUEADO";
        td.style.cursor = "not-allowed";

      } else if (val === "LIVRE" || val === "") {
        td.className = "livre";
        td.innerText = "LIVRE";
        livre++;
        // Clique em célula livre abre modal do dia com esse horário pré-selecionado
        const horario = linha[0] || "";
        const dia = cabecalhos[j] || "";
        td.onclick = () => abrirModalDia(coluna, dia, dados, linhaNum);

      } else if (val.includes("|")) {
        td.className = "reservado";
        td.style.cursor = "default";
        td.innerHTML = formatarCelulaReservada(celula);
        reservado++;

      } else {
        // Valor inesperado → trata como livre
        td.className = "livre";
        td.innerText = "LIVRE";
        livre++;
        const horario = linha[0] || "";
        const dia = cabecalhos[j] || "";
        td.onclick = () => abrirModalDia(coluna, dia, dados, linhaNum);
        console.warn(`Valor inesperado [${linhaNum},${coluna}]: "${celula}" → LIVRE`);
      }

      tr.appendChild(td);
    });

    tabela.appendChild(tr);
  });

  document.getElementById("count-livre").textContent = livre;
  document.getElementById("count-reservado").textContent = reservado;
  document.getElementById("loading").style.display = "none";
  document.getElementById("table-container").style.display = "block";
}

function formatarCelulaReservada(valor) {
  const partes = valor.split("|");
  if (partes.length < 2) return `<span>${valor}</span>`;
  const nome  = partes[0].trim();
  const equip = partes[1].trim();
  return `<span class="cell-nome">${nome}</span><span class="cell-equip">${equip}</span>`;
}

// =====================================================================
// MODAL DE RESERVA POR DIA
// =====================================================================
function abrirModalDia(coluna, diaNome, dados, linhaPreSelecionada = null) {
  modalDiaColuna = coluna;
  modalDiaNome   = diaNome;
  horariosSelecionados = linhaPreSelecionada ? [linhaPreSelecionada] : [];
  tipoSelecionado = null;

  document.getElementById("modal-title").textContent = `📅 ${diaNome}`;
  document.getElementById("modal-sub").textContent = "Selecione os horários e equipamento";
  document.getElementById("nome-input").value = "";
  document.getElementById("qtd-input").value = "1";
  document.getElementById("error-msg").textContent = "";
  document.getElementById("equip-error").textContent = "";
  document.querySelectorAll(".equip-btn").forEach(b => b.classList.remove("active", "sem-estoque"));

  // Renderiza lista de horários disponíveis para este dia
  renderListaHorarios(coluna, dados, linhaPreSelecionada);

  // Atualiza disponibilidade dos botões de equipamento para este dia
  atualizarBotoesEquipParaDia(coluna, dados);

  document.getElementById("overlay").classList.add("open");
  setTimeout(() => document.getElementById("nome-input").focus(), 100);
}

function renderListaHorarios(coluna, dados, linhaPreSelecionada) {
  const container = document.getElementById("horarios-lista");
  container.innerHTML = "";

  for (let linhaNum = 2; linhaNum <= 15; linhaNum++) {
    const linhaData = dados[linhaNum - 1];
    if (!linhaData) continue;

    const h = HORARIOS[linhaNum];
    if (!h) continue;

    const val = (linhaData[coluna - 1] || "").trim().toUpperCase().replace(/\s+/g, " ");
    const passouHoje = celulaPertenceAoDiaAtualEPassou(coluna, linhaNum);

    // Bloqueado ou passado → desabilitado
    const isBloqueado = val === "BLOQUEADO";
    const isReservado = val.includes("|");
    const disabled    = isBloqueado || isReservado || passouHoje;

    const btn = document.createElement("button");
    btn.className = "horario-btn";
    btn.dataset.linha = linhaNum;

    if (passouHoje) {
      btn.classList.add("passado");
      btn.innerHTML = `<span class="h-hora">🕐 ${h[0]}–${h[1]}</span><span class="h-status">passado</span>`;
      btn.disabled = true;
    } else if (isBloqueado) {
      btn.classList.add("bloqueado-slot");
      btn.innerHTML = `<span class="h-hora">■ ${h[0]}–${h[1]}</span><span class="h-status">bloqueado</span>`;
      btn.disabled = true;
    } else if (isReservado) {
      const partes = val.split("|");
      btn.classList.add("ocupado-slot");
      btn.innerHTML = `<span class="h-hora">◆ ${h[0]}–${h[1]}</span><span class="h-status">${linhaData[coluna - 1].split("|")[0].trim()}</span>`;
      btn.disabled = true;
    } else {
      // Livre — selecionável
      btn.innerHTML = `<span class="h-hora">● ${h[0]}–${h[1]}</span><span class="h-status">livre</span>`;
      if (linhaNum === linhaPreSelecionada) {
        btn.classList.add("selecionado");
      }
      btn.onclick = () => toggleHorario(linhaNum, btn);
    }

    container.appendChild(btn);
  }
}

function toggleHorario(linhaNum, btn) {
  const idx = horariosSelecionados.indexOf(linhaNum);
  if (idx === -1) {
    horariosSelecionados.push(linhaNum);
    btn.classList.add("selecionado");
  } else {
    horariosSelecionados.splice(idx, 1);
    btn.classList.remove("selecionado");
  }
  atualizarResumoSelecao();
}

function atualizarResumoSelecao() {
  const el = document.getElementById("resumo-selecao");
  const n  = horariosSelecionados.length;
  el.textContent = n === 0
    ? "Nenhum horário selecionado"
    : `${n} horário${n > 1 ? "s" : ""} selecionado${n > 1 ? "s" : ""}`;
}

// =====================================================================
// DISPONIBILIDADE DE EQUIPAMENTOS — por coluna/dia
// =====================================================================
function calcularDisponivelParaDia(coluna, dados) {
  const uso = { tablet: 0, prata: 0, preto: 0 };
  for (let linhaNum = 2; linhaNum <= 15; linhaNum++) {
    const linhaData = dados[linhaNum - 1];
    if (!linhaData) continue;
    if (celulaPertenceAoDiaAtualEPassou(coluna, linhaNum)) continue;
    const r = extrairReserva(linhaData[coluna - 1]);
    if (r && uso[r.tipo] !== undefined) uso[r.tipo] += r.qtd;
  }
  return {
    tablet: ESTOQUE.tablet.total - uso.tablet,
    prata:  ESTOQUE.prata.total  - uso.prata,
    preto:  ESTOQUE.preto.total  - uso.preto,
  };
}

function atualizarBotoesEquipParaDia(coluna, dados) {
  const disp = calcularDisponivelParaDia(coluna, dados);
  Object.keys(ESTOQUE).forEach(tipo => {
    const btn = document.querySelector(`.equip-btn.${tipo}`);
    if (!btn) return;
    const maxSpan = btn.querySelector(".equip-max");
    if (disp[tipo] <= 0) {
      maxSpan.textContent = "esgotado neste dia";
      maxSpan.style.color = "var(--red)";
      btn.classList.add("sem-estoque");
      btn.disabled = true;
    } else {
      maxSpan.textContent = `${disp[tipo]} disponíveis`;
      maxSpan.style.color = "";
      btn.classList.remove("sem-estoque");
      btn.disabled = false;
    }
  });
}

function selecionarEquip(tipo, btn) {
  const disp = calcularDisponivelParaDia(modalDiaColuna, dadosGlobais);
  if (disp[tipo] <= 0) {
    document.getElementById("equip-error").textContent =
      `⚠️ Todos os ${ESTOQUE[tipo].label}s já estão reservados neste dia.`;
    return;
  }
  tipoSelecionado = tipo;
  document.querySelectorAll(".equip-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("equip-error").textContent = "";
  document.getElementById("qtd-input").max = disp[tipo];
  document.getElementById("qtd-label").textContent = `Quantidade (máx. ${disp[tipo]} disponíveis neste dia)`;
  const cur = parseInt(document.getElementById("qtd-input").value) || 1;
  if (cur > disp[tipo]) document.getElementById("qtd-input").value = disp[tipo];
}

// =====================================================================
// CONFIRMAR RESERVA (múltiplos horários)
// =====================================================================
async function confirmarAcao() {
  const nome = document.getElementById("nome-input").value.trim();
  if (!nome) {
    document.getElementById("error-msg").textContent = "✏️ Digite o nome do professor.";
    return;
  }
  if (horariosSelecionados.length === 0) {
    document.getElementById("error-msg").textContent = "⏰ Selecione ao menos um horário.";
    return;
  }
  if (!tipoSelecionado) {
    document.getElementById("equip-error").textContent = "⚠️ Selecione o tipo de equipamento.";
    return;
  }

  const disp = calcularDisponivelParaDia(modalDiaColuna, dadosGlobais);
  const qtd  = parseInt(document.getElementById("qtd-input").value) || 1;

  if (qtd < 1 || qtd > disp[tipoSelecionado]) {
    document.getElementById("equip-error").textContent =
      `⚠️ Só há ${disp[tipoSelecionado]} ${ESTOQUE[tipoSelecionado].label}(s) disponíveis neste dia.`;
    return;
  }

  const novoValor = `${nome} | ${qtd} ${ESTOQUE[tipoSelecionado].label}`;
  const btn = document.getElementById("confirm-btn");
  btn.textContent = "Salvando...";
  btn.disabled = true;

  try {
    // Salva cada horário selecionado
    for (const linhaNum of horariosSelecionados) {
      await fetch(`${API}/editar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linha: linhaNum, coluna: modalDiaColuna, valor: novoValor })
      });
    }
    fecharModal();
    const n = horariosSelecionados.length;
    showToast(`✔ ${n} horário${n > 1 ? "s" : ""} reservado${n > 1 ? "s" : ""} com sucesso!`, "success");
    carregarAgenda();
  } catch (e) {
    showToast("✗ Erro ao salvar. Tente novamente.", "error-toast");
    btn.textContent = "✔ Confirmar Reserva";
    btn.disabled = false;
  }
}

// =====================================================================
// MODAL — FECHAR
// =====================================================================
function fecharModal() {
  document.getElementById("overlay").classList.remove("open");
  horariosSelecionados = [];
  tipoSelecionado = null;
}

document.getElementById("overlay").addEventListener("click", function(e) {
  if (e.target === this) fecharModal();
});

// =====================================================================
// TOAST
// =====================================================================
function showToast(msg, type) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3500);
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
carregarAgenda();
setInterval(carregarAgenda, 60000);
