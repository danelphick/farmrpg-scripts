// ==UserScript==
// @name         Populate Solver
// @version      1.0
// @description  Captures masteries/inventory and the farm's building stats from FarmRPG and offers to push them into the farm solver's settings. The Copy Masteries script offers the same two text captures as clipboard buttons instead.
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
// @grant        GM_addValueChangeListener
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  /* globals jQuery, $, navigation, GM, GM_getValue, GM_setValue,
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
    // readMasteryText already builds the abridged shape, item by item.
    prepare: (text) => text,
  });
  const INVENTORY = textKind({
    label: "Inventory",
    textKey: "inventoryText",
    timeKey: "inventoryCapturedAt",
    dismissedKey: "dismissedInventoryAt",
    textareaId: "inventory-text",
    // readInventoryText already builds the abridged shape, item by item.
    prepare: (text) => text,
  });
  // The farm's stats go into the solver's own settings controls rather than a
  // paste box, so this one is stored as the {config key: value} object those
  // controls take, as JSON. Several FarmRPG pages contribute to it -- see
  // storeFarmStats, which merges rather than replaces.
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
        else input.value = value;
        // The solver asks to be written to the way a user would: set the value,
        // then let the page see it change. Nothing captured here drives a
        // dependent control today, but a setting that gains one shouldn't
        // quietly stop working. (Edits inside the settings panel are staged, so
        // this stages them too -- Save is still what applies them.)
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
  };

  const KINDS = [MASTERY, INVENTORY, FARM];

  // Not a capture of its own: what the perk pages said the last time either was
  // visited, kept because a setting can span the two. See readPerkStats.
  const PERK_STATE_KEY = "perkState";

  const STORAGE_KEYS = [
    ...KINDS.flatMap((kind) => [kind.textKey, kind.timeKey, kind.dismissedKey]),
    PERK_STATE_KEY,
  ];

  // Every stored value is read into a cache so the rest of the script can work
  // synchronously whichever API the script manager gave us: Tampermonkey's
  // synchronous GM_getValue, or the promise-based GM.getValue (Greasemonkey 4,
  // Violentmonkey). The solver page re-reads it whenever the FarmRPG tab may
  // have written something (see refreshBanner).
  const cache = {};
  let writeValue = null;
  let refreshCache = null;

  // Almost always means the script manager is still running the previously
  // installed metadata block, so the new @grant lines were never applied.
  const STORAGE_MISSING =
    "Populate Solver: no GM storage API available, so nothing can be handed to " +
    "the solver -- the Copy Masteries script's buttons still copy the mastery " +
    "and inventory text to paste by hand. Re-save or reinstall the script so " +
    "its @grant lines take effect (Tampermonkey lists the granted APIs under " +
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

  // The mastery and inventory captures are abridged to what the solver's
  // parsers actually read, which is a good deal less than the page shows: the
  // percentage/Track/Stop lines, item descriptions, mastery statuses, tier
  // headers and category markers all go. (Mastery drops 25k to 19k and
  // inventory 66k to 23k on a full farm, and both parse to exactly the same
  // masteries and quantities as the full text.) The Copy Masteries script's
  // buttons are the ones that copy the page verbatim.

  // The one line the solver's mastery parser reads, beneath the item's name.
  const PROGRESS_LINE = /^[\d,]+\s*\/\s*([\d,]+|∞)\s+Progress$/;
  // ...and the inventory parser's: a quantity is nothing but digits and
  // thousands separators, never a description ("+10% Exploring XP...") or a
  // status line.
  const QUANTITY_LINE = /^[\d,]+$/;

  function findMasteryTitle() {
    for (const x of $(".content-block-title")) {
      if (x.textContent.startsWith("Mastery In-Progress")) return x;
    }
    return null;
  }

  // Item name and progress for everything the mastery title heads: the tiers
  // still in progress, and the Mega Mastered list below them.
  //
  // Read out of the DOM rather than off the page as text, because the tier
  // headings collapse. A collapsed tier is still in the DOM but not on the
  // page, so selecting the page would silently drop every item inside it --
  // and a capture missing a tier reads to the solver as mastery not yet earned.
  function readMasteryText() {
    const masteryTitle = findMasteryTitle();
    if (!masteryTitle) return null;
    const blocks = [];
    // Everything after the title to the end of the block it heads, the reach
    // the selection had: what sits above it (Ready to Claim) stays left out.
    for (let el = masteryTitle.nextElementSibling; el; el = el.nextElementSibling) {
      for (const item of el.querySelectorAll(".item-title")) {
        const name = item.querySelector("strong")?.textContent.trim();
        // A tier heading has neither, and is skipped by having neither.
        const progress = [...item.querySelectorAll("span")]
          .map((span) => span.textContent.trim())
          .find((text) => PROGRESS_LINE.test(text));
        if (name && progress) blocks.push(`${name}\n${progress}`);
      }
    }
    return blocks.length ? `${blocks.join("\n\n")}\n` : "";
  }

  function findInventoryBlock() {
    return $(".list-block-search.contacts-block")[0] || null;
  }

  // Item name and quantity for everything the inventory lists, read out of the
  // DOM for the same reason the mastery is: the category headings collapse, and
  // a collapsed category is still in the DOM but not on the page, so selecting
  // the page silently dropped every item inside it -- and an item missing from
  // the capture reads to the solver as one you don't hold.
  //
  // The category headings and the Inventory Stats card sharing the block have
  // no item row of their own, so they are left out by having nothing to say.
  function readInventoryText() {
    const block = findInventoryBlock();
    if (!block) return null;
    const blocks = [];
    for (const item of block.querySelectorAll(".item-inner")) {
      const name = item.querySelector(".item-title strong")?.textContent.trim();
      const quantity = item.querySelector(".item-after")?.textContent.trim();
      if (name && quantity && QUANTITY_LINE.test(quantity)) {
        blocks.push(`${name}\n${quantity}`);
      }
    }
    return blocks.length ? `${blocks.join("\n\n")}\n` : "";
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

  // The page the main view is currently showing, if it is the named one.
  function currentPage(name) {
    return document.querySelector(`.view-main .page-on-center[data-page="${name}"]`);
  }

  // "Around Your Farm" is the card holding one list row per building.
  function findFarmBuildings(page) {
    for (const title of page.querySelectorAll(".content-block-title")) {
      if (title.textContent.trim().startsWith("Around Your Farm")) {
        return title.nextElementSibling;
      }
    }
    return null;
  }

  // The card's building links, by the page each points at. The link's pathname
  // is what is matched on rather than its href: the href may be absolute or
  // relative depending on how the page was served, and one page's name can
  // contain another's ("pen.php" sits inside "pigpen.php").
  function farmLinksByPage(buildings) {
    const links = new Map();
    for (const link of buildings.querySelectorAll("a[href]")) {
      const page = link.pathname.split("/").pop();
      if (!links.has(page)) links.set(page, link);
    }
    return links;
  }

  // The hidden field listing every plot as "<row><col>-<seed>-<seconds>". It is
  // the whole farm however the crops themselves are being shown, which the
  // condensed view collapses to one chip per crop.
  const PLOT_ID = /^(\d+)\d-/;

  function readFarmRows(page) {
    const status = page.querySelector("#farmstatus");
    if (!status) return null;
    // A row is four plots wide, so a plot's row is its id less the last digit.
    const rows = new Set();
    for (const plot of status.textContent.split(";")) {
      const match = PLOT_ID.exec(plot.trim());
      if (match) rows.add(match[1]);
    }
    return rows.size || null;
  }

  function readFarmStats() {
    // Read from the page the main view is currently showing: FarmRPG keeps the
    // page being navigated away from in the DOM for the transition, and a farm
    // page on its way out is not the one to read.
    const page = currentPage("xfarm");
    if (!page) return null;

    const captured = {};
    const rows = readFarmRows(page);
    if (rows) captured["farming.rows"] = rows;

    const buildings = findFarmBuildings(page);
    const links = buildings ? farmLinksByPage(buildings) : new Map();
    for (const building of FARM_BUILDINGS) {
      // A farm need not have every building, and the ones it lacks are simply
      // absent from the card.
      const row = links.get(building.page)?.querySelector(".item-after");
      if (!row) continue;
      for (const line of readLines(row)) {
        const match = FARM_STAT_LINE.exec(line);
        const stat = match && building.stats[match[2].toLowerCase()];
        if (!stat) continue;
        const number = Number(match[1].replace(/,/g, ""));
        captured[stat.key] = stat.value ? stat.value(number) : number;
      }
    }
    return Object.keys(captured).length ? captured : null;
  }

  // The storehouse's own page is the only place the current cap is stated, and
  // it is stated in prose rather than in a field of its own. (The daily growth
  // beside it is already read off the farm page's Storehouse row.)
  const MAX_INVENTORY_LINE = /Currently your MAX Inventory is\s+([\d,]+)/;

  function readStorehouseStats() {
    const page = currentPage("storehouse");
    if (!page) return null;
    for (const block of page.querySelectorAll(".card-content-inner")) {
      const match = MAX_INVENTORY_LINE.exec(block.textContent);
      if (match) {
        return {
          "storehouse.inventory": Number(match[1].replace(/,/g, "")),
          // What the page states is the cap as of now, so now is the date the
          // solver should project capacity forward from.
          "storehouse.updated_on": todayISO(),
        };
      }
    }
    return null;
  }

  // The <input type="date"> the solver puts this in wants YYYY-MM-DD, and wants
  // it in the player's own day -- toISOString would hand back UTC's.
  function todayISO() {
    const now = new Date();
    const pad = (part) => String(part).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // The farmhouse page's Rest Bonus paragraph, which states the stamina held
  // and the cap it is climbing towards. (The gain per rest beside them is the
  // Mattress Pad, already read off the farm page's Farmhouse row.)
  const CURRENT_STAMINA_LINE = /You have\s+([\d,]+)\s+current stamina/;
  const STAMINA_CAP_LINE = /your stamina cap is\s+([\d,]+)/;

  function readFarmhouseStats() {
    const page = currentPage("farmhouse");
    if (!page) return null;
    for (const block of page.querySelectorAll(".card-content-inner")) {
      const stamina = CURRENT_STAMINA_LINE.exec(block.textContent);
      const cap = STAMINA_CAP_LINE.exec(block.textContent);
      if (stamina && cap) {
        return {
          "farmhouse.current_stamina": Number(stamina[1].replace(/,/g, "")),
          "farmhouse.stamina_cap": Number(cap[1].replace(/,/g, "")),
          // Like the storehouse's cap, this one is stated as of now, and the
          // solver grows it daily from the date beside it -- left at an older
          // date, a freshly read cap would be grown all over again.
          "farmhouse.registered_on": todayISO(),
        };
      }
    }
    return null;
  }

  // --- FarmRPG: an exploring location ----------------------------------------

  // A location's Exploring Effectiveness card, which names the place and states
  // what exploring it currently costs you in the same breath.
  //
  // The name is taken from that sentence rather than from the id in the page's
  // query string, because the solver names its zones exactly as the page does --
  // so a zone it gains needs nothing here, and one it doesn't know simply finds
  // no control to write to.
  const LOCATION_NAME = /knowledgeable about the (.+?) and can help you explore/;
  const LOCATION_STAMINA = /You are currently using ([\d,]+) stamina/;

  function readLocationStats() {
    // location.php serves fishing spots too, but only an exploring location
    // states a stamina cost per continue, so only one of them matches.
    const page = currentPage("location");
    if (!page) return null;
    for (const block of page.querySelectorAll(".card-content-inner")) {
      // The name spans an element boundary in a sentence that is otherwise laid
      // out however the page pleases, so it is matched against one flat line.
      const text = block.textContent.replace(/\s+/g, " ");
      const name = LOCATION_NAME.exec(text);
      const stamina = LOCATION_STAMINA.exec(text);
      if (name && stamina) {
        return {
          [`exploring.effectiveness.${name[1]}`]:
            Number(stamina[1].replace(/,/g, "")),
        };
      }
    }
    return null;
  }

  // --- FarmRPG: the pets page ------------------------------------------------

  // What kind of pet each one is, by the id its link carries. The page itself
  // is no help: it shows the name the player gave the pet, and the solver knows
  // them by kind. (Id 24 is the game's Skunk, which the solver calls Critter.)
  const PET_KINDS = {
    1: "Cat", 2: "Dog", 3: "Squirrel", 4: "Owl", 5: "Swine", 6: "Snake",
    7: "Baboon", 8: "Hedgehog", 9: "Spider", 10: "Frog", 11: "Penguin",
    12: "Green Dragon", 13: "Red Dragon", 14: "Lemur", 15: "Bear",
    16: "Blue Dragon", 17: "Pet Rock", 18: "Capybara", 19: "Strange Onion",
    20: "Armadillo", 21: "Bird", 22: "Fox", 23: "Seal", 24: "Critter",
    25: "Polar Bear", 26: "Hummingbird", 27: "Shark", 28: "Wolf",
  };

  const PET_LEVEL = /^Level\s+(\d+)$/;

  // The card of pets you own. What sits below it -- Available Pets -- is one you
  // could buy rather than one you have, and has no level of yours to read.
  //
  // It is the whole of what you own, so a pet missing from it is one you don't
  // have rather than one this page didn't mention -- unlike a perk, whose two
  // pages each know only their own. That is what lets an absent pet be captured
  // as level 0 instead of being left alone.
  function findMyPets(page) {
    for (const title of page.querySelectorAll(".content-block-title")) {
      if (title.textContent.trim().startsWith("My Pets")) return title.nextElementSibling;
    }
    return null;
  }

  function readPetStats() {
    const page = currentPage("pets");
    if (!page) return null;
    const myPets = findMyPets(page);
    if (!myPets) return null;

    // Every pet starts at 0, the level of one you haven't unlocked, and the
    // card raises the ones you have. A pet sold or never bought otherwise keeps
    // whatever level it was last captured at.
    const captured = {};
    for (const kind of Object.values(PET_KINDS)) captured[`pets.${kind}`] = 0;

    let owned = 0;
    for (const link of myPets.querySelectorAll("a[href]")) {
      // Matched on the resolved pathname for the same reason the farm page's
      // building links are: an href may be absolute or relative depending on
      // how the page was served.
      if (link.pathname.split("/").pop() !== "pet.php") continue;
      const kind = PET_KINDS[new URLSearchParams(link.search).get("id")];
      if (!kind) continue;
      // The level sits under the pet's name in the cell they share, so it is
      // the last of that cell's lines rather than the first to match: a pet the
      // player has named "Level 9" must not be read as one.
      const level = readLines(link.parentElement)
        .map((line) => PET_LEVEL.exec(line))
        .findLast(Boolean);
      if (!level) continue;
      captured[`pets.${kind}`] = Number(level[1]);
      owned++;
    }
    // Zeroing the rest is only safe once the card has actually been read: the
    // page scan polls a page that may still be rendering, and an empty card
    // early on must not be taken for a farm with no pets.
    return owned ? captured : null;
  }

  // --- FarmRPG: the perk pages -----------------------------------------------

  // A setting that is one perk, held or not.
  function perkFlag(key, id) {
    return { key, perks: { [id]: 1 }, value: Boolean };
  }

  // What each setting is worth per perk it depends on: the setting is the sum
  // over the perks owned.
  //
  // The game's tiers are increments rather than running totals -- Forester
  // restarts at 5% for its third tier, and Wanderer's stated 4/7/9/13 add up to
  // the 4/11/20/33 the solver's own help describes -- so a ladder whose setting
  // is which rung you stand on counts 1 a tier, and perkFlag counts 1 and turns
  // the total into a flag.
  //
  // Both pages are drawn on, and neither lists the other's perks: the crop
  // growth rate and the orchard bonus are each split across the two, and
  // Resource Saver's three tiers are spread over all of perks.php, supply.php's
  // crafting upgrades and its artifacts.
  const PERK_SETTINGS = [
    { key: "farming.speed_reduction",
      // Quicker Farming I-IV and Enriched Soil; Irrigation System I-II.
      perks: { 1: 5, 2: 10, 3: 15, 16: 20, 105: 10, 23: 10, 30: 20 } },
    { key: "farming.corn_speed_reduction", perks: { 169: 10, 170: 10 } },
    { key: "farming.double_crop_chance", perks: { 21: 15, 22: 25 } },
    { key: "orchard.bonus", perks: { 59: 5, 77: 10, 58: 5, 78: 10 },
      // Forester is a percentage on the page and a multiplier in the solver.
      value: (total) => 1 + total / 100 },
    { key: "exploring.wanderer_level", perks: { 13: 1, 14: 1, 15: 1, 20: 1 } },
    { key: "workshop.resource_saver", perks: { 49: 1, 53: 1, 121: 1 } },
    perkFlag("farmhouse.have_mattress_pad", 35),
    perkFlag("farmhouse.have_apple_pie_enthusiast", 236),
    perkFlag("chicken_coop.completed_starmap", 94),
    perkFlag("orchard.have_tree_shaker", 157),
    perkFlag("raptor_pen.have_antler_snare", 156),
    perkFlag("sawmill.have_pine_boost", 233),
    perkFlag("flour_mill.have_flour_power", 123),
    perkFlag("feed_mill.have_feed_boost", 122),
    perkFlag("sugar_cane_mill.have_sugar_boost_i", 237),
    perkFlag("sugar_cane_mill.have_sugar_boost_ii", 247),
    perkFlag("fishing.have_fishing_trawl", 112),
    perkFlag("fishing.have_reinforced_netting", 48),
    perkFlag("exploring.have_lemon_squeezer", 36),
    perkFlag("exploring.have_cinnamon_sticks", 102),
    // These two the solver otherwise has to infer from mastery progress, which
    // is what its Auto-detect setting does. The page states them outright.
    perkFlag("farming.have_scythe_of_dewstar", 196),
    perkFlag("exploring.have_mechanical_heart", 235),
  ];

  // Both perk pages share a row shape: the perk's state is the button carrying
  // its id, which reads "Unlocked" when it is owned and its price when it is
  // not. The id is what identifies it -- names repeat down a page (supply.php
  // lists this week's discounted perks again under their own headings) and are
  // decorated where an id isn't.
  function readPerkState(page) {
    const state = {};
    // A perk's is the only kind of button carrying one: the inventory and
    // stamina cap upgrades sharing supply.php's first list have no id.
    for (const button of page.querySelectorAll("button[data-id]")) {
      state[button.dataset.id] = button.textContent.trim() === "Unlocked";
    }
    return Object.keys(state).length ? state : null;
  }

  function readPerkStats() {
    const page = currentPage("perks") || currentPage("supply");
    if (!page) return null;
    const state = readPerkState(page);
    if (!state) return null;

    // Merged into what the other page said before anything is worked out: read
    // on its own, one page must not halve a total that spans the two.
    const seen = { ...readStoredJson(PERK_STATE_KEY), ...state };
    const merged = JSON.stringify(seen);
    if (merged !== readStored(PERK_STATE_KEY, "")) {
      writeStored(PERK_STATE_KEY, merged);
    }

    const captured = {};
    for (const setting of PERK_SETTINGS) {
      const perks = Object.entries(setting.perks);
      // A setting is left alone until every perk it depends on has been seen at
      // least once: a perk the pages haven't shown us is not an unowned one.
      // (A row absent from the page it belongs to -- an artifact above your
      // tower level -- stays unseen, and its setting stays untouched.)
      if (!perks.every(([id]) => id in seen)) continue;
      const total = perks.reduce(
        (sum, [id, worth]) => sum + (seen[id] ? worth : 0),
        0,
      );
      captured[setting.key] = setting.value ? setting.value(total) : total;
    }
    return Object.keys(captured).length ? captured : null;
  }

  // --- FarmRPG: handing the captures over ------------------------------------

  // Stored JSON, or an empty object if it was never written or won't parse.
  function readStoredJson(key) {
    try {
      return JSON.parse(readStored(key, "") || "{}");
    } catch (err) {
      return {};
    }
  }

  // Merged into what has been captured before, not written over it: each page
  // knows only its own few settings, and the solver should be offered
  // everything seen so far rather than whichever page was visited last. Merging
  // into the stored object also keeps the key order stable, so revisiting an
  // unchanged page still serialises to the same text and storeCapture stays
  // quiet.
  function storeFarmStats(stats) {
    if (!stats) return;
    storeCapture(FARM, JSON.stringify({ ...readStoredJson(FARM.textKey), ...stats }));
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

  // --- FarmRPG: the page scan ------------------------------------------------

  // FarmRPG is a SPA, so a page shown by a navigation may still be rendering:
  // poll for the markers rather than guessing at a single delay. Only the
  // latest navigation's poll runs -- quick navigation shouldn't leave earlier
  // ones reading the page behind it.
  let scanTimer = null;

  function scanPage() {
    const masteryText = readMasteryText();
    if (masteryText) storeCapture(MASTERY, masteryText);

    const inventoryText = readInventoryText();
    if (inventoryText) storeCapture(INVENTORY, inventoryText);

    const farmStats =
      readFarmStats() ||
      readStorehouseStats() ||
      readFarmhouseStats() ||
      readPerkStats() ||
      readPetStats() ||
      readLocationStats();
    if (farmStats) storeFarmStats(farmStats);

    return !!(masteryText || inventoryText || farmStats);
  }

  function scanSoon() {
    let attempts = 0;
    clearInterval(scanTimer);
    scanTimer = setInterval(() => {
      if (scanPage() || ++attempts >= 10) clearInterval(scanTimer);
    }, 250);
  }

  function initFarmRpg() {
    console.log("Populate Solver ready on FarmRPG (auto-capture on).");
    navigation.addEventListener("currententrychange", scanSoon);
    scanSoon();
  }

  // --- Solver: apply ---------------------------------------------------------

  // Every setting is named by its solver config key, which is how the solver
  // asks to be addressed: each control mirroring a key carries it as
  // data-config-key, whether the settings panel generates the control or writes
  // it out by hand. (A key shared by a group of radios is answered by whichever
  // one matches its value -- nothing captured here is one, so the first control
  // carrying the key is always the one to write.)
  function farmControl(key) {
    return document.querySelector(`[data-config-key="${key}"]`);
  }

  // A captured value in the form its own control takes, which the control says
  // rather than the value: a "bool" is a checkbox, but an "autobool" is a select
  // of ""/"true"/"false" -- an auto-detected setting the capture can settle --
  // so a captured true means .checked to one and .value to the other.
  function controlValue(input, value) {
    if (input.dataset.configType === "bool") return !!value;
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  }

  // Which settings controls the captured farm stats would actually change. A
  // stat whose control isn't on the page -- an older solver, a setting it has
  // since renamed -- is left alone rather than guessed at.
  function farmChanges(text) {
    let stats;
    try {
      stats = JSON.parse(text);
    } catch (err) {
      return [];
    }
    const changes = [];
    for (const [key, captured] of Object.entries(stats)) {
      const input = farmControl(key);
      if (!input) continue;
      const value = controlValue(input, captured);
      if (typeof value === "boolean") {
        if (input.checked !== value) changes.push([input, value]);
      } else if (input.value !== value) {
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

    // Most of the controls a farm capture lands in are generated by the solver's
    // own startup rather than served in the page, so they may not be there yet:
    // re-check once they are, rather than leaving a waiting capture unnoticed
    // until the tab is next focused. It waits on a control inside a generated
    // pane -- the page serves hand-written ones carrying a config key from the
    // start, so their presence says nothing about whether startup has run.
    const GENERATED = '.config-fields[data-config="buildings"] [data-config-key]';
    let attempts = 0;
    const waitForControls = setInterval(() => {
      if (document.querySelector(GENERATED) || ++attempts >= 20) {
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
    // Neither half of this script has anything to offer without the storage
    // that joins them: the capture would have nowhere to go, and the solver
    // page nothing to read.
    if (!(await loadStorage())) return;
    if (location.hostname.endsWith("farmrpg.com")) initFarmRpg();
    else initSolver();
  });
})();
