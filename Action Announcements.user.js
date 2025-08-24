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
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.min.js
// ==/UserScript==

/* globals $, GM_config */

let myBox = null;
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

let intervalTimer = null;
let actionControls = {
  stir: {
    button: null,
    span: null,
    finishTime: null,
    initTime: 60,
    addTime: 15 * 60,
    speech: "Time to stir",
  },
  taste: {
    button: null,
    span: null,
    finishTime: null,
    initTime: 3 * 60,
    addTime: 20 * 60,
    speech: "Time to taste",
  },
  season: {
    button: null,
    span: null,
    finishTime: null,
    initTime: 5 * 60,
    addTime: 30 * 60,
    speech: "Time to season",
  },
  collect: {
    button: null,
    span: null,
    finishTime: null,
    initTime: null,
    addTime: null,
    speech: "Cooking done",
  },
  cook: {
    button: null,
    span: null,
    finishTime: null,
    initTime: null,
    addTime: null,
    speech: null,
  },
  crop: {
    button: null,
    span: null,
    finishTime: null,
    initTime: null,
    addTime: null,
    speech: "Crops done",
  },
};

function addActionEventListener(activityName) {
  const control = actionControls[activityName];
  control.button
    .off("click.action-announcements")
    .on("click.action-announcements", (_click) => {
      setTimeout(() => resetTimer(activityName, false), 10);
    });
}

function resetTimer(activityName, initCook) {
  // Set a new timer
  control = actionControls[activityName];
  const time = initCook ? control.initTime : control.addTime;
  control.finishTime = new Date().getTime() + time * 1000;

  console.log(`Setting ${activityName} timer for ${time / 60}m.`);
}

let kitchen = null;

function updateButtons() {
  let contentBlock = $(kitchen).find("div.content-block");
  let buttons = contentBlock.find("div.buttons-row").children();

  actionControls.collect.button = $(buttons[0]);
  actionControls.stir.button = $(buttons[1]);
  actionControls.taste.button = $(buttons[2]);
  actionControls.season.button = $(buttons[3]);
  actionControls.cook.button = $(contentBlock.find(".cookallbtn")[0]);

  for (const control of ["stir", "taste", "season"]) {
    addActionEventListener(control);
  }

  actionControls.cook.button.off("click.action-announcements").on("click.action-announcements", () => {
    for (control of ["stir", "taste", "season"]) {
      resetTimer(control, true);
    }
  });
}

let timeoutId = 0;

function addListenerToPlantAllButton() {
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
        setupTimerForControl("crop", new Date().getTime() + time * 1000);
      }, 500);
    });
  });
}

function setRemainingTimeOnSpan(timeLeftSpan, timeRemaining) {
  if (timeRemaining <= 0) {
    timeLeftSpan.text("Done!").css("color: red");
  } else {
    if (timeRemaining > 60000) {
      const seconds = Math.floor((timeRemaining % 60000) / 1000);
      if (seconds == 0) {
        timeLeftSpan.text(`${Math.floor(timeRemaining / 60000)}m`);
      } else {
        timeLeftSpan.text(`${Math.floor(timeRemaining / 60000)}m ${seconds}s`);
      }
    } else {
      timeLeftSpan.text(`${Math.ceil(timeRemaining / 1000)}s`);
    }
    timeLeftSpan.css("color: white");
  }
}

function setupTimerForControl(name, finishTime) {
  actionControls[name].finishTime = finishTime;
  setRemainingTimeOnSpan(actionControls[name].span, "");
}

function updateTimerSpans() {
  const currentTime = new Date().getTime();
  for (const control of Object.values(actionControls)) {
    if (control.finishTime == null) continue;
    const timeLeft = control.finishTime - currentTime;
    if (timeLeft <= 0) {
      control.span.text("Done!").css("color: red");
      const utterance = new SpeechSynthesisUtterance(control.speech);
      setVoice(utterance);
      synth.speak(utterance);
      control.finishTime = null;
    } else {
      setRemainingTimeOnSpan(control.span, Math.ceil(timeLeft));
    }
  }
}

function monitorPlantAll() {
  waitForElm("#croparea").then((croparea) => {
    setTimeout(() => {
      addListenerToPlantAllButton();
    }, 300);
  });
}

function monitorKitchen() {
  function mutationCallback(mutationList, observer) {
    const newKitchen = $("#fireworks div.pages div[data-page=kitchen]");

    if (!newKitchen.length) {
      setTimeout(() => { mutationCallback(mutationList, observer);}, 10);
      return;
    }
    if (kitchen != newKitchen.get()[0]) {
      kitchen = newKitchen.get()[0];
      updateButtons();
      if (observer != null) {
        observer.disconnect();
      }
      observer = new MutationObserver(mutationCallback);
      observer.observe(kitchen, {
        childList: true,
        attributes: false,
        subtree: false,
      });
    }
  }

  mutationCallback();
}

function addLocationObserver(callback) {
  const config = { attributes: false, childList: true, subtree: false };
  const observer = new MutationObserver(callback);
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
    font-size: 0.8em;
    padding: 10px;
  '>
    <div id='crop-time-left'>Crop Time Left: <span id="crop-time">Unknown</span></div>
    <div id='stir-time-left'>Time till stir: <span id="stir-time">Unknown</span></div>
    <div id='taste-time-left'>Time till taste: <span id="taste-time">Unknown</span></div>
    <div id='season-time-left'>Time till season: <span id="season-time">Unknown</span></div>
    <button id='open-config'>Open Settings</button>
  </div>
  `);

  $("#open-config").on("click", () => {
    gmc.open();
  });

  actionControls.stir.span = $("#stir-time-left span");
  actionControls.taste.span = $("#taste-time-left span");
  actionControls.season.span = $("#season-time-left span");
  actionControls.crop.span = $("#crop-time-left span");

  addLocationObserver(observerCallback);
  observerCallback();

  setInterval(updateTimerSpans, 1000);
});
