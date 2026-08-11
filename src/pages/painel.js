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

let unsubscribeSnapshot = null;

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

function renderLista(root, registros) {
  const lista = root.querySelector("#lista");
  const contador = root.querySelector("#contador");

  const pendentes = registros.filter((r) => r.status === "pendente").length;
  contador.textContent = `${pendentes} pendente${pendentes === 1 ? "" : "s"}`;

  if (registros.length === 0) {
    lista.innerHTML = `<div class="empty-state">Nenhum registro de venda ainda.</div>`;
    return;
  }

  lista.innerHTML = registros
    .map(
      (r) => `
      <div class="registro" data-id="${r.id}">
        <div class="registro__linha">
          <span class="registro__label">Produto</span>
          <span class="registro__valor">${r.produto}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">SKU</span>
          <span class="registro__valor${r.codigoProduto ? "" : " registro__valor--discreto"}">${r.codigoProduto || "SKU não identificado"}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">Unidade</span>
          <span class="registro__valor">${r.unidadeRetirada}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">Lote</span>
          <span class="registro__valor">${r.lote}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">Vendedor</span>
          <span class="registro__valor">${r.vendedorNome}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">Data</span>
          <span class="registro__valor">${formatarData(r.criadoEm)}</span>
        </div>
        <div class="registro__linha">
          <span class="registro__label">Status</span>
          <span class="registro__status-row">
            ${r.loteDivergente ? `<span class="tag-alerta">⚠ Lote divergente do Bling</span>` : ""}
            <span class="status status--${r.status}">${r.status}</span>
          </span>
        </div>
        ${
          r.fotoUrl || r.loteFotoUrl
            ? `<div class="registro__fotos">
                ${
                  r.fotoUrl
                    ? `<button type="button" class="btn-link" data-ver-foto="${r.id}" data-tipo-foto="cupom">Ver cupom fiscal</button>`
                    : ""
                }
                ${
                  r.loteFotoUrl
                    ? `<button type="button" class="btn-link" data-ver-foto="${r.id}" data-tipo-foto="lote">Ver foto do lote</button>`
                    : ""
                }
              </div>`
            : ""
        }
        ${
          r.status === "pendente"
            ? `<div class="registro__acoes"><button class="btn" data-confirmar="${r.id}">Confirmar baixa</button></div>`
            : ""
        }
      </div>
    `
    )
    .join("");
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

  const q = query(collection(db, "baixas_estoque"), orderBy("criadoEm", "desc"));
  unsubscribeSnapshot = onSnapshot(
    q,
    (snapshot) => {
      registrosAtuais = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data({ serverTimestamps: "estimate" }),
      }));
      mostrarErroPainel(null);
      renderLista(root, registrosAtuais);
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
      try {
        await updateDoc(doc(db, "baixas_estoque", idConfirmar), {
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
      const registro = registrosAtuais.find((r) => r.id === idFoto);
      if (!registro) return;
      const url = tipo === "lote" ? registro.loteFotoUrl : registro.fotoUrl;
      if (!url) return;
      abrirModalFoto(url, tipo === "lote" ? "Foto do lote" : "Foto do cupom fiscal");
    }
  });
}

export function renderPainel(root) {
  observarAuth((user) => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
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
