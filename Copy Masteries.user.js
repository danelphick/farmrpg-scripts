// ==UserScript==
// @name         Copy Masteries
// @version      1.1
// @description  Creates buttons to copy masteries/inventory from the FarmRPG Mastery/Inventory pages to the clipboard.
// @author       danelphick@
// @match        https://farmrpg.com/index.php
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_setClipboard
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
  /* globals jQuery, $, waitForKeyElements, navigation */
  "use strict";

  $(document).ready(() => {
    function addButton(appendDiv, id, text, onclick, cssObj) {
      // Check if button already exists and abort.
      if ($("#" + id).length > 0 || !appendDiv) return;

      let button = document.createElement("button");
      let btnStyle = button.style;
      // Add button so it appears to the right of "Mastery In-Progress"
      appendDiv.appendChild(button);
      button.id = id;
      button.innerHTML = text;
      button.onclick = onclick;
      button.style = cssObj;
      return button;
    }

    function copyMasteryClick() {
      let masteryTitle = findMasteryTitle();

      if (masteryTitle) {
        let nodes = $(".searchbar-found ul").splice(1, 2);
        nodes[1] = nodes[1].nextSibling;
        document
          .getSelection()
          .setBaseAndExtent(masteryTitle, 0, masteryTitle.parentElement.lastElementChild, 0);
        GM_setClipboard(document.getSelection().toString(), "text", () =>
          console.log("Mastery copied."),
        );
      }
    }

    function copyInventoryClick() {
      let selectionDiv = $(".list-block-search.contacts-block")[0];
      if (selectionDiv) {
        let inventoryStats = $(selectionDiv).find(".content-block-title")[0]
        document.getSelection().setBaseAndExtent(selectionDiv, 0, inventoryStats, 0);
        GM_setClipboard(document.getSelection().toString(), "text", () =>
          console.log("Inventory copied."),
        );
      }
    }

    function findMasteryTitle() {
      let masteryTitle = null;
      for (let x of $(".content-block-title")) {
        if (x.textContent.startsWith("Mastery In-Progress")) {
          masteryTitle = x;
          console.log("Found mastery title");
          break;
        }
      }
      return masteryTitle;
    }

    function findBlockAboveInventory() {
      let inventoryList = $("[data-page=inventory].page .page-content .list-block")[0];
      return inventoryList?.previousElementSibling.children[0];
    }

    function addCopyButtons() {
      setTimeout(() => {
        addButton(
          findMasteryTitle(),
          "copyMasteryButton",
          "Copy Mastery Data",
          copyMasteryClick,
          "position: relative, left: 4%, z-index: 3",
        );
        addButton(
          findBlockAboveInventory(),
          "copyInventoryButton",
          "Copy Inventory Data",
          copyInventoryClick,
          "position: absolute; top: 70%; right: 10px; z-index: 3;",
        );
      }, 500);
    }

    navigation.addEventListener("currententrychange", () => {
      addCopyButtons();
    });

    addCopyButtons();
  });
})();
