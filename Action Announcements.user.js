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
// @require      https://moment.github.io/luxon/global/luxon.min.js
// ==/UserScript==

/* globals $, GM_config, luxon */

const DateTime = luxon.DateTime;

// TODO: This should convert to the user's timezone rather than hardcoding Europe/London.
function parseTimeInGameTZ(timeString) {
  return DateTime.fromISO(timeString, {
    zone: "America/Chicago",
  }).setZone("Europe/London");
}

let myBox = null;
const synth = window.speechSynthesis;
let pendingUtterances = [];
let voice = null;

let gmc = new GM_config({
  id: "actions-announcements",
  title: "Action Announcements Settings",
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
    enableCookAnnouncements: {
      label: "Announce cooking done",
      type: "checkbox",
      default: true,
    },
    enableCropsAnnouncements: {
      label: "Announce crops ready",
      type: "checkbox",
      default: true,
    },
    testNotifications: {
      label: "Test Notifications",
      type: "button",
      click: function () {
        GM_notification({
          text: "This is a test notification",
          title: "Test Notification",
        });
      },
    },
    testSpeechNotifications: {
      label: "Test Speech Notifications",
      type: "button",
      click: function () {
        speak("This is a test speech notification");
      },
    },
  },
  frameStyle: `
     position: fixed;
     left: 50%;
     border: 1px solid rgb(0, 0, 0);
     width: 450px;
     height: 300px;
     opacity: 1;
     overflow: auto;
     padding: 0px;
     z-index: 9999;
     display: block;
    `,
  css: `
    body#actions-announcements {
      background-color: #222;
      color: white;
      padding: 10px;
    }
    a#actions-announcements_resetLink {
      color: #88f;
    }
    a#actions-announcements_resetLink:link {
      color: #88f;
    }
    a#actions-announcements_resetLink:visited {
      color: #c00;
    }
  `,
  events: {
    init: onPreferencesChanged,
    save: onPreferencesChanged,
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

const actionControls = {
  cook: {
    button: null,
    span: null,
    finishTime: GM_getValue("cook_finish_time", null),
    initTime: null,
    addTime: null,
    announce: false,
    speech: "Cooking done",
  },
  stir: {
    button: null,
    span: null,
    finishTime: GM_getValue("stir_finish_time", null),
    initTime: 60,
    addTime: 15 * 60,
    announce: false,
    speech: "Time to stir",
  },
  taste: {
    button: null,
    span: null,
    finishTime: GM_getValue("taste_finish_time", null),
    initTime: 3 * 60,
    addTime: 20 * 60,
    announce: false,
    speech: "Time to taste",
  },
  season: {
    button: null,
    span: null,
    finishTime: GM_getValue("season_finish_time", null),
    initTime: 5 * 60,
    addTime: 30 * 60,
    announce: false,
    speech: "Time to season",
  },
  crop: {
    button: null,
    span: null,
    finishTime: GM_getValue("crop_finish_time", null),
    initTime: null,
    addTime: null,
    announce: false,
    speech: "Crops done",
  },
};

function onPreferencesChanged() {
  actionControls.stir.announce = gmc.get("enableStirAnnouncements");
  actionControls.taste.announce = gmc.get("enableTasteAnnouncements");
  actionControls.season.announce = gmc.get("enableSeasonAnnouncements");
  actionControls.cook.announce = gmc.get("enableCookAnnouncements");
  actionControls.crop.announce = gmc.get("enableCropsAnnouncements");
}

function addActionEventListener(activityName) {
  const control = actionControls[activityName];
  control.button
    .off("click.action-announcements")
    .on("click.action-announcements", (_click) => {
      setTimeout(() => setKitchenTimer(activityName, false), 10);
    });
}

function setKitchenTimer(activityName, initCook) {
  control = actionControls[activityName];
  const timeLeft = initCook ? control.initTime : control.addTime;
  setTimeLeft(activityName, timeLeft);
}

function setTimeLeft(activityName, timeLeft) {
  control = actionControls[activityName];
  const now = new Date().getTime();
  const newFinishTime = now + timeLeft * 1000;
  if (control.finishTime != null && control.finishTime > now) {
    return;
  }
  setFinishTime(activityName, newFinishTime);

  control.finishTime = newFinishTime;
}

function setFinishTime(activityName, finishTime) {
  control = actionControls[activityName];
  if (finishTime != null && !Number.isInteger(finishTime)) {
    finishTime = finishTime.getTime();
  }
  control.finishTime = finishTime;
  GM_setValue(`${activityName}_finish_time`, control.finishTime);
}

let kitchen = null;

function updateButtons() {
  let contentBlock = $(kitchen).find("div.content-block");
  let buttons = contentBlock.find("div.buttons-row").children();

  actionControls.stir.button = $(buttons[1]);
  actionControls.taste.button = $(buttons[2]);
  actionControls.season.button = $(buttons[3]);
  actionControls.cook.button = $(contentBlock.find(".cookallbtn")[0]);

  for (const control of ["stir", "taste", "season"]) {
    addActionEventListener(control);
  }

  actionControls.cook.button
    .off("click.action-announcements")
    .on("click.action-announcements", () => {
      for (control of ["stir", "taste", "season"]) {
        setKitchenTimer(control, true);
      }
    });

  const finishTimeSpan = contentBlock.find("span[data-countdown-to]")[0];
  if (finishTimeSpan) {
    const finishTimeString = finishTimeSpan.getAttribute("data-countdown-to");
    const finishTime = parseTimeInGameTZ(finishTimeString).toJSDate();

    setFinishTime("cook", finishTime);
  } else {
    // If no finish time is available then nothing is cooking so stir/taste/season can't be
    // possible.
    for (const control of ["stir", "taste", "season"]) {
      setFinishTime(control, null);
    }
  }
}

function addListenerToPlantAllButton() {
  const plantAll = $(".plantallbtn");
  if (!plantAll) {
    setTimeout(10, monitorPlantAll);
    return;
  }

  waitForElm("#croparea .concrop").then((crop) => {
    const time = Number(crop.getAttribute("data-seconds"));
    setTimeLeft("crop", time);
  });

  plantAll.off("click.action-announcements");
  plantAll.on("click.action-announcements", (event) => {
    // Wait for the new crops to be loaded. Should really watch for mutations.
    setTimeout(() => {
      waitForElm("#croparea .concrop").then((crop) => {
        const time = Number(crop.getAttribute("data-seconds"));
        setTimeLeft("crop", time);
      });
    }, 0);
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
  if (actionControls.cook.finishTime == null) {
    actionControls.stir.finishTime = "N/A";
    actionControls.taste.finishTime = "N/A";
    actionControls.season.finishTime = "N/A";
  } else {
    for (const control of ["stir", "taste", "season"]) {
      if (actionControls[control].finishTime > actionControls.cook.finishTime) {
        actionControls[control].finishTime = "N/A";
      }
    }
  }

  const currentTime = new Date().getTime();
  for (const control of Object.values(actionControls)) {
    if (control.finishTime == null) continue;
    const timeLeft = control.finishTime - currentTime;
    if (timeLeft <= 0) {
      control.finishTime = null;
      control.span.text("Done!").css("color: red");

      if (control.announce) {
        speak(control.speech);
      }
    } else {
      if (Number.isInteger(control.finishTime)) {
        setRemainingTimeOnSpan(control.span, Math.ceil(timeLeft));
      } else {
        control.span.text(control.finishTime);
      }
    }
  }
}

function speak(text) {
  // Sometimes the speech gets stuck saying it's speaking and never resets.
  // This prevents any new speech from starting.
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  setVoice(utterance);
  synth.speak(utterance);
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
      setTimeout(() => {
        mutationCallback(mutationList, observer);
      }, 10);
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
    <div id='cook-time-left'>Cook Time Left: <span id="cook-time">Unknown</span></div>
    <button id='open-config'>Open Settings</button>
  </div>
  `);

  $("#open-config").on("click", () => {
    if (gmc.frame == null) {
      gmc.open();
    } else {
      gmc.close();
    }
  });

  actionControls.stir.span = $("#stir-time-left span");
  actionControls.taste.span = $("#taste-time-left span");
  actionControls.season.span = $("#season-time-left span");
  actionControls.crop.span = $("#crop-time-left span");
  actionControls.cook.span = $("#cook-time-left span");

  addLocationObserver(observerCallback);
  observerCallback();

  setInterval(updateTimerSpans, 1000);
});
