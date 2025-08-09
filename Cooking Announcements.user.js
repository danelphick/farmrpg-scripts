// ==UserScript==
// @name         Cooking announcemengs Notification
// @version      0.1
// @description  Announce when the cooking actions are ready
// @author       danelphick@
// @match        https://*.farmrpg.com/index.php
// @match        https://*.farmrpg.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// @require      https://raw.githubusercontent.com/erming/tabcomplete/refs/heads/gh-pages/src/tabcomplete.min.js
// @require      https://moment.github.io/luxon/global/luxon.min.js
// ==/UserScript==

/* globals $, luxon */

let myBox = null;
let timeLeft = null;
const synth = window.speechSynthesis;
let pendingUtterances = [];
let voice = null;

function onVoicesChanged(_event) {
  if (synth.getVoices().length) {
    synth.removeEventListener("voiceschanged", onVoicesChanged);

    setVoice(...pendingUtterances);
    pendingUtterances = [];
  }
}

function setVoice(...utterances) {
  if (voice) {
    for (const utterance of utterances) {
      utterance.voice = voice;
    }
    return;
  }

  if (!synth.getVoices().length) {
    if (pendingUtterances.length) {
      pendingUtterances = pendingUtterances.concat(utterances);
    } else {
      pendingUtterances = utterances;
      synth.addEventListener("voiceschanged", onVoicesChanged);
    }
    return;
  }

  for (const v of synth.getVoices()) {
    if (v.lang == "en-GB" && !v.localService) {
      voice = v;
      for (const utterance of utterances) {
        utterance.voice = voice;
      }
      break;
    }
  }
}

setVoice();

function updateRaptors(url) {
  const league = url.searchParams.get("league");
  if (!league) return;

  chrome.storage.local.get(["raptors"]).then((result) => {
    storedRaptors = result.raptors;
    if (storedRaptors == null) {
      storedRaptors = {};
    }
    if (storedRaptors[league] == null) {
      storedRaptors[league] = {};
    }
    let leagueRaptors = storedRaptors[league];
    const currentDate = new Date().toDateString();
    if (leagueRaptors?.date != currentDate) {
      // It's a new day, so blank all the previous win-loss data.
      storedRaptors[league] = leagueRaptors = {};
      leagueRaptors.date = currentDate;
    }

    const raptors = document.querySelectorAll(
      "li .item-content .item-inner .item-title"
    );

    for (let raptor of raptors) {
      const leagueRecordElm = raptor.children[2];
      const winLossElm = leagueRecordElm?.children[0];
      const winLoss = winLossElm?.textContent;
      if (winLoss == null) continue;
      const name = raptor.children[0].textContent;
      const trainer = leagueRecordElm.children[3].textContent;
      const key = `${trainer}:${name}`;

      // Check we haven't already added the score difference.
      if (winLoss.indexOf(")") != -1) continue;

      const index1 = winLoss.indexOf(" ");
      const win = Number(winLoss.substring(0, index1).replaceAll(",", ""));
      const loss = Number(
        winLoss
          .substring(winLoss.indexOf(" ", index1 + 1) + 1)
          .replaceAll(",", "")
      );
      lastResults = leagueRaptors[key];
      winAtStartOfDay = lastResults?.winAtStartOfDay ?? win;
      lossAtStartOfDay = lastResults?.lossAtStartOfDay ?? loss;

      const positionElm = raptor.parentElement.children[1];
      const position = Number(positionElm.textContent.substring(1));
      const lastPosition = lastResults?.positionAtStartOfDay ?? position;
      const greenStyle = "color: #00bc01; margin-right: 1ch;";
      const redStyle = "color: #e21e1e; margin-right: 1ch;";
      if (position != lastPosition) {
        arrow = document.createElement("span");
        if (position > lastPosition) {
          arrow.textContent = (position - lastPosition).toString() + "▼";
          arrow.style = redStyle;
        } else {
          arrow.textContent = (lastPosition - position).toString() + "▲";
          arrow.style = greenStyle;
        }
        positionElm.insertBefore(arrow, positionElm.firstChild);
      }
      leagueRaptors[key] = {
        win: win,
        loss: loss,
        positionAtStartOfDay: lastPosition,
        winAtStartOfDay: winAtStartOfDay,
        lossAtStartOfDay: lossAtStartOfDay,
      };
      const diff = win - loss;
      const detail = `${winLoss} (${diff > 0 ? "+" : ""}${diff}) (W${
        win - winAtStartOfDay
      } L${loss - lossAtStartOfDay} today)`;
      winLossElm.textContent = detail;
    }
    chrome.storage.local.set({ raptors: storedRaptors });
  });
}

let cropCountDownId = null;
let kitchenControls = {
  stir: {timer: -1, button: null},
  taste: {timer: -1, button: null},
  season: {timer: -1, button: null},
  collect: {timer: -1, button: null},
  cook: {timer: -1, button: null},
};

function addTimer(activityName, time, repeatTime) {
  // Speak the words
  // Clear stale timer. Not ideal as this could actually set the timer to wrong
  // value if pressed too early.
  if (kitchenControls[activityName].timer >= 0) {
    console.log(`Clearing timer for ${activityName}.`);
    clearTimeout(kitchenControls[activityName].timer);
  }

  addKitchenEventListener(activityName, repeatTime);

  // Set a new timer
  console.log(`Setting ${activityName} timer for ${time / 60000}m.`);
  kitchenControls[activityName].timer = setTimeout(() => {
    updateButtons();

    const utterance = new SpeechSynthesisUtterance("Time to " + activityName);
    setVoice(utterance);
    synth.speak(utterance);
  }, time);
}

function addKitchenEventListener(activityName, time) {
  const button = kitchenControls[activityName].button;
  console.log("adding click listener: " + activityName);
  button.addEventListener("click", (_click) => {
    console.log("click listener triggered: " + activityName);
    setTimeout(() => addTimer(activityName, time, time), 10);
  });
}

let kitchen = null;

function updateButtons() {
  let contentBlock = kitchen.querySelector("div.content-block");
  let buttons = contentBlock.querySelector("div.buttons-row");
  // console.log(buttons);

  kitchenControls.collect.button = buttons.children[0];
  kitchenControls.stir.button = buttons.children[1];
  kitchenControls.taste.button = buttons.children[2];
  kitchenControls.season.button = buttons.children[3];
  kitchenControls.cook.button = contentBlock.querySelector(
    ".cookallbtn"
  );

  addKitchenEventListener("stir", 15 * 60000);
  addKitchenEventListener("taste", 20 * 60000);
  addKitchenEventListener("season", 30 * 60000);

  // console.log(kitchenControls);
}

function monitorKitchen() {
  console.log("monitor kitchen");
  function installClickListeners() {
    // console.log(kitchenControls.cook.button);
    kitchenControls.cook.button.addEventListener("click", () => {
      addTimer("stir", 60000, 15 * 60000);
      addTimer("taste", 3 * 60000, 20 * 60000);
      addTimer("season", 5 * 60000, 30 * 60000);
    });
  }

  function mutationCallback(mutationList, observer) {
    const fireworks = document.getElementById("fireworks");
    const newKitchen = fireworks.querySelector(
      "div.pages div[data-page=kitchen]"
    );

    // console.log(`${kitchen} ${newKitchen}`)
    if (!newKitchen) {
      setTimeout(10, mutationCallback);
      return;
    }
    if (kitchen != newKitchen) {
      kitchen = newKitchen;
      updateButtons();
      // console.log(kitchenControls);
      observer = new MutationObserver(mutationCallback);
      observer.observe(kitchen, {
        childList: true,
        attributes: false,
        subtree: false,
      });
    }
    installClickListeners();
  }

  mutationCallback();
}

let croparea = null;
let timeoutId = 0;

let plantAllClickListener = null;
function monitorPlantAll() {
  // console.log("monitor plant all");
  function installClickListener() {
    // console.log("    installing click listener");
    const croparea = document.getElementById("croparea");
    const plantAll = croparea?.children[0]?.children[0]?.children[2];
    // console.log(`    plantAll: ${plantAll} listener: ${plantAllClickListener}`);
    if (!plantAll) {
      setTimeout(10, monitorPlantAll);
      return;
    }
    if (plantAllClickListener) {
      plantAll.removeEventListener(plantAllClickListener);
    }
    plantAllClickListener = plantAll.addEventListener("click", (event) => {
      if (timeoutId != 0) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(function () {

        crops = document
          .getElementById("croparea")
          .children[3].getElementsByClassName("concrop");
        // console.log(crops);
        for (let crop of crops) {
          const time = Number(crop.getAttribute("data-seconds"));
          const nameAndNumber = crop.children[1].textContent.trim();
          console.log(
            `Crop '${nameAndNumber}' will be done in ${time} seconds.`
          );
          setTimeout(() => {
            console.log("Crops done!");
            const utterance = new SpeechSynthesisUtterance("Crops done!");
            setVoice(utterance);
            synth.cancel();
            synth.speak(utterance);
          }, time * 1000);
          if (cropCountDownId) {
            clearInterval(cropCountDownId);
          }
          let timeRemaining = time;
          cropCountDownId = setInterval(() => {
            --timeRemaining;
            if (timeRemaining > 60) {
              timeLeft.textContent = `${Math.floor(timeRemaining / 60)}m`;
            } else {
              timeLeft.textContent = `${timeRemaining}s`;
            }
          }, 1000);
        }
      }, 500);
    });
  }


  function mutationCallback(mutationList, observer) {
    // console.log(`  mutation callback: croparea: ${croparea} ${document.getElementById("croparea")}`);
    if (document.getElementById("croparea") != croparea) {
      croparea = document.getElementById("croparea");
      observer = new MutationObserver(mutationCallback);
      observer.observe(croparea, {
        childList: true,
        attributes: false,
        subtree: false,
      });
    }
    installClickListener();
  }

  mutationCallback();
}

function addLocationObserver(callback) {
  // Options for the observer (which mutations to observe)
  const config = { attributes: false, childList: true, subtree: false };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(document.body, config);
}

function observerCallback() {
  const url = new URL(window.location.href.replace("#!", ""));
  const pathname = url.pathname;
  if (pathname.endsWith("/rfcrankings.php")) {
    updateRaptors(url);
  } else if (pathname.endsWith("/xfarm.php")) {
    monitorPlantAll();
  } else if (pathname.endsWith("/kitchen.php")) {
    monitorKitchen();
  }

  if (!document.body.contains(myBox)) {
    myBox = document.createElement("div");
    myBox.textContent = "Time Left: ";
    timeLeft = document.createTextNode("5 mins");
    myBox.appendChild(timeLeft);
    let bottom = document.getElementById("bottom");
    myBox.style = `
      z-index: 1;
      position: fixed;
      left: 0;
      right: 1;
      margin-left: 10px;
      bottom: 130px;
      height: 40px;
      background-color: rgba(0, 0, 0, 0.3);
      color: white;
      box-sizing: border-box;
      font-size: 0.75em;
      padding: 10px;`;
    bottom.appendChild(myBox);
  }
}

addLocationObserver(observerCallback);
observerCallback();
