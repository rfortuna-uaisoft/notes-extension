const $ = (id) => document.getElementById(id);
const titulo = $("titulo");
const corpo = $("corpo");
const aviso = $("aviso");
const btnSalvar = $("salvar");
const pastaNome = $("pastaNome");

let pasta = null; // FileSystemDirectoryHandle, guardado no IndexedDB

function avisar(msg, tipo = "") {
  aviso.textContent = msg;
  aviso.className = tipo;
}

/* ---- IndexedDB: único lugar que aceita guardar o handle da pasta ---- */
function abrirDb() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open("nota-rapida", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}

async function dbGet(chave) {
  const db = await abrirDb();
  return new Promise((ok, erro) => {
    const req = db.transaction("kv").objectStore("kv").get(chave);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}

async function dbSet(chave, valor) {
  const db = await abrirDb();
  return new Promise((ok, erro) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(valor, chave);
    tx.oncomplete = () => ok();
    tx.onerror = () => erro(tx.error);
  });
}

/* ---- Pasta de destino ---- */
function mostrarPasta() {
  pastaNome.textContent = pasta ? pasta.name : "Escolher pasta";
}

async function escolherPasta() {
  try {
    pasta = await showDirectoryPicker({ id: "nota-rapida", mode: "readwrite" });
    await dbSet("pasta", pasta);
    mostrarPasta();
    return true;
  } catch (e) {
    if (e.name !== "AbortError") avisar("Não consegui escolher a pasta: " + e.message, "erro");
    return false;
  }
}

// Precisa rodar dentro de um clique: requestPermission exige gesto do usuário.
async function garantirPermissao() {
  const opts = { mode: "readwrite" };
  if ((await pasta.queryPermission(opts)) === "granted") return true;
  return (await pasta.requestPermission(opts)) === "granted";
}

/* ---- Nome e conteúdo do arquivo ---- */
const pad = (n) => String(n).padStart(2, "0");

// Remove caracteres inválidos no Windows e limita o tamanho.
function limpar(texto) {
  return texto
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/[. ]+$/, "");
}

function nomeBase(d, tit) {
  const limpo = limpar(tit);
  const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${data} ${pad(d.getHours())}-${pad(d.getMinutes())}${limpo ? " " + limpo : ""}`;
}

// Se já existir, vira "nome (2).txt", "nome (3).txt"...
async function nomeLivre(dir, base) {
  for (let i = 1; ; i++) {
    const nome = i === 1 ? `${base}.txt` : `${base} (${i}).txt`;
    try {
      await dir.getFileHandle(nome);
    } catch (e) {
      if (e.name === "NotFoundError") return nome;
      throw e;
    }
  }
}

function montarConteudo(d, tit, texto) {
  const data = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return [
    `Título: ${tit.trim() || "(sem título)"}`,
    `Data: ${data}`,
    "-".repeat(30),
    "",
    texto.replace(/\r?\n/g, "\r\n"),
    "",
  ].join("\r\n");
}

/* ---- Salvar (só acontece quando você clica) ---- */
async function salvarNota() {
  const texto = corpo.value.trim();
  if (!texto) {
    avisar("Escreva algo primeiro.", "erro");
    return;
  }
  btnSalvar.disabled = true;
  try {
    if (!pasta && !(await escolherPasta())) return;
    if (!(await garantirPermissao())) {
      avisar("Sem permissão para gravar na pasta.", "erro");
      return;
    }
    const agora = new Date();
    const nome = await nomeLivre(pasta, nomeBase(agora, titulo.value));
    const arquivo = await pasta.getFileHandle(nome, { create: true });
    const w = await arquivo.createWritable();
    await w.write(montarConteudo(agora, titulo.value, texto));
    await w.close();
    titulo.value = "";
    corpo.value = "";
    await chrome.storage.local.remove("rascunho");
    avisar(`Salva: ${nome}`, "ok");
  } catch (e) {
    avisar(`Erro ao salvar: ${e.message}. Se a pasta mudou de lugar, clique em 📁 e escolha de novo.`, "erro");
  } finally {
    btnSalvar.disabled = false;
    corpo.focus();
  }
}

/* ---- Rascunho: fica no chrome.storage.local até você salvar ---- */
function guardarRascunho() {
  chrome.storage.local.set({ rascunho: { titulo: titulo.value, corpo: corpo.value } });
}

// Textos enviados pelo menu de botão direito / atalho chegam em "pendente".
// Só este painel escreve em "rascunho", o que evita sobrescritas concorrentes.
async function consumirPendentes() {
  const { pendente = [] } = await chrome.storage.local.get("pendente");
  if (!pendente.length) return;
  // lean-ctx: um envio feito entre o get e o remove se perde; aceitável para uso manual
  await chrome.storage.local.remove("pendente");
  const atual = corpo.value.replace(/\s+$/, "");
  corpo.value = [atual, ...pendente].filter(Boolean).join("\n\n");
  corpo.scrollTop = corpo.scrollHeight;
  guardarRascunho();
}

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "local" && mudancas.pendente?.newValue?.length) consumirPendentes();
});

/* ---- Eventos da interface ---- */
titulo.addEventListener("input", guardarRascunho);
corpo.addEventListener("input", guardarRascunho);

titulo.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    corpo.focus();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") salvarNota();
});

$("salvar").addEventListener("click", salvarNota);
$("pasta").addEventListener("click", escolherPasta);

$("colar").addEventListener("click", async () => {
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto) {
      avisar("A área de transferência está vazia.", "erro");
      return;
    }
    corpo.focus();
    corpo.setRangeText(texto, corpo.selectionStart, corpo.selectionEnd, "end");
    guardarRascunho();
    avisar("");
  } catch {
    avisar("Não consegui ler a área de transferência.", "erro");
  }
});

$("descartar").addEventListener("click", async () => {
  if (!titulo.value && !corpo.value) return;
  if (!confirm("Descartar esta nota sem salvar?")) return;
  titulo.value = "";
  corpo.value = "";
  await chrome.storage.local.remove("rascunho");
  avisar("");
});

/* ---- Início ---- */
(async () => {
  const { rascunho } = await chrome.storage.local.get("rascunho");
  if (rascunho) {
    titulo.value = rascunho.titulo ?? "";
    corpo.value = rascunho.corpo ?? "";
  }
  await consumirPendentes();
  try {
    pasta = (await dbGet("pasta")) ?? null;
  } catch {
    pasta = null;
  }
  mostrarPasta();
  corpo.focus();
})();
