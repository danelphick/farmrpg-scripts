// ==UserScript==
// @name         Copy Masteries
// @version      2.0
// @description  Captures masteries/inventory from the FarmRPG Mastery/Inventory pages and offers to push them into the farm solver's settings. Copy-to-clipboard buttons remain as a fallback.
// @author       danelphick@
// @match        https://*.farmrpg.com/index.php
// @match        https://*.farmrpg.com/
// @match        http://localhost:8000/*
// @match        http://127.0.0.1:8000/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_setClipboard
// @grant        GM_addValueChangeListener
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  /* globals jQuery, $, navigation, GM, GM_getValue, GM_setValue, GM_setClipboard,
     GM_addValueChangeListener */
  "use strict";

  // Shared script storage is the bridge between the two domains this script
  // matches: FarmRPG writes, the solver page reads.
  const MASTERY = {
    label: "Mastery",
    textKey: "masteryText",
    timeKey: "masteryCapturedAt",
    dismissedKey: "dismissedMasteryAt",
    textareaId: "mastery-text",
  };
  const INVENTORY = {
    label: "Inventory",
    textKey: "inventoryText",
    timeKey: "inventoryCapturedAt",
    dismissedKey: "dismissedInventoryAt",
    textareaId: "inventory-text",
  };

  const STORAGE_KEYS = [MASTERY, INVENTORY].flatMap((kind) => [
    kind.textKey,
    kind.timeKey,
    kind.dismissedKey,
  ]);

  // Every stored value is read into a cache so the rest of the script can work
  // synchronously whichever API the script manager gave us: Tampermonkey's
  // synchronous GM_getValue, or the promise-based GM.getValue (Greasemonkey 4,
  // Violentmonkey). The solver page re-reads it whenever the FarmRPG tab may
  // have written something (see watchForCaptures).
  const cache = {};
  let writeValue = null;
  let refreshCache = null;

  // Almost always means the script manager is still running the previously
  // installed metadata block, so the new @grant lines were never applied.
  const STORAGE_MISSING =
    "Copy Masteries: no GM storage API available, so nothing can be handed to " +
    "the solver -- use the copy buttons instead. Re-save or reinstall the script " +
    "so its @grant lines take effect (Tampermonkey lists the granted APIs under " +
    "the script's Settings tab).";

  async function loadStorage() {
    if (typeof GM_getValue === "function" && typeof GM_setValue === "function") {
      refreshCache = () => {
        for (const key of STORAGE_KEYS) cache[key] = GM_getValue(key);
      };
      writeValue = GM_setValue;
    } else if (typeof GM === "object" && GM && typeof GM.getValue === "function") {
      refreshCache = () =>
        Promise.all(
          STORAGE_KEYS.map(async (key) => {
            cache[key] = await GM.getValue(key);
          }),
        );
      writeValue = (key, value) => GM.setValue(key, value);
    } else {
      console.error(STORAGE_MISSING);
      return false;
    }

    await refreshCache();
    return true;
  }

  function readStored(key, fallback) {
    return cache[key] === undefined ? fallback : cache[key];
  }

  function writeStored(key, value) {
    cache[key] = value;
    writeValue(key, value);
  }

  function describeAge(timestamp) {
    if (!timestamp) return "unknown age";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  // --- FarmRPG: capture ------------------------------------------------------

  // Selection.toString() is what gives the block-level newlines the solver's
  // parsers rely on (Range.toString() runs the text nodes together), so the
  // page's real selection has to be used -- and then put back, since this now
  // runs on its own rather than from a button the user clicked.
  function readSelectionText(startNode, endNode) {
    const selection = document.getSelection();
    const saved = [];
    for (let i = 0; i < selection.rangeCount; i++) saved.push(selection.getRangeAt(i));

    selection.setBaseAndExtent(startNode, 0, endNode, 0);
    const text = selection.toString();

    selection.removeAllRanges();
    for (const range of saved) selection.addRange(range);
    return text;
  }

  function findMasteryTitle() {
    for (const x of $(".content-block-title")) {
      if (x.textContent.startsWith("Mastery In-Progress")) return x;
    }
    return null;
  }

  function readMasteryText() {
    const masteryTitle = findMasteryTitle();
    if (!masteryTitle) return null;
    return readSelectionText(masteryTitle, masteryTitle.parentElement.lastElementChild);
  }

  function findInventoryBlock() {
    return $(".list-block-search.contacts-block")[0] || null;
  }

  function readInventoryText() {
    const selectionDiv = findInventoryBlock();
    if (!selectionDiv) return null;
    const inventoryStats = $(selectionDiv).find(".content-block-title")[0];
    if (!inventoryStats) return null;
    return readSelectionText(selectionDiv, inventoryStats);
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText =
      "position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);" +
      "background: #222; color: #fff; padding: 8px 14px; border-radius: 4px;" +
      "font: 14px sans-serif; z-index: 20000; opacity: 1; transition: opacity 0.5s;";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 2000);
  }

  // Storing only on a real change keeps the capture timestamp -- and so a
  // banner the user already dismissed on the solver page -- stable across
  // re-visits of an unchanged page.
  function storeCapture(kind, text) {
    if (!text || !text.trim()) return;
    if (readStored(kind.textKey, "") === text) return;
    writeStored(kind.textKey, text);
    writeStored(kind.timeKey, Date.now());
    console.log(`${kind.label} data captured.`);
    showToast(`${kind.label} data captured`);
  }

  // --- FarmRPG: the copy buttons ---------------------------------------------

  // Kept as the fallback for when the handoff to the solver isn't working
  // (no GM storage, or the solver page never picks the capture up): they still
  // put the same text on the clipboard to paste by hand.
  function addButton(appendDiv, id, text, onclick, cssObj) {
    // Check if button already exists and abort.
    if ($("#" + id).length > 0 || !appendDiv) return;

    const button = document.createElement("button");
    appendDiv.appendChild(button);
    button.id = id;
    button.innerHTML = text;
    button.onclick = onclick;
    button.style = cssObj;
    return button;
  }

  function copyToClipboard(label, text) {
    if (!text) return;
    if (typeof GM_setClipboard !== "function") {
      console.error("Copy Masteries: GM_setClipboard is not granted.");
      return;
    }
    GM_setClipboard(text, "text", () => console.log(`${label} copied.`));
    showToast(`${label} copied to clipboard`);
  }

  function findBlockAboveInventory() {
    const inventoryList = $("[data-page=inventory].page .page-content .list-block")[0];
    return inventoryList?.previousElementSibling.children[0];
  }

  // --- FarmRPG: the page scan ------------------------------------------------

  // FarmRPG is a SPA, so a page shown by a navigation may still be rendering:
  // poll for the markers rather than guessing at a single delay. Only the
  // latest navigation's poll runs -- quick navigation shouldn't leave earlier
  // ones reading the page behind it.
  let scanTimer = null;
  let storageReady = false;

  // The buttons go on before the text is read, so an automatic capture and a
  // button copy produce byte-identical text (the mastery button sits inside the
  // copied header line, which the solver's parser skips either way).
  function scanPage() {
    const masteryTitle = findMasteryTitle();
    if (masteryTitle) {
      addButton(
        masteryTitle,
        "copyMasteryButton",
        "Copy Mastery Data",
        () => copyToClipboard("Mastery", readMasteryText()),
        "float: right; margin-right: 0px; position: relative; z-index: 3",
      );
      if (storageReady) storeCapture(MASTERY, readMasteryText());
    }

    const inventoryBlock = findInventoryBlock();
    if (inventoryBlock) {
      addButton(
        findBlockAboveInventory(),
        "copyInventoryButton",
        "Copy Inventory Data",
        () => copyToClipboard("Inventory", readInventoryText()),
        "position: absolute; top: 70%; right: 10px; z-index: 3;",
      );
      if (storageReady) storeCapture(INVENTORY, readInventoryText());
    }

    return !!(masteryTitle || inventoryBlock);
  }

  function scanSoon() {
    let attempts = 0;
    clearInterval(scanTimer);
    scanTimer = setInterval(() => {
      if (scanPage() || ++attempts >= 10) clearInterval(scanTimer);
    }, 250);
  }

  function initFarmRpg(hasStorage) {
    storageReady = hasStorage;
    console.log(
      `Copy Masteries ready on FarmRPG (auto-capture ${hasStorage ? "on" : "OFF"}).`,
    );
    navigation.addEventListener("currententrychange", scanSoon);
    scanSoon();
  }

  // --- Solver: apply ---------------------------------------------------------

  // A capture is worth offering only if it differs from what the page already
  // holds and isn't one the user has already said no to.
  function pendingCapture(kind) {
    const text = readStored(kind.textKey, "");
    if (!text) return null;
    const textarea = document.getElementById(kind.textareaId);
    if (!textarea || textarea.value === text) return null;
    const capturedAt = readStored(kind.timeKey, 0);
    if (capturedAt && capturedAt === readStored(kind.dismissedKey, 0)) return null;
    return { kind, text, textarea, capturedAt };
  }

  function markDismissed(pending) {
    for (const item of pending) writeStored(item.kind.dismissedKey, item.capturedAt);
  }

  // Order matters: opening the popover is what snapshots the values Cancel
  // would revert to, so it has to happen before the textareas are filled, and
  // the button toggles, so it must not be clicked when already open. A
  // synthetic click fires no pointerdown, so the page's outside-click handler
  // can't close the panel between these steps.
  function applyPending(pending) {
    const popover = document.getElementById("settings-popover");
    const settingsButton = document.getElementById("settings-btn");
    if (!popover || !settingsButton) return;
    if (popover.hidden) settingsButton.click();

    for (const item of pending) item.textarea.value = item.text;

    document.getElementById("settings-save").click();
    markDismissed(pending);
  }

  function showBanner(pending) {
    const banner = document.createElement("div");
    // Stops short of the right edge so it never covers the page's own fixed
    // settings cog (top: 1rem; right: 1rem), which Update needs to click.
    banner.style.cssText =
      "position: fixed; top: 0; left: 0; right: 4.5rem; z-index: 20000;" +
      "display: flex; align-items: center; justify-content: center; gap: 12px;" +
      "padding: 8px 12px; background: #2d5c2d; color: #fff;" +
      "font: 14px sans-serif; border-radius: 0 0 6px 0;" +
      "box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);";

    const message = document.createElement("span");
    const ages = pending
      .map((item) => `${item.kind.label.toLowerCase()} ${describeAge(item.capturedAt)}`)
      .join(" · ");
    message.textContent = `New FarmRPG data available — ${ages}`;
    banner.appendChild(message);

    function addButton(text, primary, onclick) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.style.cssText =
        "padding: 4px 12px; border-radius: 4px; cursor: pointer; font: inherit;" +
        (primary
          ? "border: none; background: #fff; color: #2d5c2d; font-weight: bold;"
          : "border: 1px solid rgba(255, 255, 255, 0.6); background: transparent; color: #fff;");
      button.onclick = onclick;
      banner.appendChild(button);
    }

    addButton("Update", true, () => {
      applyPending(pending);
      removeBanner();
    });
    addButton("Dismiss", false, () => {
      markDismissed(pending);
      removeBanner();
    });

    document.body.appendChild(banner);
    return banner;
  }

  // What the banner on screen is offering, so a re-check that finds the same
  // captures leaves it (and a click halfway through it) alone.
  let bannerEl = null;
  let bannerShowing = "";

  function removeBanner() {
    if (bannerEl) bannerEl.remove();
    bannerEl = null;
    bannerShowing = "";
  }

  async function refreshBanner() {
    await refreshCache();
    const pending = [pendingCapture(MASTERY), pendingCapture(INVENTORY)].filter(Boolean);
    const showing = pending.map((item) => `${item.kind.textKey}@${item.capturedAt}`).join("|");
    if (showing === bannerShowing) return;

    removeBanner();
    if (pending.length) {
      bannerEl = showBanner(pending);
      bannerShowing = showing;
    }
  }

  function initSolver() {
    refreshBanner();

    // A capture made while this tab sat in the background should be waiting
    // when you come back to it, without a reload.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshBanner();
    });
    window.addEventListener("focus", refreshBanner);

    // Better still where the manager supports it: the FarmRPG tab's write
    // reaches this tab as it happens, so the banner appears while you're
    // looking at it. Both keys are watched because storeCapture writes the text
    // first and the timestamp second -- the timestamp write is the one that
    // makes a capture complete.
    if (typeof GM_addValueChangeListener === "function") {
      for (const kind of [MASTERY, INVENTORY]) {
        for (const key of [kind.textKey, kind.timeKey]) {
          GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => {
            if (remote) refreshBanner();
          });
        }
      }
    }
  }

  $(document).ready(async () => {
    const hasStorage = await loadStorage();
    // FarmRPG still gets the copy buttons without storage -- that fallback is
    // exactly what's needed when the handoff is broken. The solver side has
    // nothing to offer without it.
    if (location.hostname.endsWith("farmrpg.com")) initFarmRpg(hasStorage);
    else if (hasStorage) initSolver();
  });
})();
