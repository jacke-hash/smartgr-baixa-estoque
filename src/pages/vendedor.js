import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db, observarAuth, loginComGoogle, logout } from "../firebase.js";
import logoUrl from "../assets/logo.png";

const API_BASE = "https://smartgr-busca-produtos-bling.jacke-a59.workers.dev";
const UPLOAD_BASE = "https://smartgr-upload-baixa-estoque.jacke-a59.workers.dev";
const LOTE_OUTRO_VALUE = "__outro__";
const MENSAGEM_ERRO_BLING =
  "Não foi possível carregar os dados agora. Você pode digitar manualmente.";
const MENSAGEM_LOTE_NAO_CADASTRADO = "Nenhum lote cadastrado — lote divergente.";
const MENSAGEM_ERRO_UPLOAD = "Não foi possível enviar a foto. Tente novamente.";
const MENSAGEM_ERRO_SALVAR = "Não foi possível registrar a venda. Tente novamente.";
const UNIDADES_RETIRADA = ["Zona Sul", "Zona Leste"];

async function uploadFoto(arquivo, tipo) {
  const formData = new FormData();
  formData.append("arquivo", arquivo);
  formData.append("tipo", tipo);
  const res = await fetch(`${UPLOAD_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  const json = await res.json();
  if (!res.ok || json.erro) throw new Error(json.erro || "Falha no upload");
  return json.url;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function renderVendedor(root) {
  observarAuth((user) => {
    if (user) {
      renderFormularioVenda(root, user);
    } else {
      renderLogin(root);
    }
  });
}

function renderLogin(root, mensagemErro) {
  root.innerHTML = `
    <div class="page-header">
      <div class="page-header__inner">
        <img class="page-header__logo" src="${logoUrl}" alt="Smart GR" />
        <p class="page-header__subtitle">Registro de venda</p>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <h1>Entrar</h1>
        <p class="subtitle">Faça login com sua conta Google da SmartGR para registrar vendas.</p>
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

function renderFormularioVenda(root, user) {
  root.innerHTML = `
    <div class="page-header">
      <div class="page-header__inner">
        <img class="page-header__logo" src="${logoUrl}" alt="Smart GR" />
        <p class="page-header__subtitle">Registro de venda</p>
      </div>
    </div>
    <div class="content">
      <div class="card">
        <div class="user-card">
          <div>
            <div class="user-card__nome">${user.displayName || "Vendedor"}</div>
            <div class="user-card__email">${user.email}</div>
          </div>
          <button type="button" class="btn-logout" id="btn-logout">Sair</button>
        </div>
        <h1>Registrar venda</h1>
        <p class="subtitle">Preencha os dados para dar baixa no estoque.</p>
        <form id="form-venda">
          <div class="field">
            <label for="unidade-retirada">Unidade de retirada</label>
            <select id="unidade-retirada" required>
              <option value="" disabled selected>Selecione a unidade</option>
              ${UNIDADES_RETIRADA.map((u) => `<option value="${u}">${u}</option>`).join("")}
            </select>
          </div>

          <div id="produtos-lista"></div>

          <button type="button" class="btn-add-produto" id="btn-add-produto">+ Adicionar produto</button>

          <div class="field">
            <label for="foto">Foto do cupom fiscal</label>
            <label class="field-file" id="drop-foto">
              <input type="file" id="foto" accept="image/*" required />
              <span class="field-file__label" id="foto-label">Toque para anexar a foto</span>
              <img class="field-file__preview" id="foto-preview" alt="Pré-visualização do cupom" />
            </label>
            <p class="field-hint" id="foto-status" style="display: none;"></p>
          </div>

          <p class="field-hint field-hint--erro" id="form-erro" style="display: none;"></p>
          <button type="submit" class="btn" id="btn-confirmar">Confirmar baixa</button>
          <div class="toast" id="toast">Venda registrada! Aguardando confirmação do estoque.</div>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector("#form-venda");
  const unidadeInput = root.querySelector("#unidade-retirada");
  const produtosLista = root.querySelector("#produtos-lista");
  const btnAddProduto = root.querySelector("#btn-add-produto");
  const fotoInput = root.querySelector("#foto");
  const fotoLabel = root.querySelector("#foto-label");
  const fotoPreview = root.querySelector("#foto-preview");
  const fotoStatus = root.querySelector("#foto-status");
  const btnConfirmar = root.querySelector("#btn-confirmar");
  const formErro = root.querySelector("#form-erro");
  const toast = root.querySelector("#toast");

  // status: "idle" | "uploading" | "success" | "error"
  const fotoUpload = { status: "idle", url: null };
  let salvando = false;
  let itemUidSeq = 0;
  // cada item: { uid, card, produtoInput, produtoSugestoes, produtoErro, loteArea,
  //   fotoLoteField, fotoLoteHint, fotoLoteInput, fotoLoteLabel, fotoLotePreview,
  //   fotoLoteStatus, removerBtn, produtoSelecionado, loteDivergente, loteFotoUpload }
  const itens = [];

  function obterLoteAtual(item) {
    const manual = item.loteArea.querySelector(".js-lote-manual");
    if (manual) return manual.value.trim();
    const select = item.loteArea.querySelector(".js-lote-select");
    if (select && select.value && select.value !== LOTE_OUTRO_VALUE) return select.value;
    return "";
  }

  function atualizarBotaoConfirmar() {
    const uploadsEmAndamento =
      fotoUpload.status === "uploading" ||
      itens.some((it) => it.loteFotoUpload.status === "uploading");

    const todosItensValidos =
      itens.length > 0 &&
      itens.every((it) => {
        const nomeOk = it.produtoInput.value.trim().length > 0;
        const loteOk = obterLoteAtual(it).length > 0;
        const fotoLoteOk =
          !it.loteDivergente || (it.loteFotoUpload.status === "success" && !!it.loteFotoUpload.url);
        return nomeOk && loteOk && fotoLoteOk;
      });

    btnConfirmar.disabled =
      !unidadeInput.value ||
      !todosItensValidos ||
      !(fotoUpload.status === "success" && fotoUpload.url) ||
      uploadsEmAndamento ||
      salvando;
  }

  unidadeInput.addEventListener("change", atualizarBotaoConfirmar);

  function mostrarStatusUpload(statusEl, texto, ehErro) {
    if (!texto) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
      statusEl.classList.remove("field-hint--erro");
      return;
    }
    statusEl.style.display = "block";
    statusEl.textContent = texto;
    statusEl.classList.toggle("field-hint--erro", !!ehErro);
  }

  function setupPreviewEUpload(input, label, preview, statusEl, tipo, state) {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;

      label.textContent = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        preview.src = reader.result;
        preview.style.display = "block";
      };
      reader.readAsDataURL(file);

      state.status = "uploading";
      state.url = null;
      mostrarStatusUpload(statusEl, "Enviando foto...", false);
      atualizarBotaoConfirmar();

      try {
        const url = await uploadFoto(file, tipo);
        state.status = "success";
        state.url = url;
        mostrarStatusUpload(statusEl, "", false);
      } catch {
        state.status = "error";
        state.url = null;
        mostrarStatusUpload(statusEl, MENSAGEM_ERRO_UPLOAD, true);
      }
      atualizarBotaoConfirmar();
    });
  }

  setupPreviewEUpload(fotoInput, fotoLabel, fotoPreview, fotoStatus, "cupom", fotoUpload);

  function atualizarObrigatoriedadeFotoLote(item) {
    item.fotoLoteInput.required = item.loteDivergente;
    item.fotoLoteField.style.display = item.loteDivergente ? "block" : "none";
    item.fotoLoteHint.textContent = item.loteDivergente ? "(obrigatório)" : "";
  }

  function alertaLoteDivergenteHTML(mensagem) {
    return `<p class="field-hint field-hint--erro"><span aria-hidden="true">⚠</span> ${mensagem}</p>`;
  }

  function renderDropdownLote(item, lotes) {
    item.loteArea.innerHTML = `
      <label>Lote</label>
      <select class="js-lote-select" required>
        <option value="" disabled selected>Selecione o lote</option>
        ${lotes.map((l) => `<option value="${l}">${l}</option>`).join("")}
        <option value="${LOTE_OUTRO_VALUE}">Não é nenhum desses / outro lote</option>
      </select>
      <div class="js-lote-manual-wrapper"></div>
    `;

    const loteSelect = item.loteArea.querySelector(".js-lote-select");
    loteSelect.addEventListener("change", () => {
      const manualWrapper = item.loteArea.querySelector(".js-lote-manual-wrapper");
      if (loteSelect.value === LOTE_OUTRO_VALUE) {
        item.loteDivergente = true;
        manualWrapper.innerHTML = `
          <input type="text" class="js-lote-manual" placeholder="Digite o número do lote manualmente" required style="margin-top: 10px;" />
        `;
        manualWrapper
          .querySelector(".js-lote-manual")
          .addEventListener("input", atualizarBotaoConfirmar);
      } else {
        item.loteDivergente = false;
        manualWrapper.innerHTML = "";
      }
      atualizarObrigatoriedadeFotoLote(item);
      atualizarBotaoConfirmar();
    });
  }

  function renderManualLote(item, mensagem) {
    item.loteDivergente = true;
    item.loteArea.innerHTML = `
      <label>Lote</label>
      <input type="text" class="js-lote-manual" placeholder="Digite o número do lote manualmente" required />
      ${alertaLoteDivergenteHTML(mensagem)}
    `;
    item.loteArea
      .querySelector(".js-lote-manual")
      .addEventListener("input", atualizarBotaoConfirmar);
    atualizarObrigatoriedadeFotoLote(item);
  }

  function esconderSugestoesProduto(item) {
    item.produtoSugestoes.innerHTML = "";
    item.produtoSugestoes.classList.remove("show");
  }

  function mostrarErroProduto(item, mostrar) {
    item.produtoErro.style.display = mostrar ? "block" : "none";
    item.produtoErro.textContent = mostrar ? MENSAGEM_ERRO_BLING : "";
  }

  function renderSugestoesProduto(item, produtos) {
    if (produtos.length === 0) {
      esconderSugestoesProduto(item);
      return;
    }
    item.produtoSugestoes.innerHTML = produtos
      .map((p, i) => `<div class="autocomplete-item" data-index="${i}">${p.nome}</div>`)
      .join("");
    item.produtoSugestoes.classList.add("show");

    item.produtoSugestoes.querySelectorAll(".autocomplete-item").forEach((el) => {
      el.addEventListener("click", () => {
        const produto = produtos[Number(el.dataset.index)];
        item.produtoSelecionado = produto;
        item.produtoInput.value = produto.nome;
        esconderSugestoesProduto(item);
        buscarLotesProduto(item, produto.id);
      });
    });
  }

  async function buscarProdutos(item, busca) {
    try {
      const res = await fetch(
        `${API_BASE}/produtos?busca=${encodeURIComponent(busca)}`
      );
      const json = await res.json();
      if (!res.ok || json.erro) throw new Error(json.erro || "Falha na busca");
      mostrarErroProduto(item, false);
      renderSugestoesProduto(item, json.data || []);
    } catch {
      mostrarErroProduto(item, true);
      esconderSugestoesProduto(item);
    }
  }

  async function buscarLotesProduto(item, idProduto) {
    item.loteDivergente = false;
    item.loteArea.innerHTML = `<label>Lote</label><p class="field-hint">Buscando lotes...</p>`;
    atualizarObrigatoriedadeFotoLote(item);
    atualizarBotaoConfirmar();

    try {
      const res = await fetch(`${API_BASE}/lotes?idProduto=${idProduto}`);
      const json = await res.json();
      if (!res.ok || json.erro) throw new Error(json.erro || "Falha na busca");
      const lotes = json.data || [];
      if (lotes.length > 0) {
        renderDropdownLote(item, lotes.map((l) => l.codigoLote));
      } else {
        renderManualLote(item, MENSAGEM_LOTE_NAO_CADASTRADO);
      }
    } catch {
      renderManualLote(item, MENSAGEM_ERRO_BLING);
    }
    atualizarBotaoConfirmar();
  }

  function criarItemHTML() {
    return `
      <div class="produto-item">
        <div class="produto-item__header">
          <span class="produto-item__titulo">Produto</span>
          <button type="button" class="produto-item__remover js-remover-item" aria-label="Remover produto">🗑</button>
        </div>
        <div class="field field--autocomplete">
          <label>Produto</label>
          <input
            type="text"
            class="js-produto"
            autocomplete="off"
            placeholder="Digite o nome do produto"
            required
          />
          <div class="autocomplete-list js-produto-sugestoes"></div>
          <p class="field-hint js-produto-erro" style="display: none;"></p>
        </div>
        <div class="field js-lote-area">
          <label>Lote</label>
          <p class="field-hint">Selecione um produto para ver os lotes.</p>
        </div>
        <div class="field js-foto-lote-field" style="display: none;">
          <label>Foto do lote <span class="js-foto-lote-hint"></span></label>
          <label class="field-file js-drop-foto-lote">
            <input type="file" class="js-foto-lote" accept="image/*" />
            <span class="field-file__label js-foto-lote-label">Toque para anexar a foto do lote</span>
            <img class="field-file__preview js-foto-lote-preview" alt="Pré-visualização do lote" />
          </label>
          <p class="field-hint js-foto-lote-status" style="display: none;"></p>
        </div>
      </div>
    `;
  }

  function atualizarVisibilidadeRemover() {
    const mostrar = itens.length > 1;
    itens.forEach((it) => {
      it.removerBtn.style.display = mostrar ? "inline-flex" : "none";
    });
  }

  function removerItem(item) {
    const idx = itens.indexOf(item);
    if (idx === -1) return;
    itens.splice(idx, 1);
    item.card.remove();
    atualizarVisibilidadeRemover();
    atualizarBotaoConfirmar();
  }

  function configurarItem(item) {
    const buscarProdutosDebounced = debounce((busca) => buscarProdutos(item, busca), 400);

    item.produtoInput.addEventListener("input", () => {
      if (item.produtoSelecionado && item.produtoInput.value !== item.produtoSelecionado.nome) {
        item.produtoSelecionado = null;
        item.loteDivergente = false;
        item.loteArea.innerHTML = `<label>Lote</label><p class="field-hint">Selecione um produto para ver os lotes.</p>`;
        atualizarObrigatoriedadeFotoLote(item);
      }

      const busca = item.produtoInput.value.trim();
      if (busca.length < 2) {
        esconderSugestoesProduto(item);
        mostrarErroProduto(item, false);
        atualizarBotaoConfirmar();
        return;
      }
      buscarProdutosDebounced(busca);
      atualizarBotaoConfirmar();
    });

    setupPreviewEUpload(
      item.fotoLoteInput,
      item.fotoLoteLabel,
      item.fotoLotePreview,
      item.fotoLoteStatus,
      "lote",
      item.loteFotoUpload
    );

    item.removerBtn.addEventListener("click", () => removerItem(item));
  }

  function adicionarItem() {
    const uid = `item-${itemUidSeq++}`;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = criarItemHTML();
    const card = wrapper.firstElementChild;
    card.dataset.uid = uid;
    produtosLista.appendChild(card);

    const item = {
      uid,
      card,
      produtoInput: card.querySelector(".js-produto"),
      produtoSugestoes: card.querySelector(".js-produto-sugestoes"),
      produtoErro: card.querySelector(".js-produto-erro"),
      loteArea: card.querySelector(".js-lote-area"),
      fotoLoteField: card.querySelector(".js-foto-lote-field"),
      fotoLoteHint: card.querySelector(".js-foto-lote-hint"),
      fotoLoteInput: card.querySelector(".js-foto-lote"),
      fotoLoteLabel: card.querySelector(".js-foto-lote-label"),
      fotoLotePreview: card.querySelector(".js-foto-lote-preview"),
      fotoLoteStatus: card.querySelector(".js-foto-lote-status"),
      removerBtn: card.querySelector(".js-remover-item"),
      produtoSelecionado: null,
      loteDivergente: false,
      loteFotoUpload: { status: "idle", url: null },
    };

    itens.push(item);
    configurarItem(item);
    atualizarVisibilidadeRemover();
    atualizarBotaoConfirmar();
  }

  btnAddProduto.addEventListener("click", () => adicionarItem());

  root.addEventListener("click", (e) => {
    itens.forEach((item) => {
      if (!item.produtoSugestoes.contains(e.target) && e.target !== item.produtoInput) {
        esconderSugestoesProduto(item);
      }
    });
  });

  root.querySelector("#btn-logout").addEventListener("click", () => {
    logout();
  });

  function resetarFormulario() {
    form.reset();
    produtosLista.innerHTML = "";
    itens.length = 0;
    fotoLabel.textContent = "Toque para anexar a foto";
    fotoPreview.style.display = "none";
    fotoUpload.status = "idle";
    fotoUpload.url = null;
    mostrarStatusUpload(fotoStatus, "", false);
    mostrarStatusUpload(formErro, "", false);
    adicionarItem();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const unidade = unidadeInput.value;
    if (!unidade) return;

    if (fotoUpload.status !== "success" || !fotoUpload.url) {
      mostrarStatusUpload(fotoStatus, MENSAGEM_ERRO_UPLOAD, true);
      return;
    }

    const produtosPayload = [];
    for (const item of itens) {
      const nome = item.produtoInput.value.trim();
      const loteManualInput = item.loteArea.querySelector(".js-lote-manual");
      const loteSelect = item.loteArea.querySelector(".js-lote-select");
      const loteDigitadoManualmente = !!loteManualInput;
      const lote = loteManualInput
        ? loteManualInput.value.trim()
        : loteSelect
          ? loteSelect.value
          : "";

      if (!nome || !lote) return;
      if (item.loteDivergente && (item.loteFotoUpload.status !== "success" || !item.loteFotoUpload.url)) {
        mostrarStatusUpload(item.fotoLoteStatus, MENSAGEM_ERRO_UPLOAD, true);
        return;
      }

      const produtoPayload = {
        produtoId: item.produtoSelecionado ? item.produtoSelecionado.id : null,
        nome,
        codigoProduto: item.produtoSelecionado ? item.produtoSelecionado.codigo : null,
        loteId: loteDigitadoManualmente ? null : lote,
        loteDigitadoManualmente,
        loteDivergente: item.loteDivergente,
      };
      if (item.loteDivergente) {
        produtoPayload.fotoLote = item.loteFotoUpload.url;
      }
      produtosPayload.push(produtoPayload);
    }

    if (produtosPayload.length === 0) return;

    salvando = true;
    mostrarStatusUpload(formErro, "", false);
    atualizarBotaoConfirmar();

    try {
      const vendaRef = doc(collection(db, "vendas_estoque"));
      await setDoc(vendaRef, {
        vendaId: vendaRef.id,
        unidade,
        produtos: produtosPayload,
        fotoCupomFiscal: fotoUpload.url,
        vendedorNome: user.displayName || user.email,
        vendedorEmail: user.email,
        criadoEm: serverTimestamp(),
        status: "pendente",
      });
    } catch {
      salvando = false;
      atualizarBotaoConfirmar();
      mostrarStatusUpload(formErro, MENSAGEM_ERRO_SALVAR, true);
      return;
    }

    salvando = false;
    toast.classList.add("show");
    resetarFormulario();
    atualizarBotaoConfirmar();

    setTimeout(() => toast.classList.remove("show"), 4000);
  });

  adicionarItem();
  atualizarBotaoConfirmar();
}
