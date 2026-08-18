import "../style.css";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  db,
  observarAuth,
  loginComGoogle,
  logout,
  podeAcessarPainel,
} from "../firebase.js";
import logoUrl from "../assets/logo.png";

const MENSAGEM_ERRO_LEITURA =
  "Não foi possível carregar os registros. Verifique sua permissão de acesso.";
const MENSAGEM_ERRO_CONFIRMAR = "Não foi possível confirmar a baixa. Tente novamente.";

let unsubscribeBaixasAntigas = null;
let unsubscribeVendas = null;

function formatarData(timestamp) {
  if (!timestamp) return "—";
  const d = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function criadoEmEmMilissegundos(criadoEm) {
  if (!criadoEm) return 0;
  if (typeof criadoEm.toMillis === "function") return criadoEm.toMillis();
  const d = new Date(criadoEm);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Formato antigo: 1 documento por baixa/produto em "baixas_estoque".
// Normaliza pro mesmo shape do formato novo (documento de venda com array).
function normalizarBaixaAntiga(id, dados) {
  return {
    id,
    origem: "baixas_estoque",
    unidade: dados.unidadeRetirada,
    criadoEm: dados.criadoEm,
    produtos: [
      {
        nome: dados.produto,
        codigoProduto: dados.codigoProduto || null,
        loteId: dados.lote || null,
        loteDivergente: !!dados.loteDivergente,
        fotoLote: dados.loteDivergente ? dados.loteFotoUrl || null : null,
      },
    ],
    fotoCupomFiscal: dados.fotoUrl || null,
    vendedorNome: dados.vendedorNome,
    vendedorEmail: dados.vendedorEmail,
    status: dados.status,
  };
}

// Formato novo: 1 documento por venda, com array de produtos, em "vendas_estoque".
function normalizarVenda(id, dados) {
  return {
    id,
    origem: "vendas_estoque",
    unidade: dados.unidade,
    criadoEm: dados.criadoEm,
    produtos: (dados.produtos || []).map((p) => ({
      nome: p.nome,
      codigoProduto: p.codigoProduto || null,
      loteId: p.loteId || null,
      loteDivergente: !!p.loteDivergente,
      fotoLote: p.loteDivergente ? p.fotoLote || null : null,
    })),
    fotoCupomFiscal: dados.fotoCupomFiscal || null,
    vendedorNome: dados.vendedorNome,
    vendedorEmail: dados.vendedorEmail,
    status: dados.status,
  };
}

function renderVendaCard(venda) {
  const produtos = venda.produtos || [];
  const totalItens = produtos.length;
  const algumDivergente = produtos.some((p) => p.loteDivergente);

  return `
    <div class="registro" data-id="${venda.id}" data-origem="${venda.origem}">
      <div class="registro__linha">
        <span class="registro__label">Unidade</span>
        <span class="registro__valor">${venda.unidade}</span>
      </div>
      <div class="registro__linha">
        <span class="registro__label">Itens</span>
        <span class="badge">${totalItens} ${totalItens === 1 ? "item" : "itens"}</span>
      </div>
      <div class="registro__produtos">
        ${produtos
          .map(
            (p) => `
              <div class="registro__produto-linha">
                <span class="registro__produto-nome">
                  ${p.nome}${p.codigoProduto ? ` <span class="registro__valor--discreto">(${p.codigoProduto})</span>` : ""}
                </span>
                <span class="registro__produto-lote">
                  ${
                    p.loteDivergente
                      ? `<span class="tag-alerta" title="Lote divergente do Bling">⚠ ${p.loteId || "manual"}</span>`
                      : p.loteId || "—"
                  }
                </span>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="registro__linha">
        <span class="registro__label">Vendedor</span>
        <span class="registro__valor">${venda.vendedorNome}</span>
      </div>
      <div class="registro__linha">
        <span class="registro__label">Data</span>
        <span class="registro__valor">${formatarData(venda.criadoEm)}</span>
      </div>
      <div class="registro__linha">
        <span class="registro__label">Status</span>
        <span class="registro__status-row">
          ${algumDivergente ? `<span class="tag-alerta">⚠ Lote divergente do Bling</span>` : ""}
          <span class="status status--${venda.status}">${venda.status}</span>
        </span>
      </div>
      <div class="registro__fotos">
        ${
          venda.fotoCupomFiscal
            ? `<button type="button" class="btn-link" data-ver-foto="${venda.id}" data-tipo-foto="cupom">Ver cupom fiscal</button>`
            : ""
        }
        ${produtos
          .map((p, i) =>
            p.loteDivergente && p.fotoLote
              ? `<button type="button" class="btn-link" data-ver-foto="${venda.id}" data-tipo-foto="lote" data-indice-produto="${i}">Ver foto do lote${totalItens > 1 ? ` (${p.nome})` : ""}</button>`
              : ""
          )
          .join("")}
      </div>
      ${
        venda.status === "pendente"
          ? `<div class="registro__acoes"><button class="btn" data-confirmar="${venda.id}">Confirmar baixa</button></div>`
          : ""
      }
    </div>
  `;
}

function renderLista(root, vendas) {
  const lista = root.querySelector("#lista");
  const contador = root.querySelector("#contador");

  const pendentes = vendas.filter((v) => v.status === "pendente").length;
  contador.textContent = `${pendentes} pendente${pendentes === 1 ? "" : "s"}`;

  if (vendas.length === 0) {
    lista.innerHTML = `<div class="empty-state">Nenhuma venda registrada ainda.</div>`;
    return;
  }

  lista.innerHTML = vendas.map((v) => renderVendaCard(v)).join("");
}

function renderLogin(root, mensagemErro) {
  root.innerHTML = `
    <div class="page-header page-header--wide">
      <div class="page-header__inner">
        <img class="page-header__logo" src="${logoUrl}" alt="Smart GR" />
        <p class="page-header__subtitle">Painel de estoque</p>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <h1>Entrar</h1>
        <p class="subtitle">Faça login com sua conta Google da SmartGR para acessar o painel.</p>
        ${
          mensagemErro
            ? `<p class="field-hint field-hint--erro">${mensagemErro}</p>`
            : ""
        }
        <button type="button" class="btn" id="btn-login-google">Continuar com Google</button>
      </div>
    </div>
  `;

  root.querySelector("#btn-login-google").addEventListener("click", async () => {
    try {
      await loginComGoogle();
    } catch (err) {
      renderLogin(root, err.message || "Não foi possível entrar. Tente novamente.");
    }
  });
}

function renderAcessoRestrito(root, user) {
  root.innerHTML = `
    <div class="page-header page-header--wide">
      <div class="page-header__inner">
        <img class="page-header__logo" src="${logoUrl}" alt="Smart GR" />
        <p class="page-header__subtitle">Painel de estoque</p>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <h1>Acesso restrito</h1>
        <p class="subtitle">A conta ${user.email} não tem permissão para acessar o painel de estoque.</p>
        <button type="button" class="btn" id="btn-logout">Sair</button>
      </div>
    </div>
  `;

  root.querySelector("#btn-logout").addEventListener("click", () => {
    logout();
  });
}

function renderPainelAutorizado(root, user) {
  root.innerHTML = `
    <div class="page-header page-header--wide">
      <div class="page-header__inner">
        <img class="page-header__logo" src="${logoUrl}" alt="Smart GR" />
        <p class="page-header__subtitle">Painel de estoque</p>
      </div>
    </div>
    <div class="content">
      <div class="card card--wide">
        <div class="painel-header">
          <h1>Baixas de estoque</h1>
          <span class="badge" id="contador">0 pendentes</span>
        </div>
        <p class="field-hint field-hint--erro" id="painel-erro" style="display: none;"></p>
        <div class="registro-list" id="lista"></div>
      </div>
    </div>
    <div class="modal-overlay" id="foto-modal">
      <div class="modal-content">
        <button type="button" class="modal-close" id="foto-modal-close" aria-label="Fechar">×</button>
        <img id="foto-modal-img" alt="" />
      </div>
    </div>
  `;

  const painelErro = root.querySelector("#painel-erro");
  let baixasAntigasAtuais = [];
  let vendasNovasAtuais = [];
  let registrosAtuais = [];

  function mostrarErroPainel(texto) {
    if (!texto) {
      painelErro.style.display = "none";
      painelErro.textContent = "";
      return;
    }
    painelErro.style.display = "block";
    painelErro.textContent = texto;
  }

  function mesclarERenderizar() {
    registrosAtuais = [...baixasAntigasAtuais, ...vendasNovasAtuais].sort(
      (a, b) => criadoEmEmMilissegundos(b.criadoEm) - criadoEmEmMilissegundos(a.criadoEm)
    );
    renderLista(root, registrosAtuais);
  }

  const qBaixasAntigas = query(collection(db, "baixas_estoque"), orderBy("criadoEm", "desc"));
  unsubscribeBaixasAntigas = onSnapshot(
    qBaixasAntigas,
    (snapshot) => {
      baixasAntigasAtuais = snapshot.docs.map((d) =>
        normalizarBaixaAntiga(d.id, d.data({ serverTimestamps: "estimate" }))
      );
      mostrarErroPainel(null);
      mesclarERenderizar();
    },
    () => {
      mostrarErroPainel(MENSAGEM_ERRO_LEITURA);
    }
  );

  const qVendas = query(collection(db, "vendas_estoque"), orderBy("criadoEm", "desc"));
  unsubscribeVendas = onSnapshot(
    qVendas,
    (snapshot) => {
      vendasNovasAtuais = snapshot.docs.map((d) =>
        normalizarVenda(d.id, d.data({ serverTimestamps: "estimate" }))
      );
      mostrarErroPainel(null);
      mesclarERenderizar();
    },
    () => {
      mostrarErroPainel(MENSAGEM_ERRO_LEITURA);
    }
  );

  const modal = root.querySelector("#foto-modal");
  const modalImg = root.querySelector("#foto-modal-img");

  function abrirModalFoto(url, alt) {
    modalImg.src = url;
    modalImg.alt = alt;
    modal.classList.add("show");
  }

  function fecharModalFoto() {
    modal.classList.remove("show");
    modalImg.src = "";
  }

  root.querySelector("#foto-modal-close").addEventListener("click", fecharModalFoto);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) fecharModalFoto();
  });

  root.querySelector("#lista").addEventListener("click", async (e) => {
    const idConfirmar = e.target.dataset.confirmar;
    if (idConfirmar) {
      const registro = registrosAtuais.find((r) => r.id === idConfirmar);
      if (!registro) return;
      try {
        await updateDoc(doc(db, registro.origem, idConfirmar), {
          status: "confirmado",
          confirmadoPor: user.email,
          confirmadoEm: serverTimestamp(),
        });
        mostrarErroPainel(null);
      } catch {
        mostrarErroPainel(MENSAGEM_ERRO_CONFIRMAR);
      }
      return;
    }

    const idFoto = e.target.dataset.verFoto;
    if (idFoto) {
      const tipo = e.target.dataset.tipoFoto;
      const venda = registrosAtuais.find((r) => r.id === idFoto);
      if (!venda) return;

      if (tipo === "cupom") {
        if (!venda.fotoCupomFiscal) return;
        abrirModalFoto(venda.fotoCupomFiscal, "Foto do cupom fiscal");
        return;
      }

      const indice = Number(e.target.dataset.indiceProduto);
      const produto = (venda.produtos || [])[indice];
      if (!produto || !produto.fotoLote) return;
      abrirModalFoto(produto.fotoLote, `Foto do lote — ${produto.nome}`);
    }
  });
}

export function renderPainel(root) {
  observarAuth((user) => {
    if (unsubscribeBaixasAntigas) {
      unsubscribeBaixasAntigas();
      unsubscribeBaixasAntigas = null;
    }
    if (unsubscribeVendas) {
      unsubscribeVendas();
      unsubscribeVendas = null;
    }

    if (!user) {
      renderLogin(root);
    } else if (!podeAcessarPainel(user)) {
      renderAcessoRestrito(root, user);
    } else {
      renderPainelAutorizado(root, user);
    }
  });
}

renderPainel(document.querySelector("#app"));
