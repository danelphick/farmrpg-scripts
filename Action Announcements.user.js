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

announcementOptions = ["None", "Speech", "OS Notification", "Both"];

let gmc = new GM_config({
  id: "actions-announcements",
  title: "Action Announcements Settings",
  fields: {
    enableStirAnnouncements: {
      label: "Announce stir ready",
      type: "select",
      options: announcementOptions,
      default: "speech",
    },
    enableTasteAnnouncements: {
      label: "Announce taste ready",
      type: "select",
      options: announcementOptions,
      default: "speech",
    },
    enableSeasonAnnouncements: {
      label: "Announce season ready",
      type: "select",
      options: announcementOptions,
      default: "speech",
    },
    enableCookAnnouncements: {
      label: "Announce cooking done",
      type: "select",
      options: announcementOptions,
      default: "speech",
    },
    enableCropsAnnouncements: {
      label: "Announce crops ready",
      type: "select",
      options: announcementOptions,
      default: "speech",
    },
    testNotifications: {
      label: "Test Notifications",
      type: "button",
      click: function () {
        GM_notification({
          text: "This is a test notification",
          title: "Test Notification",
          tag: "farmrpg-action-announcements-test",
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

const ActionState = Object.freeze({
  // A timer is set, waiting for the action to be ready.
  WAITING: "waiting",
  // The timer has been checked and has expired. A notification has be shown but not acted upon in
  // any way.
  READY: "ready",
  // The timer has been acted upon either by completing the action (but not setting a new timer,
  // e.g. season 25 minutes before cooking is done) or by clicking away the notification.
  CLEARED: "cleared",
  // This is used for cooking actions that are dependent on the main cooking action. Season can't be
  // done if cooking will be finished before the 30 min timer is up.
  NA: "N/A",
});

class ActionControl {
  constructor(type, finishTimeName, initTime, addTime, speech) {
    this.type = type;
    this.button = null;
    this.span = null;
    this.finishTime = GM_getValue(finishTimeName);
    this.state = "unknown";
    this.initTime = initTime;
    this.addTime = addTime;
    this.speech = speech;
    if (this.finishTime != null) {
      this.state = ActionState.WAITING;
    } else {
      this.state = ActionState.CLEARED;
    }
  }

  setFinishTime(finishTime) {
    this.finishTime = finishTime;
    this.state = ActionState.WAITING;
  }

  // This doesn't clear the timer, so if the window is reloaded while the timer is still showing, it
  // will be re-shown.
  setTimerComplete() {
    this.state = ActionState.READY;
  }

  setTimerCleared() {
    this.finishTime = null;
    this.state = ActionState.CLEARED;
  }

  setTimerNA() {
    this.finishTime = null;
    this.state = ActionState.NA;
  }

  couldBeReady() {
    return this.state == ActionState.WAITING || this.state == ActionState.READY;
  }
}

const actionControls = {
  cook: new ActionControl("kitchen", "cook_finish_time", null, null, "Cooking done"),
  stir: new ActionControl("kitchen", "stir_finish_time", 60, 15 * 60, "Time to stir"),
  taste: new ActionControl("kitchen", "taste_finish_time", 3 * 60, 20 * 60, "Time to taste"),
  season: new ActionControl("kitchen", "season_finish_time", 5 * 60, 30 * 60, "Time to season"),
  crop: new ActionControl("farm", "crop_finish_time", null, null, "Crops done"),
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
  control.button.off("click.action-announcements").on("click.action-announcements", (_click) => {
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
}

function setFinishTime(activityName, finishTime) {
  control = actionControls[activityName];
  if (finishTime != null && !Number.isInteger(finishTime)) {
    finishTime = finishTime.getTime();
  }
  control.setFinishTime(finishTime);
  GM_setValue(`${activityName}_finish_time`, control.finishTime);
}

let kitchen = null;

function updateKitchenButtons() {
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

let oven = null;

function updateOvenTimers() {
  function getFirstWord(text) {
    const firstSpace = text.indexOf(" ");
    return firstSpace >= 0 ? text.substring(0, firstSpace) : text;
  }

  let contentBlock = $(oven).find("div.content-block");

  const timeSpans = contentBlock.find("span[data-countdown-to]");
  for (const timeSpan of timeSpans) {
    const actionCountdownTo = timeSpan.getAttribute("data-countdown-to");
    const actionText = timeSpan.parentElement.previousElementSibling.children[0].textContent;
    const action = getFirstWord(actionText).toLowerCase();
    if (action in actionControls) {
      const actionReadyTime = parseTimeInGameTZ(actionCountdownTo).toJSDate();
      actionControls[action].setFinishTime(actionReadyTime.getTime());
    }
  }
  const actionButtons = contentBlock.find("button[data-oven]");
  for (const button of actionButtons) {
    const action = getFirstWord(button.textContent).toLowerCase();
    if (action in actionControls) {
      actionControls[action].setFinishTime(new Date().getTime());
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
    timeLeftSpan.text("Ready!").css("color", "green");
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
    timeLeftSpan.css("color", "white");
  }
}

function setupTimerForControl(name, finishTime) {
  actionControls[name].setFinishTime(finishTime);
  setRemainingTimeOnSpan(actionControls[name].span, "");
}

function shouldSpeak(announceSetting) {
  return announceSetting == "Speech" || announceSetting == "Both";
}

function shouldShowNotification(announceSetting) {
  return announceSetting == "OS Notification" || announceSetting == "Both";
}

let showingKitchenNotification = false;
let lastKitchenNotification = "";
let showingFarmNotification = false;
let lastFarmNotification = "";

function updateTimerSpans() {
  if (actionControls.cook.state != ActionState.WAITING) {
    actionControls.stir.setTimerNA();
    actionControls.taste.setTimerNA();
    actionControls.season.setTimerNA();
  } else {
    for (const control of ["stir", "taste", "season"]) {
      if (actionControls[control].finishTime > actionControls.cook.finishTime) {
        actionControls[control].setTimerNA();
      }
    }
  }

  let kitchenNotificationText = "";
  let farmNotificationText = "";
  const currentTime = new Date().getTime();
  for (const control of Object.values(actionControls)) {
    if (!control.couldBeReady()) {
      if (control.state == ActionState.NA) {
        control.span.text("N/A").css("color", "gray");
      }
      continue;
    }

    const timeLeft = control.finishTime - currentTime;
    if (timeLeft <= 0) {
      control.span.text("Done!").css("color", "green");
      // Only announce when the timer first expires.
      if (control.state == ActionState.WAITING && shouldSpeak(control.announce)) {
        speak(control.speech);
      }
      if (shouldShowNotification(control.announce)) {
        if (control.type == "kitchen") {
          kitchenNotificationText += (kitchenNotificationText ? "\n" : "") + control.speech;
        } else if (control.type == "farm") {
          farmNotificationText += (farmNotificationText ? "\n" : "") + control.speech;
        } else {
          console.error("Unknown control type:", control.type);
        }
      }
      control.setTimerComplete();
    } else {
      if (Number.isInteger(control.finishTime)) {
        setRemainingTimeOnSpan(control.span, Math.ceil(timeLeft));
      } else {
        control.span.text(control.finishTime);
      }
    }
  }
  if (kitchenNotificationText) {
    if (kitchenNotificationText != lastKitchenNotification) {
      showNotification(
        kitchenNotificationText,
        "Kitchen",
        () => {
          for (const control of [
            actionControls.stir,
            actionControls.taste,
            actionControls.season,
            actionControls.cook,
          ]) {
            if (control.state == ActionState.READY) {
              control.setTimerCleared();
            }
          }
          showingKitchenNotification = false;
        },
        function () {
          window.focus();
          if (window.location.href.indexOf("/kitchen.php") < 0) {
            document.getElementsByClassName("fa-spoon")[0].click();
          }
        }
      );
      showingKitchenNotification = true;
      lastKitchenNotification = kitchenNotificationText;
    }
  } else if (showingKitchenNotification) {
    // Clear any existing notification if there is nothing to show.
    clearNotification("Kitchen");
    showingKitchenNotification = false;
    lastKitchenNotification = "";
  }
  if (farmNotificationText) {
    if (farmNotificationText != lastFarmNotification) {
      showNotification(
        farmNotificationText,
        "Farm",
        () => {
          showingFarmNotification = false;
          actionControls.crop.setTimerCleared();
        },
        function () {
          window.focus();
          if (window.location.href.indexOf("/xfarm.php") < 0) {
            document.getElementsByClassName("fa-home")[0].click();
          }
        }
      );
      showingFarmNotification = true;
      lastFarmNotification = farmNotificationText;
    }
  } else if (showingFarmNotification) {
    // Clear any existing notification if there is nothing to show.
    clearNotification("Farm");
    showingFarmNotification = false;
    lastFarmNotification = "";
  }
}

function showNotification(text, area, ondone, onclick) {
  GM_notification({
    text: text,
    title: "FarmRPG " + area,
    tag: "farmrpg-action-announcements-" + area,
    ondone: ondone,
    onclick: onclick,
  });
}

function clearNotification(area) {
  // There doesn't seem to be a direct way to clear a notification, but creating one (using the same
  // tag) with a short timeout causes one to be created that is never actually shown.
  GM_notification({
    text: "Clearing notification",
    title: "FarmRPG " + area,
    tag: "farmrpg-action-announcements-" + area,
    timeout: 200,
  });
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
      updateKitchenButtons();
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

function monitorOven() {
  function mutationCallback(mutationList, observer) {
    const newOven = $("#fireworks div.pages div[data-page=oven]");

    if (!newOven.length) {
      setTimeout(() => {
        mutationCallback(mutationList, observer);
      }, 10);
      return;
    }
    if (oven != newOven.get()[0]) {
      oven = newOven.get()[0];
      updateOvenTimers();
      if (observer != null) {
        observer.disconnect();
      }
      observer = new MutationObserver(mutationCallback);
      observer.observe(oven, {
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
  } else if (pathname.endsWith("/oven.php")) {
    monitorOven();
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
