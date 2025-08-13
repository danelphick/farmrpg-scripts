// ==UserScript==
// @name         Action Announcements
// @version      0.1
// @description  Announce when the cooking actions are ready
// @author       danelphick@
// @match        https://*.farmrpg.com/index.php
// @match        https://*.farmrpg.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.getValue
// @grant        GM.setValue
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// @require      https://raw.githubusercontent.com/erming/tabcomplete/refs/heads/gh-pages/src/tabcomplete.min.js
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.min.js
// ==/UserScript==

/* globals $, GM_config */

let myBox = null;
let cropTimeLeft = null;
let stirTimeLeft = null;
let tasteTimeLeft = null;
let seasonTimeLeft = null;
const synth = window.speechSynthesis;
let pendingUtterances = [];
let voice = null;

let gmc = new GM_config({
  id: "cooking-announcements",
  title: "Cooking Announcements Settings",
  fields: {
    enableStirAnnouncements: {
      label: "Announce stir ready",
      type: "checkbox",
      default: true,
    },
    enableTasteAnnouncements: {
      label: "Announce taste ready",
      type: "checkbox",
      default: true,
    },
    enableSeasonAnnouncements: {
      label: "Announce season ready",
      type: "checkbox",
      default: true,
    },
    enableCollectAnnouncements: {
      label: "Announce collect ready",
      type: "checkbox",
      default: true,
    },
    enableCropsAnnouncements: {
      label: "Announce crops ready",
      type: "checkbox",
      default: true,
    },
  },
});

// gmc.open();

// Taken from:
// https://stackoverflow.com/questions/5525071/how-to-wait-until-an-element-exists
function waitForElm(selector) {
  return new Promise((resolve) => {
    if ((elm = document.querySelector(selector))) {
      return resolve(elm);
    }

    const observer = new MutationObserver((mutations) => {
      if ((elm = document.querySelector(selector))) {
        observer.disconnect();
        resolve(elm);
      }
    });

    // If you get "parameter 1 is not of type 'Node'" error, see:
    // https://stackoverflow.com/a/77855838/492336
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

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

let cropCountDownId = null;
let kitchenControls = {
  stir: { timer: -1, button: null },
  taste: { timer: -1, button: null },
  season: { timer: -1, button: null },
  collect: { timer: -1, button: null },
  cook: { timer: -1, button: null },
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

  kitchenControls.collect.button = buttons.children[0];
  kitchenControls.stir.button = buttons.children[1];
  kitchenControls.taste.button = buttons.children[2];
  kitchenControls.season.button = buttons.children[3];
  kitchenControls.cook.button = contentBlock.querySelector(".cookallbtn");

  addKitchenEventListener("stir", 15 * 60000);
  addKitchenEventListener("taste", 20 * 60000);
  addKitchenEventListener("season", 30 * 60000);
}

function monitorKitchen() {
  console.log("monitor kitchen");
  function installClickListeners() {
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

function addListenerToPlantAllButton(oldCroparea, oldPlantAll) {
  const plantAll = $(".plantallbtn");
  if (!plantAll) {
    setTimeout(10, monitorPlantAll);
    return;
  }
  plantAll.off("click.action-announcements");
  plantAll.on("click.action-announcements", (event) => {
    if (timeoutId != 0) {
      clearTimeout(timeoutId);
    }
    // Wait for the new crops to be loaded. Should really watch for mutations.
    setTimeout(() => {
      waitForElm("#croparea .concrop").then((crop) => {
        const time = Number(crop.getAttribute("data-seconds"));
        setTimeout(() => {
          const utterance = new SpeechSynthesisUtterance("Crops done!");
          setVoice(utterance);
          synth.cancel();
          synth.speak(utterance);
          if (cropCountDownId) {
            clearInterval(cropCountDownId);
            cropCountDownId = null;
          }
          cropTimeLeft.text("Done!").css("color: red");
        }, time * 1000);
        if (cropCountDownId) {
          clearInterval(cropCountDownId);
        }
        cropCountDownId = setRemainingTimeAndCreateTimer(cropTimeLeft, time);
      }, 500)});
  });
}

function monitorPlantAll() {
  waitForElm("#croparea").then((croparea) => {
    setTimeout(() => {
      const plantAll = croparea?.children[0]?.children[0]?.children[2];
      addListenerToPlantAllButton(croparea, plantAll);
    }, 300);
  });
}

function setRemainingTime(timeLeftSpan, timeRemaining) {
  if (timeRemaining > 60) {
    timeLeftSpan.text(`${Math.floor(timeRemaining / 60)}m`);
  } else {
    timeLeftSpan.text(`${timeRemaining}s`);
  }
}

function setRemainingTimeAndCreateTimer(timeLeftSpan, timeRemaining) {
  setRemainingTime(timeLeftSpan, timeRemaining);
  // TODO: This should look at actual wall clock time.
  return setInterval(() => {
    --timeRemaining;
    setRemainingTime(timeLeftSpan, timeRemaining);
  }, 1000);
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
  if (pathname.endsWith("/xfarm.php")) {
    monitorPlantAll();
  } else if (pathname.endsWith("/kitchen.php")) {
    monitorKitchen();
  }
}

$(document).ready(function () {
  $("div.pages").append(`
  <div id='action-announcements' class='action-announcements-box' style='
    z-index: 1;
    position: fixed;
    left: 0;
    right: 1;
    margin-left: 10px;
    bottom: 10px;
    background-color: rgba(0, 0, 0, 0.3);
    color: white;
    box-sizing: border-box;
    font-size: 0.75em;
    padding: 10px;
  '>
    <div id='crop-time-left'>Crop Time Left: <span id="crop-time">Unknown</span></div>
    <div id='stir-time-left'>Time till stir: <span id="stir-time">Unknown</span></div>
    <div id='taste-time-left'>Time till taste: <span id="taste-time">Unknown</span></div>
    <div id='season-time-left'>Time till season:<span id="season-time">Unknown</span></div>
    <button id='open-config'>Open Settings</button>
  </div>
  `);

  cropTimeLeft = $("#crop-time");
  stirTimeLeft = $("#stir-time");
  tasteTimeLeft = "$#taste-time";
  seasonTimeLeft = "$#season-time";

  addLocationObserver(observerCallback);
  observerCallback();
});
