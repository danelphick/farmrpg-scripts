// ==UserScript==
// @name         Copy Masteries
// @version      2.1
// @description  Captures masteries/inventory and the farm's building stats from FarmRPG and offers to push them into the farm solver's settings. Copy-to-clipboard buttons remain as a fallback.
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
  //
  // A kind owns both halves of one capture: the keys it is stored under, and --
  // on the solver page -- what the stored text becomes (prepare), whether that
  // is anything the page doesn't already hold (differs), and how to put it there
  // (apply).

  // The two pasted-text captures differ only in what they abridge to and which
  // of the solver's boxes they land in.
  function textKind(kind) {
    return {
      ...kind,
      differs(text) {
        const box = document.getElementById(kind.textareaId);
        return !!box && box.value !== text;
      },
      apply(text) {
        const box = document.getElementById(kind.textareaId);
        if (box) box.value = text;
      },
    };
  }

  const MASTERY = textKind({
    label: "Mastery",
    textKey: "masteryText",
    timeKey: "masteryCapturedAt",
    dismissedKey: "dismissedMasteryAt",
    textareaId: "mastery-text",
    prepare: (text) => abridgeMastery(text),
  });
  const INVENTORY = textKind({
    label: "Inventory",
    textKey: "inventoryText",
    timeKey: "inventoryCapturedAt",
    dismissedKey: "dismissedInventoryAt",
    textareaId: "inventory-text",
    prepare: (text) => abridgeInventory(text),
  });
  // The farm page's building stats go into the solver's own settings controls
  // rather than a paste box, so this one is stored as the {config key: value}
  // object those controls take, as JSON.
  const FARM = {
    label: "Farm",
    textKey: "farmText",
    timeKey: "farmCapturedAt",
    dismissedKey: "dismissedFarmAt",
    prepare: (text) => text,
    differs: (text) => farmChanges(text).length > 0,
    apply(text) {
      for (const [input, value] of farmChanges(text)) {
        if (typeof value === "boolean") input.checked = value;
        else input.value = String(value);
      }
    },
  };

  const KINDS = [MASTERY, INVENTORY, FARM];

  const STORAGE_KEYS = KINDS.flatMap((kind) => [
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

  // --- FarmRPG: the farm page's building stats -------------------------------

  // Every building on the farm page the solver has settings for: the page its
  // row links to (the row's identity -- a title carries decoration, an href
  // doesn't), and which of the figures stacked in the row's right-hand column
  // feed which solver setting.
  //
  // A figure is keyed by the whole label following its number, because a label's
  // first word need not be unique: the Quarry lists both "8,000 Stone", its
  // ten-minute output and what the solver wants, and "48,000 Stone Hourly".
  const FARM_BUILDINGS = [
    { page: "coop.php", stats: { eggs: { key: "chicken_coop.produces" } } },
    { page: "pasture.php", stats: { milk: { key: "cow_pasture.milk" } } },
    { page: "storehouse.php", stats: { inventory: { key: "storehouse.growth" } } },
    // The farmhouse's daily stamina gain is the Mattress Pad perk read off the
    // page: 1 without it, 2 with.
    { page: "farmhouse.php", stats: {
      stamina: { key: "farmhouse.have_mattress_pad", value: (n) => n >= 2 },
    } },
    { page: "pen.php", stats: { antlers: { key: "raptor_pen.antlers" } } },
    { page: "hab.php", stats: {
      worms: { key: "worm_habitat.worms" },
      gummies: { key: "worm_habitat.gummy_worms" },
      mealworms: { key: "worm_habitat.mealworms" },
    } },
    { page: "orchard.php", stats: {
      apples: { key: "orchard.apple_trees" },
      oranges: { key: "orchard.orange_trees" },
      lemons: { key: "orchard.lemon_trees" },
    } },
    { page: "troutfarm.php", stats: {
      trout: { key: "trout_bait_farm.trout" },
      grubs: { key: "trout_bait_farm.grubs" },
      minnows: { key: "trout_bait_farm.minnows" },
    } },
    { page: "vineyard.php", stats: { grapes: { key: "vineyard.grapes" } } },
    { page: "sawmill.php", stats: {
      boards: { key: "sawmill.board" },
      wood: { key: "sawmill.wood" },
      oak: { key: "sawmill.oak" },
    } },
    { page: "steelworks.php", stats: { steel: { key: "steelworks.steel" } } },
    { page: "hayfield.php", stats: { straw: { key: "hay_field.hay" } } },
    { page: "quarry.php", stats: {
      stone: { key: "quarry.stone" },
      "coal hourly": { key: "quarry.coal" },
    } },
  ];

  // "18,524 Eggs", "8,000 Coal Hourly": a figure and the label it is listed
  // under.
  const FARM_STAT_LINE = /^([\d,]+)\s+(\S.*)$/;

  // The right-hand column stacks its figures with <br>, so the line breaks --
  // not just the text -- are what separates one from the next.
  function readLines(el) {
    const lines = [];
    let line = "";
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) line += child.textContent;
        else if (child.nodeName === "BR") {
          lines.push(line);
          line = "";
        } else walk(child);
      }
    })(el);
    lines.push(line);
    return lines.map((text) => text.trim()).filter(Boolean);
  }

  // "Around Your Farm" is the card holding one row per building. It is looked
  // for in the page the main view is currently showing: FarmRPG keeps the page
  // being navigated away from in the DOM for the transition, and a farm page on
  // its way out is not the one to read.
  function findFarmBuildings() {
    const page = document.querySelector(".view-main .page-on-center") || document;
    for (const title of page.querySelectorAll(".content-block-title")) {
      if (title.textContent.trim().startsWith("Around Your Farm")) {
        return title.nextElementSibling;
      }
    }
    return null;
  }

  // The card's rows, by the page each links to. The link's pathname is what is
  // matched on rather than its href: the href may be absolute or relative
  // depending on how the page was served, and one page's name can contain
  // another's ("pen.php" sits inside "pigpen.php").
  function farmRowsByPage(buildings) {
    const rows = new Map();
    for (const link of buildings.querySelectorAll("a[href]")) {
      const page = link.pathname.split("/").pop();
      if (!rows.has(page)) rows.set(page, link);
    }
    return rows;
  }

  function readFarmStats() {
    const buildings = findFarmBuildings();
    if (!buildings) return null;

    const rows = farmRowsByPage(buildings);
    const captured = {};
    for (const building of FARM_BUILDINGS) {
      // A farm need not have every building, and the ones it lacks are simply
      // absent from the card.
      const row = rows.get(building.page)?.querySelector(".item-after");
      if (!row) continue;
      for (const line of readLines(row)) {
        const match = FARM_STAT_LINE.exec(line);
        const stat = match && building.stats[match[2].toLowerCase()];
        if (!stat) continue;
        const number = Number(match[1].replace(/,/g, ""));
        captured[stat.key] = stat.value ? stat.value(number) : number;
      }
    }
    // Key order follows FARM_BUILDINGS, so an unchanged farm serialises to the
    // same text every visit and storeCapture keeps quiet.
    return Object.keys(captured).length ? JSON.stringify(captured) : null;
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

    // The farm page has no paste box in the solver to fall back to, so there is
    // no copy button to go with it -- only the capture.
    const farmBuildings = findFarmBuildings();
    if (farmBuildings && storageReady) storeCapture(FARM, readFarmStats());

    return !!(masteryTitle || inventoryBlock || farmBuildings);
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

  const PROGRESS_LINE = /^[\d,]+\s*\/\s*([\d,]+|∞)\s+Progress$/;
  // A quantity is a line of nothing but digits and thousands separators --
  // never a description ("+10% Exploring XP...") or a status line.
  const QUANTITY_LINE = /^[\d,]+$/;

  // Both boxes want the same shape: every block cut down to its item name and
  // the single line the solver's parser actually reads. Blocks holding no such
  // line -- the page's header, the standalone category markers -- have nothing
  // to say and are dropped whole. Only the paste is abridged; the copy buttons
  // still put the page's own text on the clipboard.
  function abridgeBlocks(text, pickLine) {
    const kept = [];
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split("\n").filter((line) => line.trim());
      const wanted = pickLine(lines);
      // lines[0] being the wanted line means the block has lost its name, so
      // there is nothing worth keeping.
      if (wanted && lines[0] !== wanted) kept.push(`${lines[0]}\n${wanted}`);
    }
    return kept.length ? `${kept.join("\n\n")}\n` : "";
  }

  // Mastery: name plus "<n> / <n> Progress", dropping the percentage,
  // Track/Stop and tier-header lines.
  function abridgeMastery(text) {
    return abridgeBlocks(text, (lines) =>
      lines.find((line) => PROGRESS_LINE.test(line.trim())),
    );
  }

  // Inventory: name plus the quantity, dropping the description and mastery
  // status. The quantity ends the block except where a category marker trails
  // it, so it is looked for from the end.
  function abridgeInventory(text) {
    return abridgeBlocks(text, (lines) =>
      lines.findLast((line) => QUANTITY_LINE.test(line.trim())),
    );
  }

  // Which settings controls the captured farm stats would actually change. The
  // solver generates one control per config key (data-config-key), so a stat
  // whose control isn't on the page -- an older solver, a setting it has since
  // renamed -- is left alone rather than guessed at.
  function farmChanges(text) {
    let stats;
    try {
      stats = JSON.parse(text);
    } catch (err) {
      return [];
    }
    const changes = [];
    for (const [key, value] of Object.entries(stats)) {
      const input = document.querySelector(`[data-config-key="${key}"]`);
      if (!input) continue;
      if (typeof value === "boolean") {
        if (input.checked !== value) changes.push([input, value]);
      } else if (input.value !== String(value)) {
        changes.push([input, value]);
      }
    }
    return changes;
  }

  // A capture is worth offering only if it differs from what the page already
  // holds and isn't one the user has already said no to. The comparison is
  // against the value that would actually be applied, so an abridged paste
  // doesn't leave the banner claiming the page is out of date forever.
  function pendingCapture(kind) {
    const stored = readStored(kind.textKey, "");
    if (!stored) return null;
    const value = kind.prepare(stored);
    if (!value || !kind.differs(value)) return null;
    const capturedAt = readStored(kind.timeKey, 0);
    if (capturedAt && capturedAt === readStored(kind.dismissedKey, 0)) return null;
    return { kind, value, capturedAt };
  }

  function markDismissed(pending) {
    for (const item of pending) writeStored(item.kind.dismissedKey, item.capturedAt);
  }

  // Order matters: opening the popover is what snapshots the values Cancel
  // would revert to, so it has to happen before the controls are filled, and
  // the button toggles, so it must not be clicked when already open. A
  // synthetic click fires no pointerdown, so the page's outside-click handler
  // can't close the panel between these steps.
  function applyPending(pending) {
    const popover = document.getElementById("settings-popover");
    const settingsButton = document.getElementById("settings-btn");
    if (!popover || !settingsButton) return;
    if (popover.hidden) settingsButton.click();

    for (const item of pending) item.kind.apply(item.value);

    // New masteries are worth a dated snapshot, which the page keeps as history
    // rather than as a setting: it reads the box directly and is not undone by
    // Cancel, so it goes after the fill and can go before Save.
    if (pending.some((item) => item.kind === MASTERY)) {
      document.getElementById("save-snapshot")?.click();
    }

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
    const pending = KINDS.map(pendingCapture).filter(Boolean);
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

    // The settings controls a farm capture lands in are generated by the
    // solver's own startup rather than served in the page, so they may not be
    // there yet: re-check until they are, rather than leaving a waiting capture
    // unnoticed until the tab is next focused.
    let attempts = 0;
    const waitForControls = setInterval(() => {
      if (document.querySelector("[data-config-key]") || ++attempts >= 20) {
        clearInterval(waitForControls);
        refreshBanner();
      }
    }, 250);

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
      for (const kind of KINDS) {
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
