// ==UserScript==
// @name         Copy Masteries
// @version      3.0
// @description  Adds Copy Mastery Data and Copy Inventory Data buttons to FarmRPG, each putting that part of the page on the clipboard verbatim -- the same text selecting it and pressing Ctrl+C would give. The Populate Solver script instead reads the same two pages for the farm solver, abridged to what its parsers want.
// @author       danelphick@
// @match        https://*.farmrpg.com/index.php
// @match        https://*.farmrpg.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_setClipboard
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  /* globals jQuery, $, navigation, GM_setClipboard */
  "use strict";

  // --- Reading the page ------------------------------------------------------

  // What each button copies is the page's own text, exactly as selecting that
  // stretch by hand and pressing Ctrl+C would give it: every line the page is
  // showing, in the order it shows them, nothing dropped and nothing reshaped.
  // (What the farm solver wants is a good deal less than that, and abridging
  // for it is the Populate Solver script's business, not these buttons'.)
  //
  // So the page's real selection is what reads it: Selection.toString() is what
  // gives the block-level newlines -- Range.toString() runs the text nodes
  // together -- and it honours what is on the page, so a collapsed tier or
  // category is left out here just as it would be from a hand-made selection.
  // Whatever the user had selected is put back afterwards.
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

  // The title down to the end of the block it heads: the tiers still in
  // progress, and the Mega Mastered list below them. What sits above it (Ready
  // to Claim) stays out.
  function readMasteryText() {
    const masteryTitle = findMasteryTitle();
    if (!masteryTitle) return null;
    return readSelectionText(masteryTitle, masteryTitle.parentElement.lastElementChild);
  }

  function findInventoryBlock() {
    return $(".list-block-search.contacts-block")[0] || null;
  }

  // The item list down to the Inventory Stats card sharing its block, which is
  // where the items themselves stop.
  function readInventoryText() {
    const selectionDiv = findInventoryBlock();
    if (!selectionDiv) return null;
    const inventoryStats = $(selectionDiv).find(".content-block-title")[0];
    if (!inventoryStats) return null;
    return readSelectionText(selectionDiv, inventoryStats);
  }

  // --- The copy buttons ------------------------------------------------------

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

  // --- The page scan ---------------------------------------------------------

  // FarmRPG is a SPA, so a page shown by a navigation may still be rendering:
  // poll for the markers rather than guessing at a single delay. Only the
  // latest navigation's poll runs -- quick navigation shouldn't leave earlier
  // ones reading the page behind it.
  let scanTimer = null;

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

  $(document).ready(() => {
    console.log("Copy Masteries ready on FarmRPG.");
    navigation.addEventListener("currententrychange", scanSoon);
    scanSoon();
  });
})();
