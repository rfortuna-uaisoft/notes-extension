const MENU_ID = "enviar-selecao";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Enviar seleção para a Nota Rápida",
      contexts: ["selection"],
    });
  });
});

// O painel lê "pendente" ao abrir e quando o valor muda.
async function enviarParaNota(texto) {
  texto = (texto || "").trim();
  if (!texto) return;
  const { pendente = [] } = await chrome.storage.local.get("pendente");
  pendente.push(texto);
  await chrome.storage.local.set({ pendente });
}

// sidePanel.open() só funciona dentro de um gesto do usuário:
// por isso é chamado primeiro, antes de qualquer await.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  const abrir = chrome.sidePanel.open({ windowId: tab.windowId });
  enviarParaNota(info.selectionText).finally(() => abrir.catch(() => {}));
});

chrome.commands.onCommand.addListener(async (comando, tab) => {
  if (!tab) return;
  const abrir = chrome.sidePanel.open({ windowId: tab.windowId });
  if (comando === "enviar-selecao") {
    try {
      const resultados = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => getSelection().toString(),
      });
      await enviarParaNota(resultados.map((r) => r.result).find(Boolean));
    } catch {
      // páginas restritas (chrome://, Web Store) não permitem ler a seleção
    }
  }
  await abrir.catch(() => {});
});
