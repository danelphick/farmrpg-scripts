// ==UserScript==
// @name         Copy Masteries
// @version      1.0
// @description  Creates a button top copy masteries from the FarmRPG Mastery Progress Page into clipboard
// @author       danelphick@
// @match        https://farmrpg.com/index.php
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_setClipboard
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    /* globals jQuery, $, waitForKeyElements, navigation */
    'use strict';

    $(document).ready(
        () => {
            function addButton(text, onclick, cssObj) {
                let masteryTitle = null;
                for (let x of $(".content-block-title")) { if (x.textContent== "Mastery In-Progress") { masteryTitle = x; break; } }
                if (masteryTitle) {
                    cssObj = cssObj || {position: 'relative', left:'4%', 'z-index': 3};
                    let button = document.createElement('button');
                    let btnStyle = button.style;
                    masteryTitle.insertAdjacentElement("beforebegin", button);
                    button.innerHTML = text;
                    button.onclick = onclick;
                    Object.keys(cssObj).forEach(function (key) { btnStyle[key] = cssObj[key]; });
                    return button;
                }
            }

            function click() {
                let masteryTitle = null;
                for (let x of $(".content-block-title")) { if (x.textContent== "Mastery In-Progress") { masteryTitle = x; break; } }

                if (masteryTitle) {
                    // let nodes = $(".searchbar-found ul").splice(1, 2); nodes[1] = nodes[1].nextSibling;
                    // document.getSelection().setBaseAndExtent(nodes[0], 0, nodes[1], 0)
                    let nodes = $(".searchbar-found ul").splice(1, 2); nodes[1] = nodes[1].nextSibling;
                    document.getSelection().setBaseAndExtent(masteryTitle, 0, masteryTitle.parentElement.lastElementChild, 0);
                    GM_setClipboard(document.getSelection().toString(), "text", () => console.log("Clipboard set!"));
                }
            }
            navigation.addEventListener("currententrychange", () => {
                addGetSelectionButton();
            });

            function addGetSelectionButton() {
                setTimeout(() => { addButton('Copy Mastery Data', click); }, 500);
            }

            addGetSelectionButton();
        });

})();
