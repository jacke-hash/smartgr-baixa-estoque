import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, observarAuth, loginComGoogle, logout } from "../firebase.js";
import logoUrl from "../assets/logo.png";

const API_BASE = "https://smartgr-busca-produtos-bling.jacke-a59.workers.dev";
const UPLOAD_BASE = "https://smartgr-upload-baixa-estoque.jacke-a59.workers.dev";
const LOTE_OUTRO_VALUE = "__outro__";
const MENSAGEM_ERRO_BLING =
  "Não foi possível carregar os dados agora. Você pode digitar manualmente.";
const MENSAGEM_ERRO_UPLOAD = "Não foi possível enviar a foto. Tente novamente.";
const MENSAGEM_ERRO_SALVAR = "Não foi possível registrar a venda. Tente novamente.";
const UNIDADES_RETIRADA = ["Zona Sul", "Zona Leste", "Rio Claro", "Recife", "Porto Alegre"];

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
          <div class="field field--autocomplete">
            <label for="produto">Produto</label>
            <input
              type="text"
              id="produto"
              autocomplete="off"
              placeholder="Digite o nome do produto"
              required
            />
            <div class="autocomplete-list" id="produto-sugestoes"></div>
            <p class="field-hint" id="produto-erro" style="display: none;"></p>
          </div>

          <div class="field">
            <label for="unidade-retirada">Unidade de retirada</label>
            <select id="unidade-retirada" required>
              <option value="" disabled selected>Selecione a unidade</option>
              ${UNIDADES_RETIRADA.map((u) => `<option value="${u}">${u}</option>`).join("")}
            </select>
          </div>

          <div class="field" id="lote-area">
            <label>Lote</label>
            <p class="field-hint">Selecione um produto para ver os lotes.</p>
          </div>

          <div class="field">
            <label for="foto">Foto do cupom fiscal</label>
            <label class="field-file" id="drop-foto">
              <input type="file" id="foto" accept="image/*" required />
              <span class="field-file__label" id="foto-label">Toque para anexar a foto</span>
              <img class="field-file__preview" id="foto-preview" alt="Pré-visualização do cupom" />
            </label>
            <p class="field-hint" id="foto-status" style="display: none;"></p>
          </div>

          <div class="field" id="foto-lote-field" style="display: none;">
            <label for="foto-lote">
              Foto do lote <span id="foto-lote-hint"></span>
            </label>
            <label class="field-file" id="drop-foto-lote">
              <input type="file" id="foto-lote" accept="image/*" />
              <span class="field-file__label" id="foto-lote-label">Toque para anexar a foto do lote</span>
              <img class="field-file__preview" id="foto-lote-preview" alt="Pré-visualização do lote" />
            </label>
            <p class="field-hint" id="foto-lote-status" style="display: none;"></p>
          </div>

          <p class="field-hint field-hint--erro" id="form-erro" style="display: none;"></p>
          <button type="submit" class="btn" id="btn-confirmar">Confirmar baixa</button>
          <div class="toast" id="toast">Venda registrada! Aguardando confirmação do estoque.</div>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector("#form-venda");
  const produtoInput = root.querySelector("#produto");
  const produtoSugestoes = root.querySelector("#produto-sugestoes");
  const produtoErro = root.querySelector("#produto-erro");
  const unidadeInput = root.querySelector("#unidade-retirada");
  const loteArea = root.querySelector("#lote-area");
  const fotoLoteField = root.querySelector("#foto-lote-field");
  const fotoLoteHint = root.querySelector("#foto-lote-hint");
  const fotoInput = root.querySelector("#foto");
  const fotoLabel = root.querySelector("#foto-label");
  const fotoPreview = root.querySelector("#foto-preview");
  const fotoStatus = root.querySelector("#foto-status");
  const fotoLoteInput = root.querySelector("#foto-lote");
  const fotoLoteLabel = root.querySelector("#foto-lote-label");
  const fotoLotePreview = root.querySelector("#foto-lote-preview");
  const fotoLoteStatus = root.querySelector("#foto-lote-status");
  const btnConfirmar = root.querySelector("#btn-confirmar");
  const formErro = root.querySelector("#form-erro");
  const toast = root.querySelector("#toast");

  // true = lote não bate com o cadastro do Bling (manual/outro), false = validado via dropdown
  let loteDivergente = false;
  // produto escolhido na lista de sugestões: { id, nome }
  let produtoSelecionado = null;

  // status: "idle" | "uploading" | "success" | "error"
  const fotoUpload = { status: "idle", url: null };
  const loteFotoUpload = { status: "idle", url: null };
  let salvando = false;

  function atualizarBotaoConfirmar() {
    btnConfirmar.disabled =
      !unidadeInput.value ||
      fotoUpload.status === "uploading" ||
      loteFotoUpload.status === "uploading" ||
      salvando;
  }

  unidadeInput.addEventListener("change", atualizarBotaoConfirmar);
  atualizarBotaoConfirmar();

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
  setupPreviewEUpload(
    fotoLoteInput,
    fotoLoteLabel,
    fotoLotePreview,
    fotoLoteStatus,
    "lote",
    loteFotoUpload
  );

  function atualizarObrigatoriedadeFotoLote() {
    fotoLoteInput.required = loteDivergente;
    fotoLoteField.style.display = loteDivergente ? "block" : "none";
    fotoLoteHint.textContent = loteDivergente ? "(obrigatório)" : "";
  }

  function renderDropdownLote(lotes) {
    loteArea.innerHTML = `
      <label for="lote-select">Lote</label>
      <select id="lote-select" required>
        <option value="" disabled selected>Selecione o lote</option>
        ${lotes.map((l) => `<option value="${l}">${l}</option>`).join("")}
        <option value="${LOTE_OUTRO_VALUE}">Não é nenhum desses / outro lote</option>
      </select>
      <div id="lote-manual-wrapper"></div>
    `;

    const loteSelect = loteArea.querySelector("#lote-select");
    loteSelect.addEventListener("change", () => {
      const manualWrapper = loteArea.querySelector("#lote-manual-wrapper");
      if (loteSelect.value === LOTE_OUTRO_VALUE) {
        loteDivergente = true;
        manualWrapper.innerHTML = `
          <input type="text" id="lote-manual" placeholder="Digite o lote" required style="margin-top: 10px;" />
        `;
      } else {
        loteDivergente = false;
        manualWrapper.innerHTML = "";
      }
      atualizarObrigatoriedadeFotoLote();
    });
  }

  function renderManualLote(mensagem) {
    loteDivergente = true;
    loteArea.innerHTML = `
      <label for="lote-manual">Lote</label>
      <input type="text" id="lote-manual" placeholder="Digite o lote" required />
      <p class="field-hint">${mensagem}</p>
    `;
    atualizarObrigatoriedadeFotoLote();
  }

  function esconderSugestoesProduto() {
    produtoSugestoes.innerHTML = "";
    produtoSugestoes.classList.remove("show");
  }

  function mostrarErroProduto(mostrar) {
    produtoErro.style.display = mostrar ? "block" : "none";
    produtoErro.textContent = mostrar ? MENSAGEM_ERRO_BLING : "";
  }

  function renderSugestoesProduto(produtos) {
    if (produtos.length === 0) {
      esconderSugestoesProduto();
      return;
    }
    produtoSugestoes.innerHTML = produtos
      .map(
        (p, i) =>
          `<div class="autocomplete-item" data-index="${i}">${p.nome}</div>`
      )
      .join("");
    produtoSugestoes.classList.add("show");

    produtoSugestoes.querySelectorAll(".autocomplete-item").forEach((item) => {
      item.addEventListener("click", () => {
        const produto = produtos[Number(item.dataset.index)];
        produtoSelecionado = produto;
        produtoInput.value = produto.nome;
        esconderSugestoesProduto();
        buscarLotesProduto(produto.id);
      });
    });
  }

  async function buscarProdutos(busca) {
    try {
      const res = await fetch(
        `${API_BASE}/produtos?busca=${encodeURIComponent(busca)}`
      );
      const json = await res.json();
      if (!res.ok || json.erro) throw new Error(json.erro || "Falha na busca");
      mostrarErroProduto(false);
      renderSugestoesProduto(json.data || []);
    } catch {
      mostrarErroProduto(true);
      esconderSugestoesProduto();
    }
  }

  const buscarProdutosDebounced = debounce(buscarProdutos, 400);

  async function buscarLotesProduto(idProduto) {
    loteDivergente = false;
    loteArea.innerHTML = `<label>Lote</label><p class="field-hint">Buscando lotes...</p>`;
    atualizarObrigatoriedadeFotoLote();

    try {
      const res = await fetch(`${API_BASE}/lotes?idProduto=${idProduto}`);
      const json = await res.json();
      if (!res.ok || json.erro) throw new Error(json.erro || "Falha na busca");
      const lotes = json.data || [];
      if (lotes.length > 0) {
        renderDropdownLote(lotes.map((l) => l.codigoLote));
      } else {
        renderManualLote(
          "Nenhum lote cadastrado no Bling para este produto. Informe o lote manualmente."
        );
      }
    } catch {
      renderManualLote(MENSAGEM_ERRO_BLING);
    }
  }

  produtoInput.addEventListener("input", () => {
    if (produtoSelecionado && produtoInput.value !== produtoSelecionado.nome) {
      produtoSelecionado = null;
      loteDivergente = false;
      loteArea.innerHTML = `<label>Lote</label><p class="field-hint">Selecione um produto para ver os lotes.</p>`;
      atualizarObrigatoriedadeFotoLote();
    }

    const busca = produtoInput.value.trim();
    if (busca.length < 2) {
      esconderSugestoesProduto();
      mostrarErroProduto(false);
      return;
    }
    buscarProdutosDebounced(busca);
  });

  root.addEventListener("click", (e) => {
    if (!produtoSugestoes.contains(e.target) && e.target !== produtoInput) {
      esconderSugestoesProduto();
    }
  });

  root.querySelector("#btn-logout").addEventListener("click", () => {
    logout();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const produtoNome = produtoInput.value.trim();
    const unidadeRetirada = unidadeInput.value;
    const loteManualInput = loteArea.querySelector("#lote-manual");
    const loteSelect = loteArea.querySelector("#lote-select");
    const lote = loteManualInput
      ? loteManualInput.value.trim()
      : loteSelect
        ? loteSelect.value
        : "";
    const foto = fotoInput.files[0];
    const fotoLote = fotoLoteInput.files[0];

    if (!produtoNome || !unidadeRetirada || !lote || !foto) return;
    if (loteDivergente && !fotoLote) return;

    if (fotoUpload.status !== "success" || !fotoUpload.url) {
      mostrarStatusUpload(fotoStatus, MENSAGEM_ERRO_UPLOAD, true);
      return;
    }
    if (loteDivergente && (loteFotoUpload.status !== "success" || !loteFotoUpload.url)) {
      mostrarStatusUpload(fotoLoteStatus, MENSAGEM_ERRO_UPLOAD, true);
      return;
    }

    salvando = true;
    mostrarStatusUpload(formErro, "", false);
    atualizarBotaoConfirmar();

    try {
      await addDoc(collection(db, "baixas_estoque"), {
        produto: produtoNome,
        codigoProduto: produtoSelecionado ? produtoSelecionado.codigo : null,
        idProdutoBling: produtoSelecionado ? produtoSelecionado.id : null,
        unidadeRetirada,
        lote,
        loteDivergente,
        fotoUrl: fotoUpload.url,
        loteFotoUrl: loteDivergente ? loteFotoUpload.url : null,
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
    form.reset();
    produtoSelecionado = null;
    esconderSugestoesProduto();
    mostrarErroProduto(false);
    fotoLabel.textContent = "Toque para anexar a foto";
    fotoPreview.style.display = "none";
    fotoLoteLabel.textContent = "Toque para anexar a foto do lote";
    fotoLotePreview.style.display = "none";
    fotoUpload.status = "idle";
    fotoUpload.url = null;
    loteFotoUpload.status = "idle";
    loteFotoUpload.url = null;
    mostrarStatusUpload(fotoStatus, "", false);
    mostrarStatusUpload(fotoLoteStatus, "", false);
    mostrarStatusUpload(formErro, "", false);
    atualizarBotaoConfirmar();
    loteDivergente = false;
    loteArea.innerHTML = `<label>Lote</label><p class="field-hint">Selecione um produto para ver os lotes.</p>`;
    atualizarObrigatoriedadeFotoLote();

    setTimeout(() => toast.classList.remove("show"), 4000);
  });
}
